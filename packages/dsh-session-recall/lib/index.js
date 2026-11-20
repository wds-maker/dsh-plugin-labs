/**
 * dsh-session-recall — carry the thread of a workspace across sessions.
 *
 * When a new session starts, this plugin reads the most recent sessions that
 * ran in the SAME workspace, extracts what was asked, what tools were used and
 * what the last answer said, compresses that into a few hundred characters and
 * injects it as a user-role context message.
 *
 * Design constraints:
 * - Never block or break session start: every failure is swallowed and only
 *   logged; the recap has a hard timeout.
 * - No model call: the compression is deterministic, so it costs no tokens and
 *   cannot hallucinate. It is an index, not prose.
 * - Complements dsh-openwolf (which injects curated STATUS/cerebrum memory):
 *   this plugin adds the "what actually happened last time" layer.
 *
 * @module dsh-session-recall
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let createUserMessage;
let llmError;
try {
    ({ createUserMessage } = await import('@deepseek-ai/dsh-llm'));
} catch (error) {
    llmError = error instanceof Error ? error.message : String(error);
}

export const name = 'dsh-session-recall';
export const inject = [];

const DEFAULTS = {
    maxSessions: 3,
    budgetChars: 1600,
    timeoutMs: 8000,
    includeTools: true,
};

const RECALL_DIR = '.dshrecall';

function clip(value, limit) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

/** Flatten a message's text parts. */
function textOf(message) {
    if (!message) return '';
    const parts = Array.isArray(message.content) ? message.content : [];
    const text = parts
        .filter((part) => part && part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n');
    return text.trim();
}

function idOf(record) {
    return record?.id ?? record?.session?.id ?? record?.header?.id ?? '';
}

function headerOf(record) {
    return record?.header ?? record?.session ?? {};
}

/** Extract the signal we care about from one session's raw events. */
function digestEvents(events) {
    const asks = [];
    const answers = [];
    const tools = new Set();
    let turns = 0;

    for (const event of events ?? []) {
        if (event?.type === 'turn/start') turns += 1;
        else if (event?.type === 'user/message') {
            const text = textOf(event.data?.message);
            if (text.length > 0) asks.push(text);
        } else if (event?.type === 'assistant/message') {
            const text = textOf(event.data?.message);
            if (text.length > 0) answers.push(text);
        } else if (event?.type === 'tool/call') {
            const toolName = event.data?.name;
            if (typeof toolName === 'string' && toolName.length > 0) tools.add(toolName);
        }
    }

    return {
        turns,
        goal: asks[0] ?? '',
        lastAsk: asks[asks.length - 1] ?? '',
        lastAnswer: answers[answers.length - 1] ?? '',
        tools: [...tools].slice(0, 10),
    };
}

function stamp(header) {
    const createdAt = header?.createdAt;
    const date = typeof createdAt === 'number' ? new Date(createdAt) : null;
    if (date === null || Number.isNaN(date.getTime())) return 'unknown time';
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Render one session block, trimmed to `share` characters. */
function renderBlock(index, entry, share, includeTools) {
    const lines = [];
    const title = entry.title ? ` · ${clip(entry.title, 60)}` : '';
    lines.push(`### ${index}. ${stamp(entry.header)}${title}`);
    if (entry.goal) lines.push(`- 目标：${clip(entry.goal, Math.min(180, share))}`);
    if (entry.lastAsk && entry.lastAsk !== entry.goal) lines.push(`- 最后追问：${clip(entry.lastAsk, 100)}`);
    if (entry.turns > 0) lines.push(`- 轮次：${entry.turns}`);
    if (includeTools && entry.tools.length > 0) lines.push(`- 用到：${entry.tools.join(', ')}`);
    if (entry.lastAnswer) lines.push(`- 结论：${clip(entry.lastAnswer, Math.min(260, share))}`);
    return lines.join('\n');
}

function timeout(ms, promise) {
    let timer;
    const guard = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`recall timed out after ${ms}ms`)), ms);
        timer.unref?.();
    });
    return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** Build the recap text for one workspace. Exported for tests. */
export async function buildRecap(query, cwd, currentId, opts) {
    const all = await query.listSessions();
    const candidates = (all ?? [])
        .map((record) => ({ record, id: idOf(record), header: headerOf(record) }))
        .filter((entry) => entry.id && entry.id !== currentId)
        .filter((entry) => {
            const sessionCwd = entry.header?.cwd;
            return typeof sessionCwd === 'string' && resolve(sessionCwd) === resolve(cwd);
        })
        .sort((a, b) => (b.header?.createdAt ?? 0) - (a.header?.createdAt ?? 0))
        .slice(0, Math.max(1, opts.maxSessions));

    if (candidates.length === 0) return null;

    const digests = [];
    for (const candidate of candidates) {
        try {
            const loaded = await query.readSession(candidate.id);
            const digest = digestEvents(loaded?.events ?? []);
            let title;
            try {
                title = await query.readTitle(candidate.id);
            } catch {
                title = undefined;
            }
            digests.push({ header: loaded?.session ?? candidate.header, ...digest, title });
            const last = digests[digests.length - 1];
            if (last && !last.goal && typeof last.title === 'string' && last.title.length > 0) {
                last.goal = last.title; // fall back to the session title
            }
        } catch (error) {
            digests.push({ header: candidate.header, turns: 0, goal: '', lastAsk: '', lastAnswer: '', tools: [], title: undefined, failed: String(error?.message ?? error) });
        }
    }

    const usable = digests.filter((entry) => entry.goal || entry.lastAnswer);
    if (usable.length === 0) return null;

    const header = '## 同工作区历史回顾（自动摘要，仅供参考）';
    const footer = `\n（完整版：${RECALL_DIR}/last.md · 取材自 ${usable.length} 个历史会话；如需细节请用 session_search）`;

    // Give every session a fair share, then hand the leftovers to the newest.
    const share = Math.max(160, Math.floor((opts.budgetChars - header.length - footer.length) / usable.length));
    let text = header;
    let used = 0;
    for (let index = 0; index < usable.length; index += 1) {
        const block = `\n${renderBlock(index + 1, usable[index], share, opts.includeTools)}`;
        if (used + block.length > opts.budgetChars - footer.length) break;
        text += block;
        used += block.length;
    }

    return { text: text + footer, sessions: usable.length };
}

function persist(cwd, recap) {
    try {
        const dir = join(resolve(cwd), RECALL_DIR);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'last.md'), `${recap.text}\n`);
        const stampName = new Date().toISOString().replace(/[:.]/g, '-');
        writeFileSync(join(dir, `recall-${stampName}.md`), `${recap.text}\n`);
    } catch {
        /* persistence is best-effort */
    }
}

export function apply(ctx, config = {}) {
    const opts = { ...DEFAULTS, ...(config ?? {}) };
    if (typeof createUserMessage !== 'function') {
        ctx.logger?.warn?.(`dsh-session-recall: @deepseek-ai/dsh-llm unavailable (${llmError ?? 'unknown'}); recap disabled`);
        return;
    }

    ctx.on('agent/session-start', async (payload) => {
        const agent = payload?.agent;
        const source = payload?.source;
        if (source === 'compaction') return; // a compacted session is not a fresh one
        const session = agent?.session;
        const cwd = session?.header?.cwd;
        if (!cwd) return;
        if ((session?.header?.delegationDepth ?? 0) > 0) return; // subagents do not need a recap

        const query = ctx.get?.('sessionQuery') ?? ctx.sessionQuery;
        if (!query || typeof query.listSessions !== 'function') return;

        try {
            const recap = await timeout(opts.timeoutMs, buildRecap(query, cwd, session.id, opts));
            if (!recap || recap.text.length === 0) return;
            persist(cwd, recap);
            agent.inject(
                createUserMessage({
                    content: [{ type: 'text', text: recap.text }],
                    source: { kind: `plugin:${name}` },
                }),
                session,
            );
        } catch (error) {
            ctx.logger?.warn?.(`dsh-session-recall: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
}

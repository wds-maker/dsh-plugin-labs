/**
 * dsh-reasoning-router — decide how hard the model should think.
 *
 * Given a piece of incoming text (a chat message, an IM line, a prompt), it
 * answers three questions with rules that are inspectable rather than opaque:
 *
 *   1. Is this casual conversation, or a task someone wants done?
 *   2. If it is a task, how hard is it (1–5)?
 *   3. Which reasoning effort fits — low / medium / high?
 *
 * The classifier is pure: no network, no model call, no hidden state. Every
 * verdict carries the signals that produced it, so a wrong call is debuggable.
 *
 * @module dsh-reasoning-router
 */

let defineTool;
let defineToolError;
try {
    ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
} catch (error) {
    defineToolError = error instanceof Error ? error.message : String(error);
}

export const name = 'dsh-reasoning-router';
export const inject = ['tools'];

/** Greetings, acknowledgements and social noise — conversation, not work. */
const CHAT_PATTERNS = [
    /^(你好|您好|嗨|哈喽|hello|hi|hey|在吗|在不在)[!！。~\s]*$/i,
    /^(谢谢|多谢|感谢|thanks|thank you|thx)[!！。~\s]*$/i,
    /^(好的|好|嗯|嗯嗯|收到|行|可以|ok|okay|👌)[!！。~\s]*$/i,
    /^(早安|早上好|晚安|中午好|下午好)[!！。~\s]*$/i,
    /^(哈哈|哈哈哈|笑死|😂|🤣|👍|🐟)+$/u,
    /^(你在干嘛|在做什么|吃了吗|今天怎么样)[?？!！。~\s]*$/,
];

/** Verbs that ask for work to be produced. */
const TASK_VERBS = [
    '帮我', '帮忙', '请你', '请帮', '给我', '麻烦你', '麻烦帮',
    '生成', '写一个', '写个', '写一份', '撰写', '起草', '编写',
    '修改', '改成', '改一下', '调整', '重构', '修复', '调试', '排查',
    '查询', '查一下', '查查', '搜索', '找一下', '列出', '整理', '归档',
    '分析', '对比', '比较', '总结', '汇总', '翻译', '解释一下',
    '安装', '部署', '运行', '执行', '测试', '跑一下', '启动',
    '设计', '实现', '开发', '做一个', '搞一个', '搭一个', '配置',
    '画一个', '画个', '制作', '转换', '导出', '导入', '计算', '统计',
];

/** Nouns that imply a deliverable artefact. */
const DELIVERABLES = [
    '文件', '代码', '脚本', '文档', '报告', '表格', '清单', '方案',
    'excel', 'word', 'ppt', 'pdf', 'markdown', '图片', '图表', '网页', '插件',
    '结构', '架构', '流程', '规范', '模板', '接口',
];

/** Design/architecture wording — these tasks need a plan before edits. */
const DESIGN_SCOPE = ['方案', '架构', '系统', '插件', '框架', '重构', '设计', '流程', '规范'];

/** Multi-step connectives: the task has stages. */
const STEP_MARKERS = ['然后', '接着', '之后', '其次', '最后', '并且', '同时', '再', 'step', '首先', '第一步'];

/** Explicit constraints: more constraints, more reasoning. */
const CONSTRAINTS = ['必须', '不要', '禁止', '要求', '限制', '兼容', '性能', '格式', '字数', '风格', '不能', '只能', '至少', '不超过'];

/** Technical surface that usually means real engineering. */
const TECH_MARKERS = ['api', '接口', '数据库', '并发', '算法', '正则', '编译', '依赖', 'docker', 'git', 'sql', 'http', 'json', 'yaml', 'cron', '内存', '性能', '安全'];

const EFFORT_BY_DIFFICULTY = {
    1: 'low',
    2: 'low',
    3: 'medium',
    4: 'high',
    5: 'high',
};

function hits(text, needles) {
    const lower = text.toLowerCase();
    return needles.filter((needle) => lower.includes(needle.toLowerCase()));
}

function countMatches(text, patterns) {
    return patterns.filter((pattern) => pattern.test(text)).length;
}

/**
 * Classify one piece of text.
 * @param {string} raw - the text to judge.
 * @returns {{kind: string, difficulty: number, effort: string, confidence: number, signals: string[], reason: string}}
 */
export function classify(raw) {
    const text = String(raw ?? '').trim();
    if (text.length === 0) {
        return { kind: 'chat', difficulty: 0, effort: 'low', confidence: 0.5, signals: ['empty text'], reason: 'empty input treated as conversation' };
    }

    const signals = [];

    const socialHits = countMatches(text, CHAT_PATTERNS);
    if (socialHits > 0) signals.push(`social pattern x${socialHits}`);

    const verbs = hits(text, TASK_VERBS);
    const deliverables = hits(text, DELIVERABLES);
    const steps = hits(text, STEP_MARKERS);
    const constraints = hits(text, CONSTRAINTS);
    const tech = hits(text, TECH_MARKERS);
    const hasCode = /```|\b[a-z_]+\(\)|[`$]\w/.test(text);
    const hasPath = /[A-Za-z]:\\|\/[\w.-]+\/|\.\w{2,4}\b/.test(text);
    const questionOnly = /^.{0,40}[?？]$/.test(text);

    if (verbs.length > 0) signals.push(`task verbs: ${verbs.slice(0, 4).join('/')}`);
    if (deliverables.length > 0) signals.push(`deliverables: ${deliverables.slice(0, 3).join('/')}`);
    if (steps.length > 0) signals.push(`multi-step: ${steps.slice(0, 3).join('/')}`);
    if (constraints.length > 0) signals.push(`constraints: ${constraints.slice(0, 3).join('/')}`);
    if (tech.length > 0) signals.push(`technical: ${tech.slice(0, 3).join('/')}`);
    if (hasCode) signals.push('code markup');
    if (hasPath) signals.push('path or filename');

    // ---- chat vs task -----------------------------------------------------
    let taskScore = 0;
    taskScore += Math.min(verbs.length, 3) * 2;
    taskScore += Math.min(deliverables.length, 2) * 2;
    taskScore += Math.min(steps.length, 2);
    taskScore += hasCode ? 2 : 0;
    if (text.length > 120) taskScore += 1;

    const isShortSocial = socialHits > 0 && text.length <= 20 && verbs.length === 0 && deliverables.length === 0;
    const isBareQuestion = questionOnly && verbs.length === 0 && deliverables.length === 0 && text.length <= 40;

    let kind;
    if (isShortSocial) kind = 'chat';
    else if (isBareQuestion && taskScore < 2) kind = 'chat';
    else kind = taskScore >= 2 ? 'task' : 'chat';

    if (kind === 'chat') {
        return {
            kind,
            difficulty: 0,
            effort: 'low',
            confidence: isShortSocial ? 0.95 : 0.7,
            signals: signals.length > 0 ? signals : ['no task markers'],
            reason: isShortSocial
                ? 'short social message with no request'
                : 'no request verb or deliverable — answering costs nothing',
        };
    }

    // ---- difficulty 1–5 ---------------------------------------------------
    let difficulty = 1;
    if (text.length > 150) difficulty += 1;
    if (text.length > 600) difficulty += 1;
    if (steps.length >= 2) difficulty += 1;
    if (constraints.length >= 2) difficulty += 1;
    if (tech.length >= 2 || hasCode) difficulty += 1;
    if (deliverables.length >= 2) difficulty += 1;
    if (hits(text, DESIGN_SCOPE).length >= 2) difficulty += 1;
    difficulty = Math.max(1, Math.min(5, difficulty));

    const effort = EFFORT_BY_DIFFICULTY[difficulty];
    const spread = taskScore + difficulty;
    const confidence = Math.min(0.95, 0.55 + spread * 0.05);

    return {
        kind: 'task',
        difficulty,
        effort,
        confidence: Number(confidence.toFixed(2)),
        signals,
        reason: `task score ${taskScore}, difficulty ${difficulty}: ${signals.slice(0, 3).join('; ') || 'generic request'}`,
    };
}

/** Human-readable report used by the tool surface. */
export function renderReport(text, verdict) {
    const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
    return [
        `text: ${JSON.stringify(preview)}`,
        `kind: ${verdict.kind}`,
        `difficulty: ${verdict.difficulty}/5`,
        `reasoningEffort: ${verdict.effort}`,
        `confidence: ${verdict.confidence}`,
        `signals: ${verdict.signals.join(' | ') || '(none)'}`,
        `reason: ${verdict.reason}`,
    ].join('\n');
}

export const POLICY = [
    ['chat', '0', 'low', '闲聊不推理：直接自然回复'],
    ['task', '1–2', 'low', '单一、机械的小活：一次做对即可'],
    ['task', '3', 'medium', '多步骤或有约束：需要计划，但不必穷举'],
    ['task', '4–5', 'high', '复杂/多约束/涉及代码与调试：充分推理再动手'],
];

export function apply(ctx) {
    if (typeof defineTool !== 'function') {
        ctx.logger?.warn?.(`dsh-reasoning-router: @deepseek-ai/dsh-tools unavailable (${defineToolError ?? 'unknown'}); tools not registered`);
        return;
    }
    const register = (spec) => ctx.tools.register(defineTool(spec));

    const SIMPLE = {
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                ok: { type: 'boolean', required: true },
                detail: { type: 'string', required: true },
            },
        },
        render: (_args, value) => [{ type: 'text', text: value.detail }],
    };

    register({
        name: 'route_text',
        description:
            'Judge one incoming text: is it chat or a task, how hard is the task (1–5), and which reasoning effort fits. Returns the signals behind the verdict so a wrong call is explainable.',
        parameters: {
            text: { type: 'string', required: true, description: 'The message or prompt to classify.' },
        },
        output: SIMPLE,
        async execute(args) {
            const text = String(args.text ?? '');
            return { ok: true, detail: renderReport(text, classify(text)) };
        },
    });

    register({
        name: 'route_json',
        description: 'Same verdict as route_text, as one compact JSON object for chaining into other tools.',
        parameters: {
            text: { type: 'string', required: true, description: 'The message or prompt to classify.' },
        },
        output: SIMPLE,
        async execute(args) {
            const text = String(args.text ?? '');
            return { ok: true, detail: JSON.stringify({ text: text.slice(0, 120), ...classify(text) }) };
        },
    });

    register({
        name: 'route_policy',
        description: 'Show the chat/task → difficulty → reasoning-effort mapping this plugin applies.',
        parameters: {},
        output: SIMPLE,
        async execute() {
            const rows = POLICY.map(([kind, difficulty, effort, note]) => `${kind}\tdifficulty ${difficulty}\t→ ${effort}\t${note}`);
            return { ok: true, detail: ['kind\tdifficulty\teffort\tnote', ...rows].join('\n') };
        },
    });
}

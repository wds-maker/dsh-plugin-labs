// Contract for buildRecap(): same-workspace selection, exclusion of the current
// session, and the character budget. Built entirely on a mock sessionQuery, so
// no model, no disk, no DSH runtime is required.
import assert from 'node:assert/strict';
import test from 'node:test';

const { buildRecap, name, inject } = await import('../lib/index.js');

const CWD = 'C:/work/project';
const OPTS = { maxSessions: 3, budgetChars: 1600, timeoutMs: 8000, includeTools: true };

function textEvent(type, text) {
    return { type, data: { message: { content: [{ type: 'text', text }] } } };
}

function session(id, cwd, createdAt, events, title) {
    return {
        id,
        header: { cwd, createdAt },
        events,
        title,
    };
}

/** Build a sessionQuery stub from plain records. */
function queryOf(records) {
    const byId = new Map(records.map((record) => [record.id, record]));
    return {
        async listSessions() {
            return records.map(({ id, header }) => ({ id, header }));
        },
        async readSession(id) {
            const record = byId.get(id);
            return { session: record.header, events: record.events };
        },
        async readTitle(id) {
            return byId.get(id).title;
        },
    };
}

test('plugin surface is complete', () => {
    assert.equal(name, 'dsh-session-recall');
    assert.deepEqual(inject, []);
});

test('no candidate in this workspace returns null', async () => {
    const query = queryOf([session('a', 'C:/elsewhere', 1, [])]);
    assert.equal(await buildRecap(query, CWD, 'current', OPTS), null);
});

test('the current session is never quoted back to itself', async () => {
    const query = queryOf([session('current', CWD, 1, [])]);
    assert.equal(await buildRecap(query, CWD, 'current', OPTS), null);
});

test('recap carries goal, conclusion and tool names', async () => {
    const query = queryOf([
        session('old', CWD, 1000, [
            { type: 'turn/start' },
            textEvent('user/message', '把插件发到 GitHub'),
            { type: 'tool/call', data: { name: 'git_push' } },
            { type: 'tool/call', data: { name: 'ops_bash' } },
            textEvent('assistant/message', '已推到远程，CI 通过'),
        ], '发布插件'),
    ]);
    const recap = await buildRecap(query, CWD, 'current', OPTS);
    assert.ok(recap, 'recap expected');
    assert.equal(recap.sessions, 1);
    assert.match(recap.text, /同工作区历史回顾/);
    assert.match(recap.text, /把插件发到 GitHub/);
    assert.match(recap.text, /已推到远程，CI 通过/);
    assert.match(recap.text, /git_push/);
    assert.match(recap.text, /发布插件/);
});

test('sessions are ordered newest-first and capped by maxSessions', async () => {
    const records = ['s1', 's2', 's3', 's4'].map((id, index) =>
        session(id, CWD, 1000 + index, [textEvent('user/message', `目标 ${id}`)], undefined),
    );
    const recap = await buildRecap(queryOf(records), CWD, 'current', { ...OPTS, maxSessions: 2 });
    assert.ok(recap);
    assert.equal(recap.sessions, 2);
    assert.ok(recap.text.indexOf('目标 s4') < recap.text.indexOf('目标 s3'), 'newest first');
    assert.ok(!recap.text.includes('目标 s1'));
});

test('the recap respects the character budget', async () => {
    const long = 'x'.repeat(4000);
    const records = [session('long', CWD, 1000, [textEvent('user/message', long), textEvent('assistant/message', long)], undefined)];
    const recap = await buildRecap(queryOf(records), CWD, 'current', { ...OPTS, budgetChars: 600 });
    assert.ok(recap);
    assert.ok(recap.text.length <= 600, `recap is ${recap.text.length} chars, budget 600`);
});

test('a broken session is skipped instead of aborting the recap', async () => {
    const query = {
        async listSessions() {
            return [
                { id: 'broken', header: { cwd: CWD, createdAt: 2000 } },
                { id: 'good', header: { cwd: CWD, createdAt: 1000 } },
            ];
        },
        async readSession(id) {
            if (id === 'broken') throw new Error('corrupt log');
            return { session: { cwd: CWD, createdAt: 1000 }, events: [textEvent('assistant/message', '好的一面')] };
        },
        async readTitle() {
            return undefined;
        },
    };
    const recap = await buildRecap(query, CWD, 'current', OPTS);
    assert.ok(recap, 'one good session must still produce a recap');
    assert.match(recap.text, /好的一面/);
});

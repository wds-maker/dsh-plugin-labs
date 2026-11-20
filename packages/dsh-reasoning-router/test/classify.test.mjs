// Contract for classify(): the verdicts that the README documents must be the
// verdicts the code produces. Pure function, no I/O, no network.
import assert from 'node:assert/strict';
import test from 'node:test';

const { classify, renderReport, POLICY, name, inject } = await import('../lib/index.js');

test('plugin surface is complete', () => {
    assert.equal(name, 'dsh-reasoning-router');
    assert.deepEqual(inject, ['tools']);
});

test('empty input is treated as conversation', () => {
    const verdict = classify('');
    assert.equal(verdict.kind, 'chat');
    assert.equal(verdict.difficulty, 0);
    assert.equal(verdict.effort, 'low');
});

test('a short greeting is chat with high confidence', () => {
    for (const text of ['你好', '在吗', '谢谢', 'ok']) {
        const verdict = classify(text);
        assert.equal(verdict.kind, 'chat', `${text} should be chat`);
        assert.equal(verdict.effort, 'low');
        assert.equal(verdict.confidence, 0.95);
    }
});

test('a single mechanical request is a low-effort task', () => {
    const verdict = classify('帮我写一个脚本');
    assert.equal(verdict.kind, 'task');
    assert.equal(verdict.difficulty, 1);
    assert.equal(verdict.effort, 'low');
    assert.ok(verdict.signals.some((s) => s.includes('task verbs')), 'signals must name the verbs');
});

test('multi-step + constraint work is a medium task', () => {
    const verdict = classify('帮我把 Excel 重复行删掉，然后按日期排序，最后导出 CSV，不要改原文件');
    assert.equal(verdict.kind, 'task');
    assert.equal(verdict.difficulty, 3);
    assert.equal(verdict.effort, 'medium');
    assert.ok(verdict.signals.some((s) => s.includes('multi-step')));
    assert.ok(verdict.signals.some((s) => s.includes('constraints')));
});

test('design + tech + multi-constraint work tops out at high effort', () => {
    const verdict = classify(
        '帮我用 TypeScript 设计一个插件架构，要求支持动态加载、错误重试和并发控制，然后写测试，最后出文档，兼容 Node 20 和 Deno',
    );
    assert.equal(verdict.kind, 'task');
    assert.equal(verdict.difficulty, 5);
    assert.equal(verdict.effort, 'high');
});

test('difficulty never leaves the 1–5 band and effort follows the table', () => {
    const texts = [
        '生成一张图片',
        '帮我分析这段代码为什么偶尔崩溃，然后给出修复方案，不要改动公开 API，最后补上测试',
        '你好'.repeat(200),
    ];
    for (const text of texts) {
        const verdict = classify(text);
        assert.ok(verdict.difficulty >= 0 && verdict.difficulty <= 5, `difficulty out of band for: ${text.slice(0, 20)}`);
        const expected = { 0: 'low', low: 'low', medium: 'medium', high: 'high' };
        assert.ok(verdict.effort in expected, `unknown effort ${verdict.effort}`);
    }
});

test('renderReport exposes every field a reviewer needs', () => {
    const text = '帮我写一个脚本';
    const report = renderReport(text, classify(text));
    for (const label of ['kind:', 'difficulty:', 'reasoningEffort:', 'confidence:', 'signals:', 'reason:']) {
        assert.ok(report.includes(label), `report missing ${label}`);
    }
});

test('POLICY documents the same mapping the code applies', () => {
    assert.deepEqual(POLICY[0], ['chat', '0', 'low', '闲聊不推理：直接自然回复']);
    assert.ok(POLICY.length >= 4);
});

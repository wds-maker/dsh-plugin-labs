// Loader acceptance probe: the module must import cleanly as ESM and export
// the cordis plugin surface (name / inject / apply / ensureComfyUi).
import assert from 'node:assert/strict';
import test from 'node:test';

const mod = await import('../lib/index.js');

test('plugin surface is complete', () => {
    const keys = Object.keys(mod).sort();
    assert.ok(keys.includes('name'), 'name export');
    assert.ok(keys.includes('apply'), 'apply export');
    assert.ok(keys.includes('inject'), 'inject export');
    assert.ok(keys.includes('ensureComfyUi'), 'ensureComfyUi export');
    assert.equal(mod.name, 'dsh-comfyui-autostart');
    assert.deepEqual(mod.inject, []);
});

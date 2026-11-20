// Unit contract for ensureComfyUi(): every branch must resolve (never throw)
// and must report a reason the operator can act on.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { ensureComfyUi } = await import('../lib/index.js');

const scratch = mkdtempSync(join(tmpdir(), 'autostart-test-'));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test('missing python interpreter is reported, not thrown', async () => {
    const result = await ensureComfyUi({
        python: join(scratch, 'no-such-python.exe'),
        script: join(scratch, 'main.py'),
        cwd: scratch,
        port: 59991,
    });
    assert.equal(result.started, false);
    assert.match(result.reason, /python not found/);
});

test('missing ComfyUI entry script is reported, not thrown', async () => {
    const fakePython = join(scratch, 'python-ok.exe');
    // existsSync() is the only check on the interpreter, so an empty file is enough.
    await import('node:fs').then(({ writeFileSync }) => writeFileSync(fakePython, ''));
    const result = await ensureComfyUi({
        python: fakePython,
        script: join(scratch, 'main.py'),
        cwd: scratch,
        port: 59992,
    });
    assert.equal(result.started, false);
    assert.match(result.reason, /main\.py not found/);
});

test('an already-listening port is never spawned a second time', async () => {
    const server = net.createServer(() => {});
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const fakePython = join(scratch, 'python-ok.exe');
    const fakeScript = join(scratch, 'main.py');
    await import('node:fs').then(({ writeFileSync }) => {
        writeFileSync(fakePython, '');
        writeFileSync(fakeScript, '');
    });

    try {
        const result = await ensureComfyUi({ python: fakePython, script: fakeScript, cwd: scratch, port });
        assert.equal(result.started, false);
        assert.match(result.reason, /already running/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
});

// End-to-end contract: ensureComfyUi() must bring a real ComfyUI up when it is
// down. This spawns a real server and waits up to 120s, so it is opt-in:
//
//   COMFYUI_E2E=1 node integration/autostart.integration.mjs
//
// It requires a working ComfyUI install at the configured path (see
// cordis.patch.yml). Never run it on CI.
import net from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 8188;
const MODULE = new URL('../lib/index.js', import.meta.url);

if (process.env.COMFYUI_E2E !== '1') {
    console.log('SKIP: set COMFYUI_E2E=1 to run the end-to-end ComfyUI spawn test.');
    process.exit(0);
}

function portOpen(host, port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const done = (value) => {
            try { socket.destroy(); } catch { /* ignore */ }
            resolve(value);
        };
        socket.setTimeout(700);
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        socket.once('timeout', () => done(false));
    });
}

const startedAt = Date.now();

if (await portOpen(HOST, PORT)) {
    console.log('SKIP: ComfyUI is already running; stop it first to exercise the spawn path.');
    process.exit(0);
}

const mod = await import(MODULE);
if (typeof mod.ensureComfyUi !== 'function') {
    console.error('FAIL: lib/index.js does not export ensureComfyUi');
    process.exit(1);
}

const result = await mod.ensureComfyUi({ host: HOST, port: PORT });
for (let i = 0; i < 60; i += 1) {
    if (await portOpen(HOST, PORT)) {
        console.log(`PASS: ComfyUI up after ${Math.round((Date.now() - startedAt) / 1000)}s (${JSON.stringify(result)})`);
        process.exit(0);
    }
    await sleep(2000);
}
console.error('FAIL: ComfyUI did not start within 120s');
process.exit(1);

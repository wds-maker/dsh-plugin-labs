/**
 * dsh-comfyui-autostart — bring the local ComfyUI server up together with DSH.
 *
 * Why this exists: dsh-comfyui-bridge talks to a ComfyUI server over HTTP, but
 * nothing guarantees that server is running. Starting it by hand every time is
 * the usual failure mode ("connection refused" right after boot). This plugin
 * runs once when the DSH bundle tree starts, checks the port, and spawns
 * ComfyUI detached if it is not already listening.
 *
 * Design constraints:
 * - Never block DSH boot: the check and the spawn are fire-and-forget, every
 *   error is swallowed and only logged.
 * - Never spawn a second server: the port probe runs before the spawn.
 * - The child is detached, so it keeps running (and keeps holding models in
 *   VRAM) after DSH exits; the next boot simply finds the port open.
 *
 * @module dsh-comfyui-autostart
 */

import { spawn } from 'node:child_process';
import { existsSync, openSync, writeFileSync } from 'node:fs';
import net from 'node:net';

export const name = 'dsh-comfyui-autostart';
export const inject = [];

const DEFAULTS = {
    python: 'D:/ComfyUI/.venv/Scripts/python.exe',
    script: 'D:/ComfyUI/main.py',
    cwd: 'D:/ComfyUI',
    host: '127.0.0.1',
    port: 8188,
    logFile: 'D:/ComfyUI/comfyui-autostart.log',
    stateFile: 'D:/ComfyUI/comfyui-autostart.state.json',
};

function writeState(file, payload) {
    try {
        writeFileSync(file, `${JSON.stringify({ ...payload, at: new Date().toISOString() }, null, 2)}\n`);
    } catch {
        /* a missing state file must never break boot */
    }
}

function isPortOpen(host, port, timeoutMs = 800) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });
        const done = (value) => {
            try {
                socket.destroy();
            } catch {
                /* ignore */
            }
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        socket.once('timeout', () => done(false));
    });
}

/**
 * Make sure ComfyUI is listening. Resolves with a small result object; it never
 * throws, so a broken install can never take DSH down with it.
 *
 * @param {Partial<typeof DEFAULTS>} [config]
 * @returns {Promise<{started: boolean, reason: string, pid?: number}>}
 */
export async function ensureComfyUi(config = {}) {
    const opts = { ...DEFAULTS, ...(config ?? {}) };
    try {
        if (!existsSync(opts.python)) {
            return { started: false, reason: `python not found: ${opts.python}` };
        }
        if (!existsSync(opts.script)) {
            return { started: false, reason: `main.py not found: ${opts.script}` };
        }
        if (await isPortOpen(opts.host, opts.port)) {
            return { started: false, reason: `already running on ${opts.host}:${opts.port}` };
        }
        const fd = openSync(opts.logFile, 'a');
        const child = spawn(
            opts.python,
            [opts.script, '--listen', opts.host, '--port', String(opts.port)],
            {
                cwd: opts.cwd,
                detached: true,
                stdio: ['ignore', fd, fd],
                windowsHide: true,
            },
        );
        child.unref();
        return { started: true, reason: 'spawned', pid: child.pid };
    } catch (error) {
        return { started: false, reason: error instanceof Error ? error.message : String(error) };
    }
}

export function apply(ctx, config = {}) {
    const opts = { ...DEFAULTS, ...(config ?? {}) };
    const log = (level, message) => {
        try {
            ctx?.logger?.[level]?.(`dsh-comfyui-autostart: ${message}`);
        } catch {
            /* logging must never throw */
        }
    };
    writeState(opts.stateFile, { phase: 'apply' });
    void ensureComfyUi(opts).then((result) => {
        writeState(opts.stateFile, { phase: 'done', ...result });
        if (result.started) {
            log('info', `started ComfyUI (pid ${result.pid})`);
        } else if (result.reason.startsWith('already running')) {
            log('info', `ComfyUI ${result.reason}`);
        } else {
            log('warn', `ComfyUI not started: ${result.reason}`);
        }
    });
}

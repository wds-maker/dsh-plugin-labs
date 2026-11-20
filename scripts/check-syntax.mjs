// Static smoke check: every package entry point must import cleanly and expose
// the Cordis plugin surface (a named export `name`). No DSH runtime required —
// the packages import their optional peer modules inside try/catch.
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

const packagesDir = new URL('../packages/', import.meta.url);
const entries = await readdir(packagesDir, { withFileTypes: true });
const packages = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

assert.ok(packages.length > 0, 'no packages found');

const failures = [];
for (const pkg of packages) {
    const entry = new URL(`../packages/${pkg}/lib/index.js`, import.meta.url);
    try {
        const mod = await import(entry);
        assert.equal(typeof mod.name, 'string', `${pkg}: missing string export "name"`);
        assert.equal(typeof mod.apply, 'function', `${pkg}: missing function export "apply"`);
        assert.ok(Array.isArray(mod.inject), `${pkg}: "inject" must be an array`);
        console.log(`ok   ${pkg} -> ${mod.name}`);
    } catch (error) {
        failures.push(`${pkg}: ${error instanceof Error ? error.message : String(error)}`);
        console.error(`fail ${pkg}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

if (failures.length > 0) {
    console.error(`\n${failures.length} package(s) failed the surface check`);
    process.exit(1);
}
console.log(`\nall ${packages.length} package(s) expose the plugin surface`);

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(import.meta.dirname!, '..');
const cliBin = path.join(root, 'packages/cli/dist/bin.js');
const polytope = path.join(root, 'fixtures/static/archives/Polytope_URP.unitypackage');
const minimal = path.join(root, 'fixtures/generated/minimal.unitypackage');
const nested = path.join(root, 'fixtures/generated/nested.unitypackage');

interface ExecResult { code: number; stdout: string; stderr: string }

function bun(args: string[]): ExecResult {
  try {
    const stdout = execFileSync('bun', args, { encoding: 'utf-8', cwd: root });
    return { code: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

function log(ok: boolean, label: string, detail?: string): void {
  const mark = ok ? '\u2713' : '\u2717';
  process.stdout.write(`  ${mark} ${label}`);
  if (detail) process.stdout.write(`  (${detail})`);
  process.stdout.write('\n');
}

const tests: Array<{ name: string; run(): boolean }> = [];

tests.push({
  name: 'inspect Polytope --json',
  run: () => {
    const r = bun([cliBin, 'inspect', polytope, '--json']);
    const ok = r.code === 0;
    if (ok) {
      try { JSON.parse(r.stdout); } catch { return false; }
    }
    return ok;
  },
});

tests.push({
  name: 'verify Polytope',
  run: () => {
    const r = bun([cliBin, 'verify', polytope]);
    return r.code === 0;
  },
});

tests.push({
  name: 'fixtures-build',
  run: () => {
    const r = bun(['scripts/fixtures-build.ts']);
    return r.code === 0;
  },
});

tests.push({
  name: 'diff minimal vs nested --json',
  run: () => {
    const r = bun([cliBin, 'diff', minimal, nested, '--json']);
    if (r.code !== 0) return false;
    try {
      const d = JSON.parse(r.stdout) as { summary: { added: number; removed: number; changed: number } };
      return d.summary.added + d.summary.removed + d.summary.changed > 0;
    } catch { return false; }
  },
});

tests.push({
  name: 'diff minimal vs minimal --json (identical)',
  run: () => {
    const r = bun([cliBin, 'diff', minimal, minimal, '--json']);
    if (r.code !== 0) return false;
    try {
      const d = JSON.parse(r.stdout) as { summary: { added: number; removed: number; changed: number } };
      return d.summary.added === 0 && d.summary.removed === 0 && d.summary.changed === 0;
    } catch { return false; }
  },
});

tests.push({
  name: 'extract Polytope --filter **/*.shader',
  run: () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitypackage-smoke-'));
    const r = bun([cliBin, 'extract', polytope, tmp, '--filter', '**/*.shader']);
    if (r.code !== 0) return false;
    const files: string[] = [];
    walkDir(tmp, files);
    fs.rmSync(tmp, { recursive: true, force: true });
    return files.length > 0;
  },
});

tests.push({
  name: 'extract Polytope --filter **/*.shader --merge',
  run: () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unitypackage-smoke-'));
    const r = bun([cliBin, 'extract', polytope, tmp, '--filter', '**/*.shader', '--merge']);
    if (r.code !== 0) return false;
    const files: string[] = [];
    walkDir(tmp, files);
    fs.rmSync(tmp, { recursive: true, force: true });
    return files.length > 0;
  },
});

function walkDir(dir: string, acc: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, acc);
    else acc.push(full);
  }
}

console.log('Smoke tests:\n');

let passed = 0;
let failed = 0;

for (const t of tests) {
  let ok: boolean;
  try { ok = t.run(); } catch { ok = false; }
  log(ok, t.name);
  if (ok) passed++;
  else failed++;
}

const total = passed + failed;
console.log(`\nResult: ${passed}/${total} passed`);
if (failed > 0) process.exit(1);

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { getMeta, openDb } from '../src/db/client.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ol-test-'));
const cli = (dataDir: string, ...args: string[]) =>
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    env: { ...process.env, DATA_DIR: dataDir, OL_PASSWORD: 'a long password', NODE_ENV: 'test' },
    encoding: 'utf8',
  });

describe('database', () => {
  it('migrations are idempotent and the epoch persists', () => {
    const dir = tmp();
    const file = path.join(dir, 'library.db');
    const a = openDb(file);
    const epoch = getMeta(a, 'epoch');
    a.$client.close();
    const b = openDb(file);
    expect(getMeta(b, 'epoch')).toBe(epoch);
    expect(b.$client.pragma('journal_mode', { simple: true })).toBe('wal');
    b.$client.close();
  });
});

describe('admin CLI', () => {
  it('set-password, backup, after-restore and check', () => {
    const dir = tmp();
    expect(cli(dir, 'set-password')).toContain('Password created');
    const out = path.join(dir, 'backups', 'snap.db');
    expect(cli(dir, 'backup', out)).toContain('Backup created');

    // The copy is a valid DB with the owner and the same epoch.
    const copy = openDb(out);
    const original = openDb(path.join(dir, 'library.db'));
    expect(getMeta(copy, 'epoch')).toBe(getMeta(original, 'epoch'));
    expect(copy.$client.prepare('select count(*) n from owner').get()).toEqual({ n: 1 });
    const before = getMeta(original, 'epoch');
    copy.$client.close();
    original.$client.close();

    expect(cli(dir, 'after-restore')).toContain('New epoch');
    const after = openDb(path.join(dir, 'library.db'));
    expect(getMeta(after, 'epoch')).not.toBe(before);
    after.$client.close();
    expect(cli(dir, 'check')).toContain('Integrity: ok');
  });
});

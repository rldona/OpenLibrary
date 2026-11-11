import fs from 'node:fs';
import path from 'node:path';

/** The unprivileged account of the official Node images. */
export const APP_UID = 1000;
export const APP_GID = 1000;

type Proc = Pick<NodeJS.Process, 'getuid' | 'setuid' | 'setgid' | 'setgroups'>;
type Fs = Pick<typeof fs, 'mkdirSync' | 'lstatSync' | 'lchownSync' | 'readdirSync'>;

/**
 * When started as root (Railway mounts volumes owned by root and `railway ssh` runs as root),
 * hands the data folder to the app account and drops to it before any file is opened.
 * Everything the server or the CLI creates afterwards in `dataDir` is owned by that account.
 * Not root: does nothing. Returns whether privileges were dropped.
 */
export function dropPrivileges(
  dataDir: string,
  opts: { proc?: Proc; fs?: Fs; uid?: number; gid?: number } = {},
): boolean {
  const proc = opts.proc ?? process;
  const f = opts.fs ?? fs;
  const uid = opts.uid ?? APP_UID;
  const gid = opts.gid ?? APP_GID;
  if (proc.getuid?.() !== 0) return false;

  f.mkdirSync(dataDir, { recursive: true });
  const top = f.lstatSync(dataDir);
  // Already right: the usual case on every boot after the first one, no tree walk.
  if (top.uid !== uid || top.gid !== gid) chownTree(f, dataDir, uid, gid);

  proc.setgroups?.([gid]);
  proc.setgid?.(gid);
  proc.setuid?.(uid);
  return true;
}

function chownTree(f: Fs, p: string, uid: number, gid: number): void {
  const st = f.lstatSync(p);
  if (st.uid !== uid || st.gid !== gid) f.lchownSync(p, uid, gid);
  if (st.isDirectory()) {
    for (const name of f.readdirSync(p)) chownTree(f, path.join(p, name), uid, gid);
  }
}

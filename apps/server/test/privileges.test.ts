import { describe, expect, it } from 'vitest';
import { dropPrivileges } from '../src/privileges.js';

type Node = { uid: number; gid: number; children?: string[] };

function fakeFs(tree: Record<string, Node>) {
  const chowned: string[] = [];
  const fs = {
    mkdirSync: () => undefined,
    lstatSync: (p: string) => {
      const n = tree[p]!;
      return { uid: n.uid, gid: n.gid, isDirectory: () => !!n.children };
    },
    lchownSync: (p: string, uid: number, gid: number) => {
      chowned.push(p);
      tree[p] = { ...tree[p]!, uid, gid };
    },
    readdirSync: (p: string) => tree[p]!.children ?? [],
  };
  return { fs: fs as never, chowned };
}

function fakeProc(uid: number) {
  const calls: string[] = [];
  return {
    calls,
    proc: {
      getuid: () => uid,
      setgroups: (g: number[]) => void calls.push(`groups ${g.join(',')}`),
      setgid: (g: number) => void calls.push(`gid ${g}`),
      setuid: (u: number) => void calls.push(`uid ${u}`),
    } as never,
  };
}

describe('dropPrivileges', () => {
  it('does nothing when not root', () => {
    const { fs, chowned } = fakeFs({ '/data': { uid: 0, gid: 0, children: [] } });
    const { proc, calls } = fakeProc(1000);
    expect(dropPrivileges('/data', { proc, fs })).toBe(false);
    expect(chowned).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('as root, hands a root-owned data folder to the app account and drops to it', () => {
    const { fs, chowned } = fakeFs({
      '/data': { uid: 0, gid: 0, children: ['library.db', 'assets'] },
      '/data/library.db': { uid: 0, gid: 0 },
      '/data/assets': { uid: 1000, gid: 1000, children: ['a.jpg'] },
      '/data/assets/a.jpg': { uid: 0, gid: 0 },
    });
    const { proc, calls } = fakeProc(0);
    expect(dropPrivileges('/data', { proc, fs })).toBe(true);
    expect(chowned).toEqual(['/data', '/data/library.db', '/data/assets/a.jpg']);
    // Groups and gid first: after setuid there is no permission left to change them.
    expect(calls).toEqual(['groups 1000', 'gid 1000', 'uid 1000']);
  });

  it('as root, does not walk the tree when the folder is already owned by the app account', () => {
    const { fs, chowned } = fakeFs({
      '/data': { uid: 1000, gid: 1000, children: ['library.db'] },
      '/data/library.db': { uid: 0, gid: 0 },
    });
    const { proc, calls } = fakeProc(0);
    dropPrivileges('/data', { proc, fs });
    expect(chowned).toEqual([]);
    expect(calls).toContain('uid 1000');
  });
});

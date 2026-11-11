import { describe, expect, it } from 'vitest';
import { PasswordGate } from '../src/auth/gate.js';

/** A password check that finishes when the test says so. */
function deferred() {
  let done!: (v: boolean) => void;
  const p = new Promise<boolean>((r) => (done = r));
  return { check: () => p, done };
}

const tick = () => new Promise((r) => setImmediate(r));

describe('password check gate', () => {
  it('runs at most `concurrency` checks at once, in arrival order', async () => {
    const gate = new PasswordGate({ concurrency: 2, maxQueue: 10 });
    const started: string[] = [];
    const checks = ['a', 'b', 'c', 'd'].map((ip) => {
      const d = deferred();
      const r = gate.run(ip, false, () => (started.push(ip), d.check()));
      return { d, r };
    });
    await tick();
    expect(started).toEqual(['a', 'b']);
    expect(gate.waiting).toBe(2);
    checks[0]!.d.done(false);
    await tick();
    expect(started).toEqual(['a', 'b', 'c']);
    checks[1]!.d.done(true);
    checks[2]!.d.done(false);
    await tick();
    expect(started).toEqual(['a', 'b', 'c', 'd']);
    checks[3]!.d.done(true);
    expect(await Promise.all(checks.map((c) => c.r))).toEqual([false, true, false, true]);
    expect(gate.waiting).toBe(0);
  });

  it('allows one check in flight per address', async () => {
    const gate = new PasswordGate({ concurrency: 2, maxQueue: 10 });
    const d = deferred();
    const first = gate.run('a', false, d.check);
    expect(await gate.run('a', false, async () => true)).toBe('busy-address');
    d.done(true);
    expect(await first).toBe(true);
    expect(await gate.run('a', false, async () => true)).toBe(true);
  });

  it('turns unknown addresses away when the queue is full, but always admits known ones first', async () => {
    const gate = new PasswordGate({ concurrency: 1, maxQueue: 3 });
    const order: string[] = [];
    const running = deferred();
    const busy = gate.run('x0', false, () => (order.push('x0'), running.check()));
    const queued = [1, 2, 3].map((i) => gate.run(`x${i}`, false, async () => (order.push(`x${i}`), false)));
    expect(await gate.run('x4', false, async () => false)).toBe('busy-queue');
    // The owner, from an address that signed in before: next in line despite the flood.
    const owner = gate.run('owner', true, async () => (order.push('owner'), true));
    running.done(false);
    expect(await owner).toBe(true);
    await Promise.all([busy, ...queued]);
    expect(order).toEqual(['x0', 'owner', 'x1', 'x2', 'x3']);
  });

  it('a failing check frees its slot', async () => {
    const gate = new PasswordGate({ concurrency: 1, maxQueue: 3 });
    await expect(gate.run('a', false, async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate.run('a', false, async () => true)).toBe(true);
  });
});

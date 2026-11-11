/**
 * Admission for password checks (each one is an Argon2id verification, ~100 ms of CPU).
 * It replaces a global lockout, which strangers could use to keep the owner out: instead, checks
 * wait in a short FIFO queue, so a flood of wrong passwords degrades into a bounded delay.
 *  - At most `concurrency` verifications run at once: the rest of the API keeps its CPU.
 *  - One check in flight per address: a single address cannot fill the queue.
 *  - At most `maxQueue` waiting checks from unknown addresses; beyond that they are turned away
 *    (429, retry in a couple of seconds).
 *  - Known addresses (a successful sign-in recently) are always admitted, ahead of unknown ones.
 */
export type GateOptions = { concurrency: number; maxQueue: number };

export const GATE: GateOptions = { concurrency: 2, maxQueue: 64 };

export type Admission = 'busy-address' | 'busy-queue';

type Waiter = { start: () => void };

export class PasswordGate {
  private running = 0;
  private readonly known: Waiter[] = [];
  private readonly unknown: Waiter[] = [];
  private readonly inFlight = new Set<string>();

  constructor(private readonly opts: GateOptions = GATE) {}

  /** Runs `check` when a slot is free, or says why it was not admitted. */
  async run<T>(ip: string, known: boolean, check: () => Promise<T>): Promise<T | Admission> {
    if (this.inFlight.has(ip)) return 'busy-address';
    if (!known && this.unknown.length >= this.opts.maxQueue) return 'busy-queue';
    this.inFlight.add(ip);
    try {
      if (this.running >= this.opts.concurrency) {
        await new Promise<void>((start) => (known ? this.known : this.unknown).push({ start }));
      } else {
        this.running++;
      }
      try {
        return await check();
      } finally {
        this.release();
      }
    } finally {
      this.inFlight.delete(ip);
    }
  }

  /** Waiting checks (for tests and logs). */
  get waiting(): number {
    return this.known.length + this.unknown.length;
  }

  private release(): void {
    const next = this.known.shift() ?? this.unknown.shift();
    // The slot passes straight to the next waiter: `running` stays the same.
    if (next) next.start();
    else this.running--;
  }
}

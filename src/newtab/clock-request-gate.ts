interface ClockRequestLease {
  readonly instanceId: string;
  readonly completionToken: string | null;
}

interface Cooldown {
  token: string;
  retryAt: number;
}

/**
 * Page-scoped clock requests survive DOM rebuilds. The same instance cannot
 * dispatch another mutation until both the worker action and refresh settle.
 * An expired completion token may retry, but never in an immediate loop.
 */
export class ClockRequestGate {
  private readonly pending = new Map<string, ClockRequestLease>();
  private readonly cooldowns = new Map<string, Cooldown>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly retryDelayMs = 1_000,
  ) {}

  isPending(instanceId: string): boolean {
    return this.pending.has(instanceId);
  }

  canComplete(instanceId: string, token: string): boolean {
    if (this.isPending(instanceId)) return false;
    const cooldown = this.cooldowns.get(instanceId);
    return !cooldown || cooldown.token !== token || this.now() >= cooldown.retryAt;
  }

  begin(instanceId: string, completionToken: string | null = null): ClockRequestLease | null {
    if (this.isPending(instanceId)) return null;
    if (completionToken !== null && !this.canComplete(instanceId, completionToken)) return null;
    const now = this.now();
    for (const [id, cooldown] of this.cooldowns) {
      if (now >= cooldown.retryAt) this.cooldowns.delete(id);
    }
    const lease = { instanceId, completionToken };
    this.pending.set(instanceId, lease);
    return lease;
  }

  finish(lease: ClockRequestLease): void {
    if (this.pending.get(lease.instanceId) !== lease) return;
    this.pending.delete(lease.instanceId);
    if (lease.completionToken !== null) {
      this.cooldowns.set(lease.instanceId, { token: lease.completionToken, retryAt: this.now() + this.retryDelayMs });
    }
  }
}

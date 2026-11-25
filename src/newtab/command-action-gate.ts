/** Reset commands may be exposed by several widgets, or rebuilt while a
 * worker acknowledgement is pending. Keep one lease for all destructive
 * commands on this page, not one lease per DOM button. */
export class CommandActionGate {
  private active = false;
  private readonly listeners = new Set<(pending: boolean) => void>();
  get pending(): boolean { return this.active; }

  subscribe(listener: (pending: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.active);
    return () => { this.listeners.delete(listener); };
  }

  private setPending(value: boolean): void {
    this.active = value;
    for (const listener of this.listeners) listener(value);
  }

  async run(confirm: () => boolean, mutate: () => Promise<unknown>, refresh: () => void): Promise<void> {
    if (this.active) return;
    this.setPending(true);
    try {
      if (!confirm()) return;
      try {
        await mutate();
      } finally {
        // The mutation's acknowledgement is the commit boundary. A separate
        // canonical refresh is queued rather than awaited as part of the write.
        refresh();
      }
    } finally {
      this.setPending(false);
    }
  }
}

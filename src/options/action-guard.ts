/** Prevent duplicate Options mutations while one storage transaction is active. */
export class OptionsActionGuard {
  private active = false;
  private stale = false;

  get needsRefresh(): boolean { return this.stale; }
  invalidate(): void { this.stale = true; }
  markRefreshed(): void { this.stale = false; }

  get pending(): boolean {
    return this.active;
  }

  tryStart(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  finish(): void {
    this.active = false;
  }
}

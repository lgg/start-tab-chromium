/** Prevent duplicate Options mutations while one storage transaction is active. */
export class OptionsActionGuard {
  private active = false;

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

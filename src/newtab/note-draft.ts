export interface NoteSaveAttempt {
  readonly expectedValue: string;
  readonly value: string;
}

/**
 * Page-lifetime note draft state. An acknowledgement advances only the
 * baseline it actually saved, never the newer text typed while it was pending.
 * A failed CAS preserves the unsaved draft and requires explicit resolution.
 */
export class NoteDraft {
  private baseline: string;
  private draft: string;
  private active: NoteSaveAttempt | null = null;
  private failure = false;

  constructor(value: string) {
    this.baseline = value;
    this.draft = value;
  }

  get value(): string { return this.draft; }
  get expectedValue(): string { return this.baseline; }
  get saving(): boolean { return this.active !== null; }
  get failed(): boolean { return this.failure; }
  get hasUnsaved(): boolean {
    return this.saving || this.failure || this.draft !== this.baseline;
  }

  observeCanonical(value: string): void {
    if (!this.hasUnsaved) {
      this.baseline = value;
      this.draft = value;
    }
  }

  edit(value: string): void { this.draft = value; }

  beginSave(): NoteSaveAttempt | null {
    if (this.saving || this.failure || this.draft === this.baseline) return null;
    const attempt = { expectedValue: this.baseline, value: this.draft };
    this.active = attempt;
    return attempt;
  }

  succeed(attempt: NoteSaveAttempt): void {
    if (this.active !== attempt) return;
    this.baseline = attempt.value;
    this.active = null;
    this.failure = false;
  }

  fail(attempt: NoteSaveAttempt): void {
    if (this.active !== attempt) return;
    this.active = null;
    this.failure = true;
  }

  /** Caller explicitly confirmed the current saved version if it changed. */
  rebaseForRetry(current: string): void {
    if (this.saving) throw new Error("Cannot resolve a note while its save is pending");
    this.baseline = current;
    this.failure = false;
  }

  discard(current: string): void {
    this.rebaseForRetry(current);
    this.draft = current;
  }
}

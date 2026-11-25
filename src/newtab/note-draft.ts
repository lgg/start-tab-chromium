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
  private canonical: { value: string; revision: number } | null = null;

  constructor(value: string, revision?: number) {
    this.baseline = value;
    this.draft = value;
    if (revision !== undefined) this.canonical = { value, revision };
  }

  get value(): string { return this.draft; }
  get expectedValue(): string { return this.baseline; }
  get saving(): boolean { return this.active !== null; }
  get failed(): boolean { return this.failure; }
  get hasUnsaved(): boolean {
    return this.saving || this.failure || this.draft !== this.baseline;
  }

  observeCanonical(value: string, revision?: number): void {
    if (revision !== undefined) {
      if (this.canonical && revision < this.canonical.revision) return;
      if (this.canonical && revision === this.canonical.revision
        && value !== this.canonical.value) return;
      this.canonical = { value, revision };
    }
    if (!this.hasUnsaved) {
      this.baseline = value;
      this.draft = value;
    }
  }

  edit(value: string): void {
    this.draft = value;
    if (!this.hasUnsaved && this.canonical) {
      this.baseline = this.canonical.value;
      this.draft = this.canonical.value;
    }
  }

  beginSave(): NoteSaveAttempt | null {
    if (this.saving || this.failure || this.draft === this.baseline) return null;
    const attempt = { expectedValue: this.baseline, value: this.draft };
    this.active = attempt;
    return attempt;
  }

  succeed(attempt: NoteSaveAttempt, revision?: number): void {
    if (this.active !== attempt) return;
    this.baseline = attempt.value;
    this.active = null;
    this.failure = false;
    if (revision === undefined) {
      // Older worker acknowledgement: rely on the queued canonical refresh.
      this.canonical = null;
      return;
    }
    if (!this.canonical || this.canonical.revision <= revision) {
      this.canonical = { value: attempt.value, revision };
      return;
    }
    // An external write may arrive before our own acknowledgement. Follow
    // it only when clean; never silently rebase newer unsaved typing.
    if (this.draft === this.baseline) {
      this.baseline = this.canonical.value;
      this.draft = this.canonical.value;
    } else if (this.canonical.value !== this.baseline) {
      this.failure = true;
    }
  }

  fail(attempt: NoteSaveAttempt): void {
    if (this.active !== attempt) return;
    this.active = null;
    this.failure = true;
  }

  /** Caller explicitly confirmed the current saved version if it changed. */
  rebaseForRetry(current: string, revision?: number): void {
    if (this.saving) throw new Error("Cannot resolve a note while its save is pending");
    if (revision !== undefined) {
      if (this.canonical && revision < this.canonical.revision) {
        throw new Error("Start Tab note changed during conflict resolution; retry");
      }
      this.canonical = { value: current, revision };
    } else this.canonical = null;
    this.baseline = current;
    this.failure = false;
  }

  discard(current: string, revision?: number): void {
    this.rebaseForRetry(current, revision);
    this.draft = current;
  }
}

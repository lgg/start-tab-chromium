/** Page-local acknowledged widget state. A renderer may be rebuilt from an
 * older page snapshot while a worker operation is settling. Never let it
 * replace a more recent committed value. Values are cloned at the boundary. */
export class VersionedWidgetValue<T> {
  private snapshot: { value: T; revision: number } | undefined;
  observe(value: T, revision: number): void {
    if (this.snapshot && revision < this.snapshot.revision) return;
    this.snapshot = { value: structuredClone(value), revision };
  }
  get(fallback: T): T {
    return structuredClone(this.snapshot?.value ?? fallback);
  }
}

export class WidgetWriteSession<T> {
  readonly committed = new VersionedWidgetValue<T>();
  private active = false;
  view: (() => void) | undefined;
  get pending(): boolean { return this.active; }
  begin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }
  finish(): void { this.active = false; }
}

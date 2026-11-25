/** Transient text belongs to a widget instance, not to the renderer DOM.
 * Never persist search queries or unsubmitted task text to storage. */
export class WidgetTextDrafts {
  private readonly values = new Map<string, string>();
  get(id: string): string { return this.values.get(id) ?? ""; }
  set(id: string, value: string): void {
    if (value) this.values.set(id, value);
    else this.values.delete(id);
  }
  hasDrafts(): boolean { return this.values.size > 0; }
  prune(retained: ReadonlySet<string>): void {
    for (const id of this.values.keys()) {
      if (!retained.has(id)) this.values.delete(id);
    }
  }
}

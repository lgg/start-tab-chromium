/** Transient text belongs to a widget instance, not to the renderer DOM.
 * Never persist search queries or unsubmitted task text to storage. */
export class WidgetTextDrafts {
  private readonly values = new Map<string, { value: string; title: string }>();
  get(id: string): string { return this.values.get(id)?.value ?? ""; }
  set(id: string, value: string, title = this.values.get(id)?.title ?? ""): void {
    if (value) this.values.set(id, { value, title });
    else this.values.delete(id);
  }
  hasDrafts(): boolean { return this.values.size > 0; }
  hidden(visible: ReadonlySet<string>): Array<[string, { value: string; title: string }]> {
    return [...this.values].filter(([id]) => !visible.has(id)).map(([id, draft]) => [id, { ...draft }]);
  }
  discard(id: string, expectedValue: string): boolean {
    if (this.values.get(id)?.value !== expectedValue) return false;
    this.values.delete(id);
    return true;
  }
}

/** Optional numeric inputs must not convert empty strings to zero. */
export function parseNumberField(value: string, fallback: number): number {
  if (!value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface PanelHost<N> {
  readonly childNodes: ArrayLike<N>;
  replaceChildren(...nodes: N[]): void;
}

/** Keep inactive form controls detached (so they cannot block validation)
 * but retain their exact values and read callbacks until the dialog closes. */
export class FormPanelCache<T, N = Node> {
  private readonly panels = new Map<string, { nodes: N[]; read: () => T }>();

  show(key: string, host: PanelHost<N>, create: () => () => T): () => T {
    const existing = this.panels.get(key);
    if (existing) {
      host.replaceChildren(...existing.nodes);
      return existing.read;
    }
    host.replaceChildren();
    const read = create();
    this.panels.set(key, { nodes: Array.from(host.childNodes), read });
    return read;
  }
}

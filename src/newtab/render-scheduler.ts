export interface RenderSchedulerOptions {
  requestFrame: (callback: () => void) => void;
  refresh: () => Promise<void | boolean>;
  render: () => void;
  onError: (error: unknown) => void;
}

/**
 * Coalesces visual-only renders while allowing a later state refresh request to
 * upgrade an already queued frame. Work is serialized so an older async
 * refresh cannot render after a newer queued operation.
 */
export class RenderScheduler {
  private frameQueued = false;
  private refreshRequested = false;
  private renderRequested = false;
  private disposed = false;
  private job: Promise<void> = Promise.resolve();
  private readonly options: RenderSchedulerOptions;

  constructor(options: RenderSchedulerOptions) {
    this.options = options;
  }

  queueRender(): void {
    this.queue(false, true);
  }

  queueRefresh(forceRender = true): void {
    this.queue(true, forceRender);
  }

  dispose(): void {
    this.disposed = true;
  }

  async waitForIdle(): Promise<void> {
    await this.job.catch(() => undefined);
  }

  private queue(refresh: boolean, forceRender: boolean): void {
    if (this.disposed) return;
    if (refresh) this.refreshRequested = true;
    if (forceRender) this.renderRequested = true;
    if (this.frameQueued) return;
    this.frameQueued = true;
    this.options.requestFrame(() => this.flushFrame());
  }

  private flushFrame(): void {
    this.frameQueued = false;
    const refresh = this.refreshRequested;
    const forceRender = this.renderRequested;
    this.refreshRequested = false;
    this.renderRequested = false;
    const operation = async (): Promise<void> => {
      if (this.disposed) return;
      const changed = refresh ? await this.options.refresh() : false;
      if (!this.disposed && (forceRender || changed !== false)) this.options.render();
    };
    const next = this.job.catch(() => undefined).then(operation);
    this.job = next;
    void next.catch(this.options.onError);
  }
}

export interface RuntimeMutationRecoveryOptions {
  refresh: () => Promise<void>;
  announceConflict: () => void;
  queueRender: () => void;
  queueRefresh: () => void;
}

/**
 * Make a failed optimistic runtime write visible even when reloading the
 * canonical state also fails. A failed recovery is retried by the render
 * scheduler and both errors remain available to the UI error channel.
 */
export async function recoverRuntimeMutation(
  mutationError: unknown,
  options: RuntimeMutationRecoveryOptions,
): Promise<never> {
  let recoveryFailed = false;
  let recoveryError: unknown;
  try {
    await options.refresh();
  } catch (error) {
    recoveryFailed = true;
    recoveryError = error;
  }

  options.announceConflict();
  if (recoveryFailed) {
    options.queueRefresh();
    throw new AggregateError(
      [mutationError, recoveryError],
      "Start Tab runtime mutation failed and canonical state recovery was incomplete",
    );
  }

  options.queueRender();
  throw mutationError;
}

/** An older worker may acknowledge a mutation without a revision. A follow-up
 * read is useful but cannot undo that committed write or turn it into failure.
 * The caller still schedules its ordinary state refresh after settling. */
export async function refreshAfterAcknowledgedRuntimeWrite(
  refresh: () => Promise<void>,
  reportRefreshError: (error: unknown) => void,
): Promise<void> {
  try {
    await refresh();
  } catch (error) {
    reportRefreshError(error);
  }
}

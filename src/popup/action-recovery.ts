/** A worker acknowledgement is the commit boundary. A refresh failure
 * must not turn a successful mutation into an apparent failed write. */
export async function settlePopupAction(
  mutate: () => Promise<unknown>,
  refresh: () => Promise<void>,
): Promise<{ committed: boolean; error?: unknown; refreshError?: unknown }> {
  try { await mutate(); }
  catch (error) {
    try { await refresh(); }
    catch (refreshError) { return { committed: false, error, refreshError }; }
    return { committed: false, error };
  }
  try { await refresh(); }
  catch (refreshError) { return { committed: true, refreshError }; }
  return { committed: true };
}

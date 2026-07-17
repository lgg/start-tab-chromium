/** Run independent post-commit effects without allowing one failure to skip the rest. */
export async function runIndependentEffects(
  effects: ReadonlyArray<() => Promise<void>>,
  aggregateMessage: string,
): Promise<void> {
  const errors: unknown[] = [];
  for (const effect of effects) {
    try {
      await effect();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, aggregateMessage);
}

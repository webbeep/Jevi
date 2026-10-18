/** A search object with no rows is not a source on the card. */
export function hasArrivedSources(search?: { results?: readonly unknown[] }, peek?: readonly unknown[]): boolean {
  return (search?.results?.length ?? 0) > 0 || (peek?.length ?? 0) > 0;
}

/**
 * The source trail stays on screen until a component has real data.
 * An empty layout is not a placeholder for that wait, and a finished card does not
 * fall back to one when the live stream is cleared.
 */
export function showWaitingLayout(input: {
  filling: boolean;
  hasResult: boolean;
  answerStarted: boolean;
  layoutCount: number;
}): boolean {
  if (!input.filling || input.hasResult || !input.answerStarted || input.layoutCount === 0) return false;
  // A component that already has data is the card. The full skeleton does not cover the trail.
  return false;
}

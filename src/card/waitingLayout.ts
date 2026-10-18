/**
 * The plan skeleton is only the wait. Once the answer has started, or the finished card is in,
 * it must not come back — clearing the live stream used to make this true again and the
 * placeholder replaced the result.
 */
/** A search object with no rows is not a source on the card. */
export function hasArrivedSources(search?: { results?: readonly unknown[] }, peek?: readonly unknown[]): boolean {
  return (search?.results?.length ?? 0) > 0 || (peek?.length ?? 0) > 0;
}

export function showWaitingLayout(input: {
  filling: boolean;
  hasResult: boolean;
  answerStarted: boolean;
  layoutCount: number;
  needsSources: boolean;
  /** Sources are already visible in the loading animation, so the slots are not the first frame. */
  sourcesReady: boolean;
}): boolean {
  if (!input.filling || input.hasResult || input.answerStarted || input.layoutCount === 0) return false;
  if (input.needsSources && !input.sourcesReady) return false;
  return true;
}

/**
 * The plan skeleton is only the wait. Once the answer has started, or the finished card is in,
 * it must not come back — clearing the live stream used to make this true again and the
 * placeholder replaced the result.
 */
export function showWaitingLayout(input: {
  filling: boolean;
  hasResult: boolean;
  answerStarted: boolean;
  layoutCount: number;
  needsSources: boolean;
  sourcesSettled: boolean;
}): boolean {
  if (!input.filling || input.hasResult || input.answerStarted || input.layoutCount === 0) return false;
  if (input.needsSources && !input.sourcesSettled) return false;
  return true;
}

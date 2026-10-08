/**
 * News wording the planner already treats as a briefing
 * (`heuristicPattern` in server/patterns.ts). Social search uses the same test.
 */
export const BRIEFING_QUERY = /\b(news|latest|today|update)\b/;

export function isBriefingQuery(query: string): boolean {
  return BRIEFING_QUERY.test(query.toLowerCase());
}

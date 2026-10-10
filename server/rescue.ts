import type { SearchResult } from '../shared/types';
import type { SourceBrief } from './brief';

/**
 * The first results answered a different subject (NFL schedules for an NBA question). One more search,
 * worded from what was missing, runs before the card is allowed to say nothing was found.
 */

const FILL = new Set(
  `a an the of in on at to for from by with and or but if as is are was were be do does did
what who when where why how which about into over than then not no so just very now vs versus
results result sources source pages page contain contains only general video videos confirmed
confirm shown show answer answers asked ask missing cannot these those this that their there here
were was been being have has had`.split(/\s+/),
);

const MONTH = /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/;

const wordsOf = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !FILL.has(w));

const isDate = (w: string) => MONTH.test(w) || /^(19|20)\d{2}$/.test(w);

/** Nothing in the results answers the ask, or every judged row was about something else. */
export function sourcesMiss(brief: SourceBrief): boolean {
  if (brief.use.length > 0) return false;
  if (brief.missing) return true;
  return !!brief.partial && brief.offTopic.length >= 2;
}

/**
 * A different search for the gap. Words the question never said come first (NBA, when the tap only
 * said "top 10 plays"), then the date, so the next results are about the subject that was missing.
 * Undefined when it would repeat the question.
 */
export function rescueQuery(query: string, brief: SourceBrief): string | undefined {
  const asked = new Set(wordsOf(query));
  const goal = wordsOf(`${brief.goal} ${brief.missing ?? ''}`);
  const acronyms = new Set([...`${brief.goal} ${brief.missing ?? ''}`.matchAll(/\b[A-Z]{2,}\b/g)].map((m) => m[0].toLowerCase()));
  const fresh = goal.filter((w) => !asked.has(w) && !isDate(w)).sort((a, b) => Number(acronyms.has(b)) - Number(acronyms.has(a)));
  const known = goal.filter((w) => asked.has(w) && !isDate(w));
  const body = [...new Set([...fresh, ...known])];
  if (body.length < 2 || fresh.length === 0) return undefined;
  const dates = `${brief.goal} ${brief.missing ?? ''} ${query}`.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}\b|\b(?:19|20)\d{2}\b/gi,
  ) ?? [];
  const when = [...new Set(dates.flatMap((d) => d.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/)).filter(Boolean))];
  return [...body.slice(0, 8), ...when].slice(0, 12).join(' ');
}

/** Rows that actually mention the goal. Sharing "games" and "schedule" with an NFL page is not enough; the subject itself (NBA) has to be there. */
export function onTopicCount(rows: Pick<SearchResult, 'title' | 'snippet'>[], brief: SourceBrief): number {
  const want = [...new Set(wordsOf(`${brief.goal} ${brief.missing ?? ''}`))].filter((w) => !isDate(w)).slice(0, 6);
  const named = [...brief.goal.matchAll(/\b[A-Z]{2,}\b/g)].map((m) => m[0].toLowerCase()).find((w) => want.includes(w));
  const lead = named ?? want[0];
  if (!lead) return 0;
  return rows.filter((row) => {
    const hay = ` ${`${row.title} ${row.snippet ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
    const has = (w: string) => hay.includes(` ${w} `);
    if (!has(lead)) return false;
    const hits = want.filter(has).length;
    return want.length < 2 || hits >= 2;
  }).length;
}

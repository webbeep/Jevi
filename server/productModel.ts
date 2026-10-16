/**
 * A numbered product ("Mi Band 11", "iPhone 17") is not a price, a year, or a stat.
 * "Mi Band 4" does not answer "Mi Band 11".
 */

/** Words that sit in front of a number without naming a product. */
const NOT_MODEL = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'and', 'or', 'vs', 'versus',
  'new', 'top', 'all', 'any', 'out', 'off', 'one', 'two', 'per', 'no', 'up',
  'under', 'over', 'about', 'around', 'than', 'more', 'less', 'within', 'after', 'before', 'between', 'above', 'below',
  'point', 'points', 'pts', 'rebound', 'rebounds', 'assist', 'assists', 'minute', 'minutes', 'hour', 'hours', 'days', 'year', 'years',
  'percent', 'pct', 'times', 'time', 'people', 'users', 'seats', 'inch', 'inches', 'cm', 'mm', 'gb', 'mb', 'tb', 'kg', 'lb', 'lbs', 'oz',
  'dropped', 'scored', 'cost', 'costs', 'price', 'priced', 'launched', 'release', 'released', 'version', 'episode', 'season', 'chapter', 'number',
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

interface ModelMention {
  keys: string[];
  n: string;
}

/** A 1–3 digit model number written after a product word. Years are not models. */
export function modelMentions(text: string): ModelMention[] {
  const tokens = norm(text).split(' ').filter(Boolean);
  const out: ModelMention[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = tokens[i]!;
    if (!/^\d{1,3}$/.test(n) || /^(?:19|20)\d{2}$/.test(n)) continue;
    const prev = tokens[i - 1];
    if (!prev || !/[a-z]/.test(prev) || prev.length < 2 || NOT_MODEL.has(prev)) continue;
    const keys = [prev];
    const prev2 = tokens[i - 2];
    if (prev2 && /[a-z]/.test(prev2) && prev2.length >= 2 && !NOT_MODEL.has(prev2)) keys.push(prev2 + prev);
    out.push({ keys, n });
  }
  return out;
}

/** The ask names a numbered product ("Xiaomi Miband 11"), not a price, a year, or a stat line. */
export function hasProductModel(text: string): boolean {
  return modelMentions(text).length > 0;
}

/**
 * A hit contradicts the ask when it puts a different model number on the same product line
 * and never states the number that was asked. A page that states the asked number stays,
 * even if it also mentions the older one.
 */
export function modelConflict(query: string, row: { title: string; snippet?: string }): boolean {
  const asked = modelMentions(query);
  if (!asked.length) return false;
  const found = modelMentions(`${row.title} ${row.snippet ?? ''}`);
  let matched = 0;
  let contradicted = 0;
  for (const q of asked) {
    const line = found.filter((hit) => hit.keys.some((key) => q.keys.includes(key)));
    if (line.some((hit) => hit.n === q.n)) matched += 1;
    else if (line.length) contradicted += 1;
  }
  return contradicted > 0 && matched === 0;
}

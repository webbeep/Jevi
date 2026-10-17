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

/** A suffix that names a different product from the base model. */
const VARIANT = new Set(['pro', 'plus', 'max', 'mini', 'ultra']);

function lineTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

interface ProductLine { stem: string; variant: string }

/** A numbered product and the variant word after it, if there is one. "band 8 pro" is not "band 8". */
export function productLines(text: string): ProductLine[] {
  const tokens = lineTokens(text);
  const out: ProductLine[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = tokens[i]!;
    if (!/^\d{1,3}$/.test(n) || /^(?:19|20)\d{2}$/.test(n)) continue;
    const prev = tokens[i - 1];
    if (!prev || !/[a-z]/.test(prev) || prev.length < 2 || NOT_MODEL.has(prev)) continue;
    const next = tokens[i + 1];
    out.push({ stem: `${prev}${n}`, variant: next && VARIANT.has(next) ? next : '' });
  }
  return out;
}

function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (!longer.endsWith(shorter)) return false;
  return /^[a-z]{2,}$/.test(longer.slice(0, longer.length - shorter.length));
}

/**
 * The page is a different variant of the model that was asked (a Pro review for the base model,
 * or the base model when Pro was asked) and never states the one in the question.
 */
export function variantConflict(query: string, row: { title: string; snippet?: string }): boolean {
  const asked = productLines(query);
  if (!asked.length) return false;
  const found = productLines(`${row.title} ${row.snippet ?? ''}`);
  let matched = 0;
  let contradicted = 0;
  for (const q of asked) {
    const line = found.filter((hit) => sameStem(hit.stem, q.stem));
    if (!line.length) continue;
    if (line.some((hit) => hit.variant === q.variant)) matched += 1;
    else contradicted += 1;
  }
  return contradicted > 0 && matched === 0;
}

export interface VariantChoice { name: string; descriptor: string; query: string; id: string }

/**
 * When every page about the asked model is a different variant, offer those models.
 * Undefined when a page already states the model that was asked.
 */
export function variantChoices(query: string, rows: readonly { title: string; snippet?: string }[]): VariantChoice[] | undefined {
  const asked = productLines(query);
  if (!asked.length) return undefined;
  const choices: VariantChoice[] = [];
  const seen = new Set<string>();
  for (const q of asked) {
    const line = rows.flatMap((row) => productLines(`${row.title} ${row.snippet ?? ''}`).filter((hit) => sameStem(hit.stem, q.stem)));
    if (!line.length || line.some((hit) => hit.variant === q.variant)) continue;
    const variants = [...new Set(line.map((hit) => hit.variant).filter(Boolean))];
    if (!variants.length) continue;
    const base = query.trim();
    if (!seen.has(base.toLowerCase())) {
      seen.add(base.toLowerCase());
      choices.push({ name: base, descriptor: 'The model you asked for', query: base, id: `model-${choices.length}` });
    }
    for (const variant of variants) {
      const name = `${base} ${variant[0]!.toUpperCase()}${variant.slice(1)}`;
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      choices.push({ name, descriptor: 'A different model', query: name, id: `model-${choices.length}` });
    }
  }
  return choices.length >= 2 ? choices : undefined;
}

/** The ask names a numbered product ("Xiaomi Miband 11"), not a price, a year, or a stat line. */
export function hasProductModel(text: string): boolean {
  return modelMentions(text).length > 0 || productLines(text).length > 0;
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

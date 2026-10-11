import type { Suggestion } from './starters.ts';

const ICONS = new Set([
  'search', 'newspaper', 'scale', 'list-checks', 'trending-up', 'calendar',
  'chart-line', 'activity', 'user', 'lightbulb', 'sparkles', 'headphones',
]);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function clip(text: string): string {
  const tidy = text.replace(/\s+/g, ' ').trim();
  if (tidy.length <= 72) return tidy;
  const cut = tidy.slice(0, 72);
  const space = cut.lastIndexOf(' ');
  return (space > 24 ? cut.slice(0, space) : cut).trim();
}

/**
 * Keeps model ideas that are real questions and not something this person already asked
 * or was already offered as a follow-up.
 */
export function acceptIdeas(rows: { text?: unknown; icon?: unknown }[], blocked: string[], want: number): Suggestion[] {
  const seen = new Set(blocked.map(norm).filter(Boolean));
  const out: Suggestion[] = [];
  for (const row of rows) {
    if (out.length >= want) break;
    if (typeof row.text !== 'string') continue;
    const text = clip(row.text);
    const key = norm(text);
    if (key.length < 8 || seen.has(key) || /pros and cons\W+pros and cons/i.test(text)) continue;
    seen.add(key);
    const icon = typeof row.icon === 'string' && ICONS.has(row.icon) ? row.icon : 'sparkles';
    out.push({ id: `i-${out.length}-${key.replace(/\s+/g, '-').slice(0, 40)}`, text, icon, group: 'broad' });
  }
  return out;
}

/** Model ideas first. Template ideas fill only the open slots. */
export function fillIdeas(primary: Suggestion[], fallback: Suggestion[], want: number): Suggestion[] {
  const seen = new Set(primary.map((item) => norm(item.text)));
  const out = [...primary];
  for (const item of fallback) {
    if (out.length >= want) break;
    const key = norm(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, want);
}

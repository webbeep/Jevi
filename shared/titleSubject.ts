/**
 * Words a card title adds after the thing it is about: "Empire State Building Height", "Nintendo Switch 2 Price",
 * "Met Museum Hours". A follow-up names the thing, not the attribute the last card showed.
 */
const ATTRIBUTE = new Set([
  'height', 'heights', 'price', 'prices', 'pricing', 'cost', 'costs', 'hours', 'opening', 'admission', 'tickets', 'specs',
  'specifications', 'review', 'reviews', 'stock', 'quote', 'forecast', 'weather', 'score', 'scores', 'schedule', 'tax',
  'taxes', 'ranking', 'rankings', 'comparison', 'guide', 'overview', 'facts', 'history', 'timeline', 'explained', 'today',
  'now', 'update', 'updates', 'status', 'results', 'stats', 'standouts', 'size', 'distance', 'launch', 'location', 'menu',
  'fees', 'fee', 'rate', 'rates', 'battery', 'storage', 'release', 'date', 'details', 'summary', 'profile', 'news',
]);

/** The thing a title is about, without trailing attribute words; never empty while the title has a word. */
export function titleSubject(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && ATTRIBUTE.has(words[words.length - 1]!.toLowerCase().replace(/[^a-z]/g, ''))) words.pop();
  return words.join(' ');
}

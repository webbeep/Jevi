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
  'tonight', 'distance', 'opening', 'mirror', 'sales',
]);

/**
 * The thing a title is about: the words before its first attribute word ("JWST Distance From Earth" is JWST,
 * "Nintendo Switch 2 Price With NYC Tax" is the Nintendo Switch 2). Never empty while the title has a word.
 */
export function titleSubject(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const at = words.findIndex((word, i) => i > 0 && ATTRIBUTE.has(word.toLowerCase().replace(/[^a-z]/g, '')));
  return (at > 0 ? words.slice(0, at) : words).join(' ');
}

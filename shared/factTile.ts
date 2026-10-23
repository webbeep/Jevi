/**
 * Fact labels. A photo on these is a placeholder icon or an unrelated picture
 * (a flickr badge on "New episodes", a diagram on "Network"), so the tile stays text.
 */
const FACT_TILE =
  /^(hosts?|co[- ]?hosts?|network|episodes?|new episodes?|schedule|airtime|airs|rating|distributor|frequency|genre|runtime|seasons?|status|cuisine|style|price range|price|dress code|reservations?|hours|address|neighborhood|neighbourhood|seats|capacity|menu|tasting menu|courses)$/i;

/** True when this tile label is a fact and must not show a picture. */
export function factTileLabel(label: string | undefined): boolean {
  if (!label) return false;
  const text = label.replace(/\s*\[\d+\]/g, '').trim().replace(/[:：]$/, '');
  return FACT_TILE.test(text);
}

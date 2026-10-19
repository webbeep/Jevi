import type { CardNode } from './card';
import { GAP_MARK } from './gap';

/** Nothing left but citation markers, dashes and punctuation ("[8]", " · ", "—"). */
function hollow(text: string | undefined): boolean {
  return !text || !text.replace(/\[\d+\]/g, '').replace(/[\s·•|,.;:()\-–—″"°%$€£¥]+/g, '');
}

const blankCell = (cell: string) => cell !== GAP_MARK && hollow(cell);

/** A value that says there is no value ("Unavailable", "None yet", "N/A"). */
const NON_ANSWER = /^(?:unavailable|not available|none(?: yet| listed| found| reported)?|n\/?a|tbd|tba|unknown|not (?:yet )?(?:stated|reported|listed|announced|found)|not in (?:the |these )?sources|no data|pending)\.?$/i;
const PRICE_LEFTOVER = /^(?:~|≈|under|over|from|around|about|approx\.?|up to|starting at|less than|more than|below|above)$/i;
const saysNothing = (value: string | undefined) => hollow(value) || NON_ANSWER.test(value!.replace(/\[\d+\]/g, '').trim());

/**
 * What a component still says after its unsupported figures were removed. A table row with no values left,
 * a key with no value, a sentence that is only "[8]" and a subtitle that is only " · " are dropped, and a
 * single missing table cell reads "—". Undefined when nothing is left to show.
 */
export function withoutShells(node: CardNode): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      // Beside tiles that carry a figure, a tile with no figure and no picture is a hole ("Pro · per user/mo" with no price).
      const valued = node.children.some((child) => child.type === 'tile' && !!child.value?.trim());
      const children = node.children
        .map(withoutShells)
        .filter((child): child is CardNode => !!child)
        // A numbered pick ("3. Sony WH-CH720N") is a name in a ranking; dropping it would leave "1, 2, 4, 5".
        .filter((child) => !(valued && child.type === 'tile' && !child.value?.trim() && !child.imageSrc && child.imageRef === undefined && !/^\s*#?\d+[.)]/.test(child.label)));
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'text':
    case 'callout':
      return hollow(node.text) ? undefined : node;
    case 'keyvalue': {
      const items = node.items.filter((item) => !saysNothing(item.value));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'table': {
      const rows = node.rows
        .filter((row) => row.length < 2 || row.slice(1).some((cell) => !blankCell(cell)))
        .map((row) => (row.slice(1).some(blankCell) ? [row[0]!, ...row.slice(1).map((cell) => (blankCell(cell) ? '—' : cell))] : row));
      if (rows.length === node.rows.length && rows.every((row, i) => row === node.rows[i])) return node;
      return rows.length ? { ...node, rows } : undefined;
    }
    case 'hero':
      return node.caption !== undefined && hollow(node.caption) ? { ...node, caption: undefined } : node;
    case 'list': {
      // An empty detail ("meta": "") is dropped, and an item already listed is not listed again.
      const seen = new Set<string>();
      const items = node.items
        .map((item) => (item.meta !== undefined && hollow(item.meta) ? { ...item, meta: undefined } : item))
        .filter((item) => {
          const key = item.text.replace(/\[\d+\]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      if (items.length === node.items.length && items.every((item, i) => item === node.items[i])) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'tile':
      // A tile whose figure is "Unavailable" fills a row with nothing; a tile with no value at all is a name and stays.
      if (node.value !== undefined && node.value.trim() && NON_ANSWER.test(node.value.replace(/\[\d+\]/g, '').trim())) return undefined;
      // "Under", "From" or "~" is what is left of a price that was removed.
      if (node.value !== undefined && (hollow(node.value) || PRICE_LEFTOVER.test(node.value.replace(/\[\d+\]/g, '').trim()))) return withoutShells({ ...node, value: undefined });
      return node.sub !== undefined && hollow(node.sub) ? { ...node, sub: undefined } : node;
    default:
      return node;
  }
}

/** A citation to a source the card does not have ("[30]" on a card with 12) is removed, wherever it sits. */
export function withinSources(node: CardNode, count: number): CardNode {
  const json = JSON.stringify(node);
  const fixed = json.replace(/\s*\[(\d+)\]/g, (cite, n: string) => (Number(n) >= 1 && Number(n) <= count ? cite : ''));
  return fixed === json ? node : (JSON.parse(fixed) as CardNode);
}

const factValue = (value: string) => value.replace(/\[\d+\]/g, '').toLowerCase().replace(/[^a-z0-9.$%€£]+/g, ' ').trim();
const LABEL_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'per', 'total', 'value']);
const labelWords = (label: string) => label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !LABEL_STOP.has(word));

/** The keys one fact is known by: its value with each word of its label. "Joined Microsoft 1992" and "Joined 1992" share one. */
function factKeys(label: string, value: string): string[] {
  const v = factValue(value);
  if (v.length < 2) return [];
  const words = labelWords(label);
  return (words.length ? words : ['']).map((word) => `${v}|${word}`);
}

/** Every fact key a component shows. */
function keysOf(node: CardNode, out: Set<string>): Set<string> {
  if (node.type === 'tile' || node.type === 'stat') factKeys(node.label, node.value ?? '').forEach((key) => out.add(key));
  if (node.type === 'keyvalue') node.items.forEach((item) => factKeys(item.label, item.value).forEach((key) => out.add(key)));
  if ('children' in node && Array.isArray(node.children)) node.children.forEach((child) => keysOf(child, out));
  return out;
}

/**
 * Regions are designed in parallel and restate the same fact ("Joined Microsoft 1992" in a tile and in a key-value row).
 * A fact another slot shows right now is dropped from this one, so the component already on screen keeps it, and a
 * slot republishing its own fact keeps it. Two products with the same price are different facts: their labels differ.
 */
export function withoutRepeatedFacts(node: CardNode, elsewhere: ReadonlySet<string>): CardNode | undefined {
  const repeated = (label: string, value: string) => factKeys(label, value).some((key) => elsewhere.has(key));
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withoutRepeatedFacts(child, elsewhere)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'tile':
    case 'stat':
      return repeated(node.label, node.value ?? '') ? undefined : node;
    case 'keyvalue': {
      const items = node.items.filter((item) => !repeated(item.label, item.value));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    default:
      return node;
  }
}

/** The fact keys the other slots show now. */
export function factsElsewhere(shown: ReadonlyMap<number, CardNode>, slot: number): Set<string> {
  const out = new Set<string>();
  for (const [index, node] of shown) if (index !== slot) keysOf(node, out);
  return out;
}

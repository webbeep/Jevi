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
/** A price cut off where its figure was: "starts at $...", "from $." A cashtag ("$RDW") is not one. */
const CUT_MONEY = /[$€£¥]\s*(?:\.{2,}|…)|[$€£¥](?=\s*(?:[,;:)]|$))/;
const cutMoney = (text: string | undefined) => !!text && CUT_MONEY.test(text.replace(/\[\d+\]/g, '').trim());
const saysNothing = (value: string | undefined) => hollow(value) || cutMoney(value) || NON_ANSWER.test(value!.replace(/\[\d+\]/g, '').trim());

/**
 * What a component still says after its unsupported figures were removed. A table row with no values left,
 * a key with no value, a sentence that is only "[8]" and a subtitle that is only " · " are dropped, and a
 * single missing table cell reads "—". Undefined when nothing is left to show.
 */
export function withoutShells(node: CardNode, asked = ''): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      // Beside tiles that carry a figure, a tile with no figure and no picture is a hole ("Pro · per user/mo" with no price).
      const valued = node.children.some((child) => child.type === 'tile' && !!child.value?.trim());
      // The same long value on several tiles ("Free sugars", "Not counted", "Hidden sugars" each holding one WHO
      // quote) is one fact shown as several: the first keeps it.
      const seenValue = new Set<string>();
      const children = node.children
        .map((child) => withoutShells(child, asked))
        .filter((child): child is CardNode => !!child)
        .filter((child) => {
          if (child.type !== 'tile' || !child.value || child.value.replace(/\[\d+\]/g, '').trim().length < 30) return true;
          const key = child.value.replace(/\[\d+\]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (seenValue.has(key)) return false;
          seenValue.add(key);
          return true;
        })
        // A numbered pick ("3. Sony WH-CH720N") is a name in a ranking; dropping it would leave "1, 2, 4, 5".
        .filter((child) => !(valued && child.type === 'tile' && !child.value?.trim() && !child.imageSrc && child.imageRef === undefined && !/^\s*#?\d+[.)]/.test(child.label)));
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'text':
    case 'callout': {
      if (hollow(node.text)) return undefined;
      if (!cutMoney(node.text)) return node;
      const kept = node.text.split(/(?<=[.!?](?:\s*\[\d+\])*)\s+(?=[A-Z])/).filter((sentence) => !cutMoney(sentence)).join(' ').trim();
      return kept && !hollow(kept) ? { ...node, text: kept } : undefined;
    }
    case 'keyvalue': {
      // One long quote on several rows ("Free sugars", "Not counted", "Hidden sugars") is one fact: the first row keeps it.
      const seenLong = new Set<string>();
      const items = node.items.filter((item) => {
        if (saysNothing(item.value)) return false;
        const key = longKey(item.value);
        if (!key) return true;
        if (seenLong.has(key)) return false;
        seenLong.add(key);
        return true;
      });
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'table': {
      const valued = node.rows.filter((row) => row.length < 2 || row.slice(1).some((cell) => !blankCell(cell)));
      // A row with a hole goes when at least two whole rows remain: a "—" beside a figure the card states elsewhere
      // reads as missing data. A table that would be gutted keeps its rows and shows the hole as "—".
      // A row the question asks about ("battery" on "which has better battery life?") stays with its hole.
      const askedWords = new Set(asked.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4).map((word) => word.slice(0, 5)));
      const askedRow = (row: readonly string[]) => (row[0] ?? '').toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length >= 4 && askedWords.has(word.slice(0, 5)));
      const whole = valued.filter((row) => !row.slice(1).some(blankCell) || askedRow(row));
      const rows = whole.length >= 2
        ? whole.map((row) => (row.slice(1).some(blankCell) ? [row[0]!, ...row.slice(1).map((cell) => (blankCell(cell) ? '—' : cell))] : row))
        : valued.map((row) => (row.slice(1).some(blankCell) ? [row[0]!, ...row.slice(1).map((cell) => (blankCell(cell) ? '—' : cell))] : row));
      if (rows.length === node.rows.length && rows.every((row, i) => row === node.rows[i])) return node;
      return rows.length ? { ...node, rows } : undefined;
    }
    case 'hero':
      return node.caption !== undefined && hollow(node.caption) ? { ...node, caption: undefined } : node;
    case 'list': {
      // An empty detail ("meta": "") is dropped, and an item already listed is not listed again.
      const seen = new Set<string>();
      const items = node.items
        .map((item) => (item.meta !== undefined && (hollow(item.meta) || cutMoney(item.meta)) ? { ...item, meta: undefined } : item))
        .filter((item) => {
          if (cutMoney(item.text)) return false;
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
      if (node.value !== undefined && (hollow(node.value) || cutMoney(node.value) || PRICE_LEFTOVER.test(node.value.replace(/\[\d+\]/g, '').trim()))) return withoutShells({ ...node, value: undefined });
      return node.sub !== undefined && (hollow(node.sub) || cutMoney(node.sub)) ? { ...node, sub: undefined } : node;
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

/** A value long enough to be a sentence or a quote, normalized; empty when it is a short figure or label. */
function longKey(value: string | undefined): string {
  const key = (value ?? '').replace(/\[\d+\]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return key.length >= 40 ? key : '';
}

const factValue = (value: string) => value.replace(/\[\d+\]/g, '').toLowerCase().replace(/[^a-z0-9.$%€£]+/g, ' ').trim();
const LABEL_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'per', 'total', 'value']);
const labelWords = (label: string) => label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !LABEL_STOP.has(word));

/** Prefix of a long text another slot shows; matched by containment, not by label. */
const LONG = 'long|';

/** The keys one fact is known by: its value with each word of its label. "Joined Microsoft 1992" and "Joined 1992" share one. */
function factKeys(label: string, value: string): string[] {
  const v = factValue(value);
  if (v.length < 2) return [];
  const words = labelWords(label);
  return (words.length ? words : ['']).map((word) => `${v}|${word}`);
}

/** Every fact key a component shows. */
function keysOf(node: CardNode, out: Set<string>): Set<string> {
  const long = (text: string | undefined) => {
    const key = longKey(text);
    if (key) out.add(`${LONG}${key}`);
  };
  if (node.type === 'tile' || node.type === 'stat') factKeys(node.label, node.value ?? '').forEach((key) => out.add(key));
  if (node.type === 'tile') long(node.value);
  if (node.type === 'keyvalue') node.items.forEach((item) => {
    factKeys(item.label, item.value).forEach((key) => out.add(key));
    long(item.value);
  });
  if (node.type === 'text' || node.type === 'callout' || node.type === 'quote') long(node.text);
  if (node.type === 'hero') long(node.caption);
  if ('children' in node && Array.isArray(node.children)) node.children.forEach((child) => keysOf(child, out));
  return out;
}

/**
 * Regions are designed in parallel and restate the same fact ("Joined Microsoft 1992" in a tile and in a key-value row).
 * A fact another slot shows right now is dropped from this one, so the component already on screen keeps it, and a
 * slot republishing its own fact keeps it. Two products with the same price are different facts: their labels differ.
 */
export function withoutRepeatedFacts(node: CardNode, elsewhere: ReadonlySet<string>): CardNode | undefined {
  const shownLong = [...elsewhere].filter((key) => key.startsWith(LONG)).map((key) => key.slice(LONG.length));
  // A long quote another slot already shows (in its text or caption) is not shown again as a row's value.
  const repeatsLong = (value: string) => {
    const key = longKey(value);
    return !!key && shownLong.some((shown) => shown.includes(key));
  };
  const repeated = (label: string, value: string) => factKeys(label, value).some((key) => elsewhere.has(key)) || repeatsLong(value);
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

const quoteNorm = (text: string) => text.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9%$.' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Whether every quotation in this text is the sources' own words. An ellipsis may join fragments of one passage; each
 * fragment of three or more words must appear as written. A page title wrapped in quote marks ("Exercise " Physical
 * activity guidelines for adults aged 19 to 64".") is not a quotation.
 */
function quotesVerbatim(text: string, corpus: string): boolean {
  // Stray quote marks are a broken quotation, not punctuation: a closing mark after a space ("Exercise " Physical…)
  // or marks around bare punctuation (".").
  if (/\w\s+["”](?=\s|$)/.test(text) || /["”][.,;:]["“]/.test(text)) return false;
  for (const match of text.matchAll(/["“]([^"”]{12,})["”]/g)) {
    const fragments = match[1]!.split(/\s*(?:\.\.\.|…)\s*/).map(quoteNorm).filter((part) => part.split(' ').length >= 3);
    if (!fragments.length || fragments.some((part) => !corpus.includes(part))) return false;
  }
  return true;
}

/** Items and sentences whose quotations are not in the sources are dropped. `corpus` is quoteNorm'd source text. */
export function withVerbatimQuotes(node: CardNode, corpus: string): CardNode | undefined {
  const ok = (text: string | undefined) => !text || quotesVerbatim(text.replace(/\[\d+\]/g, ''), corpus);
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map((child) => withVerbatimQuotes(child, corpus)).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'keyvalue': {
      const items = node.items.filter((item) => ok(item.value));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'list': {
      const items = node.items.filter((item) => ok(item.text) && ok(item.meta));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'tile':
      return ok(node.value) && ok(node.sub) ? node : undefined;
    case 'text':
    case 'callout': {
      // A sentence ends at its full stop and any citations after it ("activity.” [4] It also…").
      const kept = node.text.split(/(?<=[.!?”"](?:\s*\[\d+\])*)\s+(?=[A-Z“"])/).filter((sentence) => ok(sentence)).join(' ').trim();
      if (kept === node.text) return node;
      return kept ? { ...node, text: kept } : undefined;
    }
    default:
      return node;
  }
}

/** The text a card's quotations are checked against. */
export function quoteCorpus(rows: readonly { title?: string; snippet?: string; content?: string }[], pages: readonly { text: string }[]): string {
  return quoteNorm([...rows.map((row) => `${row.title ?? ''} ${row.snippet ?? ''} ${row.content ?? ''}`), ...pages.map((page) => page.text)].join(' \n '));
}

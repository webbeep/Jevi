import { turnsDegraded } from './degraded';

export const ANSWER_CACHE_VERSION = 'v1';
export const ANSWER_TTL_S = 86400;

const QUOTES = /^["'“”‘’]+|["'“”‘’]+$/;
const TRAILING = /[?!.,;]+$/;

/** NFKC, lowercase, collapsed whitespace, surrounding quotes and trailing punctuation removed. */
export function normalizeAnswerQuery(q: string): string {
  let s = q.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(QUOTES, '').replace(TRAILING, '').trim();
  }
  return s;
}

/** 32-bit FNV-1a, lowercase hex. Sync and allocation-light so cache keys stay cheap. */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function answerCacheUrl(input: { query: string; freshness: string; context?: string }): string {
  const q = encodeURIComponent(normalizeAnswerQuery(input.query));
  // '-e89': a tax card is aligned again after later nodes, so the first finished card does not keep a second percent. '-e88': every percent on a tax card is the official rate, including a list, and a relative comparison phrase is not left as a price. '-e87': the first tax card uses one official rate, a shared full name is one person, and a comparison price is a single amount from the sources. '-e86': a tax lead is the official page's rate and a sum on the card has to equal it, a fee card drops an amount that page does not state, and a versus query stays a visual comparison. '-e85': a fee uses the amount on the official page that matches the question, and a component tax rate is not overwritten with the combined rate. '-e84': a tax or fee waits for the official page and uses the rate or amount that page states. '-e83': a later follow-up stays on the subject already on screen, and a tax or fee is the figure the official source states. '-e82': a follow-up keeps the picture already shown for a product, even when a new search found a different one. '-e81': a named side the comparison left out is added from the search for that product. '-e80': a follow-up that adds a product searches each product and keeps a price and picture already shown. '-e79': a comparison that already names both sides keeps its rows, and a versus product token is not respelt into a different name. '-e78': the card layout starts when the first sources are in, without waiting on catalogs that have not arrived. '-e77': a picked person is searched alone, and a follow-up does not prepend another person. '-e76': a precise bio fact is shown only when sources about that person agree, a contradicted one is not repeated on the next follow-up, a peer-reviewed card keeps the paper titles the sources name, and a rate follow-up is answered from the card. '-e75': a quote uses the sentence that names the source the question asked for, a citation stub is not left as the quote, and a shopping pick that lacks a stated feature does not stay once another pick has it. A where-follow-up headline is the place. '-e74': the later person card (which person, a portrait from a page about that person, a pick price inside the stated budget, and a repeated sentence once) ships with the quote, verdict, and shopping agreement rules. Two choices that name one person are that person, and a where-they-teach follow-up keeps a body that names the school. '-e73': a quote ask can take the numbered sentence from another fetched page when the quoted sentence has no number, and a title run into that sentence is split off. '-e72': all-caps NO is not a negation, so a benefit sentence that names it still drops under a no. '-e71': a quoted sentence drops a site label glued on the front, an empty quotation is not left behind, and a protective-effect line under a no is the same fight. '-e70': a quoted sentence is not the page title or a table run together, and a "may act" line under a no is the same fight as "may help". '-e69': a quote ask shows the page sentence that answers, including when the card line is a paraphrase or a nearby sentence. '-e68': a benefit line under a no is dropped from an accordion or a labeled row, and a dollar in a follow-up chip is not a product price. '-e67': a quote the page does not contain is not shown, a benefit line under a no is dropped including in a pros list, the budget in a label is not a product price, and a where-they-teach title is the lead place. '-e66': a quote is the sentence that answers, a verdict drops a line that fights it, a paper design is stated only when the page says so, a peer-reviewed list keeps openable papers, a follow-up title answers the new question, and a shopping count and price match the rows. The person card also shipped: '-e71': a workplace plus a given name asks which person when two match, and a resolved person's portrait comes from a page about that person. '-e70': a pick's caption does not keep a price above the stated budget. '-e69': a pick does not show a price above the stated budget, including a higher budget chip. '-e68': a capitalised first name plus a lowercase surname is the same person ask, so a shared name still asks which person. '-e67': a resolved person's portrait is searched again and has to come from a page about that person, and a name shared by different careers asks which person. '-e66': a given name plus a workplace asks which person before a card, a pick's price stays inside the stated budget, a repeated sentence is said once, and a follow-up label stays the words that were typed. '-e65': a follow-up that points at the card searches that subject, a bare ticker gets a price chart, a stated figure stays, a stated spec leads, and the publishing authority leads an outbreak count. '-e64': a quotation is repaired before its quote mark is removed, and a decimal is not split when a sentence is kept. '-e63': a quotation that stops at the point keeps the decimal the card already states, a clear no is not softened to "no solid evidence", and an unpriced product does not lead a priced one. '-e62': a decimal is one number, so a quotation is not cut at the point, a training page does not stand in for the agency's public page, and a budgeted product ask keeps the price the source states. '-e61': the public page of an authority outranks its training page, a verdict keeps the strength the source states, a number inside a quotation stays, and a priced shopping pick outranks an unpriced one. '-e60': a spelling line does not change a real word, a tax dollar has to match the rate and the price on that same line, a clinic page is not a paper, and a verdict names a model the card's table already compares. '-e59': a given name plus a workplace is that person even without "who is", and a named person or named thing never takes a stock or Flickr picture. '-e58': a workplace plus a given name resolves in either word order, and a person card shows the portrait on a page it cites. '-e57': a computed answer uses facts on the card or abstains, a news ask waits for newsroom rows, a short-name list gets pictures, and a person card is not titled with the question. '-e56': a briefing's rows named after a format word (tldr) follow the news. '-e55': a one-person profile is titled with the name, and a date abbreviation never takes a citation. '-e54': an age reads the card's own Born row, a which-members table No turns Yes for a credited member, a middle-initial person keeps the namesake's pictures out, and a news ask leads with newsrooms. '-e53': a fact lead never rewrites an unrelated figure, a year-only age is its two possible values, a today ask waits for dated rows, and no-derivatives pictures are left out. '-e52': a one-person card shows only that person, a workplace picks the people offered, and a snippet-only person card is the standard profile. '-e51': a which-members card reads the named work, and a shared theme credit is not a yes. '-e50': a which-members yes has to be someone in the group the question names. '-e49': a ratio reads a length the card already shows, including on a slider. '-e48': a ratio's quotient stays a hero, and the person next to the verb is the one credited. '-e47': a naming century keeps its ordinal, and a yes is only a person a source credits on their own. '-e46': the quotient is a hero, not a rewritten citation, and a group credit does not mark every named person yes. '-e45': a ratio leads with the quotient of the two lengths already in hand, a naming century is not the century the custom began, and a yes names a person only when a source places them next to that work. '-e44': a question that needs more than one fact keeps searching for the missing one, and the card leads with the age, quotient, year, score, or century those facts imply. '-e43': an office title is not a person lookup, a kept number still drops a year hole, and a partial source set gets one more search for the fact it is missing. '-e42': a preprint ask leads with arxiv.org on every ranking pass, including after official re-sort and when the Atom catalog misses. '-e41': first preprint-lead attempt. '-e40': paper asks also read the arXiv catalog (in parallel with OpenAlex and Crossref), skip planner rewrites, and keep arXiv-only preprints. '-e39': academic-publication asks run the paper lane, a missing year or count drops the clause instead of leaving a hole, and government / journal-of-record / state pages lead on those facts. '-e38': a disambiguation list that names a middle-initial person offers that person beside the famous one. '-e37': the disambiguation extract gets long enough to return from the edge. '-e36': the disambiguation extract is fetched even when a short snippet is already in the results. '-e35': a disambiguation list that names a middle-initial person is read from the extract, so the picker is not skipped when the summary omits the list. An agency name on a tile label stays only when that tile cites the agency. '-e34': an agency label with a comma or a "per the agency" clause stays only on that agency's page, a percent sign leaves with the number it belonged to, and a snippet that repeats a typo does not hide the spelling the title uses. '-e33': a cited number has to be on the fetched page, an official site is searched for when it is missing, a keep-only follow-up keeps its sources, a research DOI has to match the topic, and a corrected spelling is labeled. '-e32': backup engines correct a misspelling, a named official site leads, a paper's year has to match, a budget is not a price, and a city tax uses the combined rate. '-e31': a number no page states is dropped, and a middle-name namesake does not split an exact article. '-e30': a shopping ask keeps forum posts so product photos stay. '-e29': a cited number has to be on the cited page, research asks lead with papers, and a misspelled name still searches. '-e28': price asks answer from a live quote, so stale-price cards ("Btc Usd" at an old high, saved for a day) must not replay. '-e27': per-query TTL (shared/cacheTtl.ts), so answers saved for a day under the old flat TTL must not replay. '-e26' (entity4: LangSearch-path labels, famous-name single, pick source gate, never-empty picks, picked-person header; e25 is V7's). '-e24' (t457 SPD5): pictures not found within 1.5 s of the text are left out, so capped cards are kept apart from e23 cards (full picture wait). '-e23' (t457 SPD-C4b): Crossref fallback (OpenAlex 429s the CF edge), so e22 paper cards cached with no scholarly sources must not replay. '-e22' (t457 SPD-C4): paper/DOI asks add OpenAlex works as sources, so cards cached without DOIs must not replay (skips e18 V6, e19/e21 Backend vendor, e20 reverted C2). '-e17' (t457 SPD-C1): long questions naming a capitalised topic are no longer person asks, so fact-check and product cards cached with 0-1 sources must not replay (skips e15 reverted V5 and e16 reserved for entity4). '-e14': t451b purge of a soccer namesake photo cached on the Ray Lee BlueFlame card. '-e13': t451 imageGate relax (single-entity person cards cached with 0 photos; skips '-e11'/'-e12', which hold reverted V3/V4 vendor-price cards). '-e10': entity2 reverted (its e9 person cards must not replay). '-e9': batch C entity2/verdict2 (cached person and yes/no cards from e8 would skip the new choices and labels). '-e8': purge cards whose stored plan carried the router name, and cards from before the verdict gate (skips '-e7', which holds reverted vendor-price cards). '-e6': t444 entity filter fix. '-e5': t444 purge of a profile cached with a namesake's photo. '-e4': T443 purge of cards cached with a metric stat photo ("Points"). '-e3': T442 purge of cards cached before row pictures (and '-e2': T424 edge purge). Every answer cached before this ship (incl. Wikipedia-only cards) is unreachable.
  let url = `https://answer-cache.zo.internal/${ANSWER_CACHE_VERSION}-e89?q=${q}&f=${input.freshness}`;
  if (input.context) url += `&c=${fnv1a(input.context)}`;
  return url;
}

/** Finished, non-degraded answers only. Extractive fallbacks are not locked in for a day. */
export function storableAnswer(frames: { event: string; data: unknown }[]): boolean {
  let done = false;
  let error = false;
  let node = false;
  let extractive = false;
  for (const frame of frames) {
    if (frame.event === 'error') error = true;
    else if (frame.event === 'node') node = true;
    else if (frame.event === 'done') {
      done = true;
      if (frame.data !== null && typeof frame.data === 'object' && (frame.data as { engine?: unknown }).engine === 'extractive') extractive = true;
    }
  }
  return done && !error && node && !extractive;
}

export interface AnswerStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function snapshotKey(query: string, freshness = 'any'): string {
  return `zo:answer:${ANSWER_CACHE_VERSION}:${freshness}:${normalizeAnswerQuery(query)}`;
}

export function saveSnapshot(store: AnswerStore, query: string, turns: unknown, now = Date.now()): boolean {
  if (turnsDegraded(turns)) {
    try {
      store.removeItem(snapshotKey(query));
    } catch {
      /* ignore */
    }
    return false;
  }
  try {
    store.setItem(snapshotKey(query), JSON.stringify({ v: 1, savedAt: now, turns }));
    return true;
  } catch {
    return false;
  }
}

/** `maxAgeS`: how long this query's answer stays good (shared/cacheTtl.ts); offline restores keep the full day. */
export function loadSnapshot<T>(store: AnswerStore, query: string, now = Date.now(), maxAgeS = ANSWER_TTL_S): T | undefined {
  const key = snapshotKey(query);
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return undefined;
  }
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const saved = parsed as { v?: unknown; savedAt?: unknown; turns?: T };
  if (saved.v !== 1 || typeof saved.savedAt !== 'number' || !('turns' in saved)) return undefined;
  if (now - saved.savedAt > ANSWER_TTL_S * 1000) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  if (now - saved.savedAt > maxAgeS * 1000) return undefined;
  if (turnsDegraded(saved.turns)) {
    try {
      store.removeItem(key);
    } catch {
      /* ignore */
    }
    return undefined;
  }
  return saved.turns;
}

/** Drop degraded (and unreadable) answer snapshots. Returns how many keys were removed. */
export function purgeDegradedSnapshots(store: AnswerStore & { length: number; key(i: number): string | null }): number {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      let key: string | null = null;
      try {
        key = store.key(i);
      } catch {
        key = null;
      }
      if (key && key.startsWith('zo:answer:')) keys.push(key);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    let raw: string | null;
    try {
      raw = store.getItem(key);
    } catch {
      continue;
    }
    if (raw == null) continue;
    let drop = false;
    try {
      const parsed = JSON.parse(raw) as { turns?: unknown } | null;
      drop = !!parsed && typeof parsed === 'object' && turnsDegraded(parsed.turns) !== null;
    } catch {
      drop = true;
    }
    if (!drop) continue;
    try {
      store.removeItem(key);
      removed += 1;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

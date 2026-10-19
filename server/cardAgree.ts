import type { CardNode } from '../shared/card';
import { SENTENCE_BREAK, joinSpacedDecimals } from '../shared/text';
import { paperOnTopic } from './scholarly';

/**
 * A quote, a verdict, a paper list, a follow-up title, and a shopping line
 * each have to agree with the page or the rest of the card. The checks are
 * string matches on text already in hand.
 */

const QUOTE_ASK = /\b(?:quote|quotation|exact (?:words|wording|line|sentence)|in (?:their|its|his|her) own words|what (?:does|do|did) (?:the |that |this )?(?:page|report|article|study|abstract|guideline|document|site|notice))\b/i;

const QUOTE_STOP = new Set(
  'what when where which does did how many much that this with from have been were will your about into over under than then them they their there these those would could should just like also only most some such very more less best need want make give tell show find help using used according quote quotes quoting exact line lines page pages says said report study paper article sentence words wording document guideline notice official'.split(' '),
);

const REVIEW_DESIGN = /\b(?:systematic reviews?|meta-analyses|meta-analysis|narrative reviews?|scoping reviews?|literature reviews?|review articles?|reviews? of the|(?:a|an|\d{4}) reviews?)\b/i;
const ORIGINAL_DESIGN = /\b(?:original (?:studies|study|research|articles?|papers?)|primary (?:studies|study|research)|research articles?)\b/i;
const HONEST_DESIGN = 'The page does not say whether this is a review or an original study.';

const PEER_ASK = /\bpeer[- ]reviewed\b/i;
const OPEN_ID = /\b(?:10\.\d{4,9}\/[^\s,;)>\]]+|PMC\d{5,}|arxiv:\s*\d{4}\.\d{4,5})\b/i;
const CLINIC = /\b(?:mayo clinic|webmd|healthline|cleveland clinic|medical news today|verywell)\b/i;
const PAPERISH = /\b(?:papers?|studies|study|peer[- ]reviewed|journal|preprints?)\b/i;

const BENEFIT = /\b(?:(?:may|might|can|could)\s+(?:help|reduce|prevent|protect|lower|improve|act|decrease)|(?:linked to|associated with)\s+(?:a )?(?:lower|reduced|decreased)|protective effect|shown to (?:help|protect|reduce|improve))\b/i;
const NEGATED = /\b(?:not|n't|never|without|lacks?|lacking|does not|do not)\b/i;

/** "no" and "No" negate a claim. All-caps "NO" is a name, not a negation. */
function negated(sentence: string): boolean {
  return NEGATED.test(sentence) || /\b(?!NO\b)[Nn]o\b/.test(sentence);
}

const WHERE_ROLE = /\bwhere (?:does|do|did|is|are)\b[\s\S]{0,80}\b(?:teach|teaches|teaching|work|works|working|study|studies|studied|studying|earn|earned|earning|degree|doctorate|ph\.?d|professor|faculty|employed|practice|born|live|lives|lived|based)\b/i;
const INSTITUTION = /\b((?:University|College|Institute)(?:\s+of\s+[A-Z][A-Za-z'’.-]+)+(?:(?:,| -)\s+[A-Z][A-Za-z'’.-]+)?|[A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,4}\s+(?:University|College|Institute))\b/;
const TEACHING = /\b(?:teach\w*|professor|faculty|employed|works?|earn\w*|degree|doctorate|ph\.?d|stud(?:y|ies|ied|ying)|born|lives?|lived|based)\b/i;

const MONEY = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?/;
const COUNT_WORD: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const COUNT_NAME = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const COUNT_PHRASE = /\b(of|among|out of) the (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi;
const NAME_STOP = new Set('best with from this that under pick picks cheapest price prices model models than they them your have been were will just like also only most some such very more less card'.split(' '));

export function wantsNamedQuote(query: string): boolean {
  return QUOTE_ASK.test(query);
}

export function wantsPeerPapers(query: string): boolean {
  return PEER_ASK.test(query);
}

function contentWords(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !QUOTE_STOP.has(word)))];
}

function sentencesOf(text: string): string[] {
  const shields: string[] = [];
  const shielded = text.replace(/\b(?:[ap]\.m\.|U\.S\.|U\.K\.|e\.g\.|i\.e\.)/gi, (token) => {
    shields.push(token);
    return `\uE000${shields.length - 1}\uE001`;
  });
  return joinSpacedDecimals(shielded)
    .split(/\n+|(?<=[a-z])\s+(?=[A-Z])/)
    .flatMap((part) => part.split(SENTENCE_BREAK))
    .map((sentence) => sentence.replace(/\uE000(\d+)\uE001/g, (_, index) => shields[Number(index)] ?? '').trim())
    .filter((sentence) => sentence.length >= 20 && /[a-z]/i.test(sentence));
}

function overlap(text: string, words: readonly string[]): number {
  const low = text.toLowerCase();
  return words.filter((word) => low.includes(word)).length;
}

/** "According to the current Physical Activity Guidelines, adults need…" reports a source; it is not the source's line. */
const ATTRIBUTION = /^\s*(?:according to|per|as (?:stated|noted|outlined|set out) (?:in|by)|based on|under)\b[^,]{3,120},\s*/i;

/** The sentence's own claim, without a lead clause that names who said it. */
function ownWords(sentence: string): string {
  return sentence.replace(ATTRIBUTION, '');
}

/**
 * A secondhand sentence ranks below the source's own words, however many of the question's words it repeats. The
 * splitter can cut "…Guidelines for Americans, adults need…" after its attribution, so the page's full sentence is read.
 */
function secondhand(sentence: string, page = ''): number {
  if (ATTRIBUTION.test(sentence)) return 3;
  const at = page.indexOf(sentence);
  if (at <= 0) return 0;
  const start = Math.max(page.lastIndexOf('.', at - 1), page.lastIndexOf('!', at - 1), page.lastIndexOf('?', at - 1), page.lastIndexOf('\n', at - 1)) + 1;
  return ATTRIBUTION.test(page.slice(start, at + sentence.length)) ? 3 : 0;
}

/** A table cell, a word jammed onto a digit, or a run of figures is not a sentence to quote. */
function quotableSentence(text: string): boolean {
  if (/[a-z]\d/i.test(text)) return false;
  if (text.split(/\s+/).filter(Boolean).length < 6) return false;
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).length < 5;
}

/** An agency or page the question names ("the NWS page", "FDA"). A nearby sentence does not. */
function namedSources(query: string): string[] {
  const out: string[] = [];
  for (const match of query.matchAll(/\b[A-Z]{2,6}\b/g)) out.push(match[0].toLowerCase());
  for (const match of query.matchAll(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+(?:site|page|report|article|guideline|document)\b/g)) {
    const name = match[1]!.toLowerCase();
    if (!QUOTE_STOP.has(name)) out.push(name);
  }
  return [...new Set(out)];
}

function namesAskedSource(text: string, named: readonly string[]): boolean {
  return named.some((name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

function sourceBlob(source: { text: string; stated?: string }): string {
  return source.stated ? `${source.stated}\n${source.text}` : source.text;
}

function loose(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The sentence on this page that shares the question's words. A neighbor with fewer of those words is not it. */
export function answeringSentence(query: string, text: string): string | undefined {
  const words = contentWords(query);
  if (!words.length) return undefined;
  const need = words.length === 1 ? 1 : 2;
  const asksNumber = /\b(?:how many|how much|count|number|figure|total)\b/i.test(query);
  let best: { sentence: string; score: number } | undefined;
  for (const sentence of sentencesOf(text)) {
    if (!quotableSentence(sentence)) continue;
    const hit = overlap(ownWords(sentence), words);
    if (hit < Math.min(need, words.length)) continue;
    const score = hit + (asksNumber && /\d/.test(sentence) ? 1 : 0) - secondhand(sentence, text);
    if (!best || score > best.score) best = { sentence, score };
  }
  return best?.sentence;
}

function sentenceHolding(fragment: string, sources: readonly { text: string; stated?: string }[]): string | undefined {
  const key = loose(fragment).slice(0, 48);
  if (key.length < 12) return undefined;
  for (const source of sources) {
    for (const sentence of sentencesOf(sourceBlob(source))) {
      if (loose(sentence).includes(key)) return sentence;
    }
  }
  return undefined;
}

/** The quotation is the start of a source sentence that keeps going. The period on a cut number does not make it finished. */
function cutOff(fragment: string, sentence: string | undefined): boolean {
  if (!sentence) return false;
  const quoted = loose(fragment);
  const full = loose(sentence);
  if (quoted.length < 12 || !full.startsWith(quoted)) return !/[.!?]"?\s*$/.test(fragment) && sentence.length > fragment.length + 8;
  return full.length > quoted.length + 2;
}

function quoteSpan(text: string): { body: string; open: string; close: string; at: number; end: number } | undefined {
  const marks = [text.indexOf('"'), text.indexOf('“'), text.indexOf('«')].filter((index) => index >= 0);
  if (!marks.length) return undefined;
  const openAt = Math.min(...marks);
  const opener = text[openAt]!;
  const closer = opener === '“' ? '”' : opener === '«' ? '»' : '"';
  const inside = text.slice(openAt + 1);
  const closed = inside.indexOf(closer);
  const body = (closed >= 0 ? inside.slice(0, closed) : inside).trim();
  if (body.length < 12) return undefined;
  const end = closed >= 0 ? openAt + 1 + closed + closer.length : text.length;
  return { body, open: opener, close: closer, at: openAt, end };
}

function proseEnough(text: string): boolean {
  return text.split(/\s+/).filter(Boolean).length >= 8;
}

function answerScore(query: string, text: string, words: readonly string[]): number {
  if (!quotableSentence(text)) return -1;
  const asksNumber = /\b(?:how many|how much|count|number|figure|total)\b/i.test(query);
  return overlap(ownWords(text), words) + (asksNumber && /\d/.test(text) ? 1 : 0) - secondhand(text);
}

/** The line is a sentence this fetch already contains. */
/** A site label glued on the front ("NIOSH Most adults…") is not part of the sentence. */
function withoutLeadLabel(sentence: string): string {
  return sentence.replace(/^(?:\|\s*)?(?:[A-Z][A-Za-z0-9.&'-]{1,24}\s+){1,3}(?=(?:Most|The|Adults|A|An)\b)/, '').replace(/^\|+\s*/, '').trim();
}

function onSource(text: string, sources: readonly { text: string; stated?: string }[]): boolean {
  const key = loose(text).slice(0, 40);
  if (key.length < 16) return false;
  return sources.some((source) => loose(sourceBlob(source)).includes(key));
}

/**
 * A quotation is the source sentence that answers the question, whole, with the numbers that sentence states.
 * A truncated fragment is finished from that sentence. A nearby sentence with fewer of the question's words is replaced.
 */
export function finishQuotedText(query: string, text: string, sources: readonly { text: string; stated?: string }[]): string {
  if (!text || !sources.length) return text;
  const words = contentWords(query);
  const quote = quoteSpan(text);
  const held = quote ? sentenceHolding(quote.body, sources) : undefined;
  const truncated = !!quote && cutOff(quote.body, held);
  let chosen: string | undefined;
  const smashed = !!quote && /[a-z]\d/i.test(quote.body);
  const subject = quote ? (held ?? quote.body) : text;
  if (wantsNamedQuote(query) && words.length) {
    const named = namedSources(query);
    const bonus = (sentence: string) => (named.length && namesAskedSource(sentence, named) ? 100 : 0);
    const offPage = !onSource(quote ? quote.body : text, sources);
    const asksNumber = /\b(?:how many|how much|count|number|figure|total)\b/i.test(query);
    const heldAnswers = !!held && (!asksNumber || /\d/.test(held));
    let best = smashed || offPage ? -1 : answerScore(query, subject, words) + bonus(subject);
    const narrow = !named.length && held && heldAnswers ? sources.filter((source) => loose(sourceBlob(source)).includes(loose(held).slice(0, 40))) : sources;
    const pool = narrow.length ? narrow : sources;
    for (const source of (pool.length ? pool : sources)) {
      const answer = answeringSentence(query, sourceBlob(source));
      if (!answer) continue;
      const score = answerScore(query, answer, words) + bonus(answer) - secondhand(answer, sourceBlob(source));
      if (score > best) {
        chosen = answer;
        best = score;
      }
    }
  }
  if (!chosen && truncated && held && !smashed) chosen = held;
  if (!chosen && quote && smashed && wantsNamedQuote(query)) {
    return `${text.slice(0, quote.at)}${text.slice(quote.end)}`.replace(/[ \t]{2,}/g, ' ').trim();
  }
  if (wantsNamedQuote(query) && !chosen && !/[a-z]/i.test(text)) return '';
  if (chosen) chosen = withoutLeadLabel(chosen);
  const bare = !/[a-z]{3,}/i.test(text);
  if (chosen && wantsNamedQuote(query) && !quote && (proseEnough(text) || /["“«]/.test(text) || bare)) {
    const clean = chosen.replace(/^["“«]+|["”»]+$/g, '').trim();
    if (clean.length >= 12) return `"${clean}"`;
  }
  if (!chosen && quote && wantsNamedQuote(query)) {
    const cleaned = withoutLeadLabel(quote.body);
    if (cleaned !== quote.body && cleaned.length >= 12) {
      return `${text.slice(0, quote.at)}${quote.open}${cleaned}${quote.close}${text.slice(quote.end)}`.replace(/[ \t]{2,}/g, ' ').trim();
    }
  }
  if (!chosen || !quote) return text;
  const clean = withoutLeadLabel(chosen.replace(/^["“«]+|["”»]+$/g, '').trim());
  return `${text.slice(0, quote.at)}${quote.open}${clean}${quote.close}${text.slice(quote.end)}`.replace(/[ \t]{2,}/g, ' ').trim();
}

function designKind(text: string): 'review' | 'original' | undefined {
  if (REVIEW_DESIGN.test(text)) return 'review';
  if (ORIGINAL_DESIGN.test(text)) return 'original';
  return undefined;
}

/** A review or an original study is named only when the page says so. Otherwise the card says the page does not. */
export function honestStudyText(query: string, text: string, sources: readonly { text: string }[]): string {
  if (!PAPERISH.test(query) || !designKind(text)) return text;
  const blob = sources.map((source) => source.text).join('\n');
  const stated = { review: REVIEW_DESIGN.test(blob), original: ORIGINAL_DESIGN.test(blob) };
  return text.split(SENTENCE_BREAK).map((sentence) => {
    const kind = designKind(sentence);
    if (!kind) return sentence;
    if (kind === 'review' && stated.review) return sentence;
    if (kind === 'original' && stated.original) return sentence;
    return HONEST_DESIGN;
  }).join(' ');
}

function sourceBacksPaper(text: string, sources: readonly { text: string; domain?: string }[]): boolean {
  if (CLINIC.test(text)) return false;
  const id = text.match(OPEN_ID)?.[0]?.toLowerCase().replace(/\s+/g, '');
  if (id) return sources.some((source) => !CLINIC.test(`${source.domain ?? ''} ${source.text}`) && source.text.toLowerCase().replace(/\s+/g, '').includes(id));
  const title = text.split(/[.(]/)[0]?.trim().toLowerCase() ?? '';
  if (title.length < 12) return false;
  const head = title.slice(0, 48);
  return sources.some((source) => {
    const blob = `${source.domain ?? ''} ${source.text}`;
    if (CLINIC.test(blob) || !source.text.toLowerCase().includes(head)) return false;
    return OPEN_ID.test(source.text) || /\b(?:doi\.org|ncbi\.nlm\.nih\.gov|pubmed|arxiv\.org)\b/i.test(blob);
  });
}

/** A quoted title on a peer-reviewed ask has to be a title a source states. */
export function dropInventedTitles(query: string, text: string, sources: readonly { text: string }[]): string {
  if (!wantsPeerPapers(query)) return text;
  const kept = text.split(SENTENCE_BREAK).filter((sentence) => {
    const titles = [...sentence.matchAll(/"([^"]{12,})"/g)].map((match) => match[1]!.toLowerCase().slice(0, 40));
    if (!titles.length) return true;
    return titles.every((title) => sources.some((source) => source.text.toLowerCase().includes(title)));
  });
  return kept.join(' ').trim();
}

/** On a peer-reviewed ask, a list row stays only when a source states that paper and an open identifier. */
export function peerPaperItems<T extends { text: string; meta?: string }>(query: string, items: readonly T[], sources: readonly { text: string; domain?: string }[]): T[] {
  if (!wantsPeerPapers(query)) return [...items];
  // The identifier often sits in the row's detail ("DOI: 10.1001/jama.2021.3224") beside a short name in its text.
  return items.filter((item) => sourceBacksPaper(item.text, sources) || (!!item.meta && OPEN_ID.test(item.meta) && sourceBacksPaper(item.meta, sources)));
}

export interface PaperSource {
  title?: string;
  url?: string;
  text: string;
  domain?: string;
}

/**
 * A peer-reviewed ask with no paper titles is not an answer.
 * Titles come from sources that already name the paper and an open identifier.
 */
export function fillPaperCard(query: string, nodes: readonly (CardNode | undefined)[], sources: readonly PaperSource[]): (CardNode | undefined)[] {
  if (!wantsPeerPapers(query)) return [...nodes];
  const present = nodes.filter((node): node is CardNode => !!node);
  const backed = paperItems(present).filter((item) => sourceBacksPaper(item.text, sources));
  const seen = new Set<string>();
  const fromSources = sources.flatMap((source) => {
    const title = (source.title ?? '').split(/\s+[|–—-]\s+/)[0]?.trim() ?? '';
    const blob = `${source.title ?? ''} ${source.url ?? ''} ${source.text}`;
    if (title.length < 12 || CLINIC.test(blob) || !OPEN_ID.test(blob) || !paperOnTopic(query, title, source.text)) return [];
    const id = blob.match(OPEN_ID)?.[0];
    const text = id ? `${title} (${id})` : title;
    const key = title.toLowerCase().slice(0, 48);
    if (seen.has(key) || !sourceBacksPaper(text, [source])) return [];
    seen.add(key);
    return [{ text }];
  });
  if (backed.length || !fromSources.length) return [...nodes];
  // Each position is a slot on screen, so the list fills an empty slot or joins the lead component; a node added past
  // the last slot, or a removed one, would never be shown or would shift every later component into the wrong slot.
  const list: CardNode = { type: 'list', style: 'number', items: fromSources.slice(0, 5) };
  const out = [...nodes];
  const empty = out.findIndex((node) => !node || (node.type === 'stack' && !node.children.length) || (node.type === 'list' && !node.items.length));
  if (empty >= 0) {
    out[empty] = list;
    return out;
  }
  const lead = out.findIndex((node) => !!node);
  if (lead < 0) return [list];
  out[lead] = { type: 'stack', direction: 'col', gap: 'md', children: [out[lead]!, list] };
  return out;
}

export function peerPaperSource(query: string, source: { text: string; domain?: string } | undefined): boolean {
  if (!wantsPeerPapers(query)) return true;
  if (!source) return false;
  return sourceBacksPaper(`${source.domain ?? ''} ${source.text}`, [source]) || (!CLINIC.test(`${source.domain ?? ''} ${source.text}`) && OPEN_ID.test(source.text));
}

function paperItems(nodes: readonly CardNode[]): { text: string }[] {
  const out: { text: string }[] = [];
  const walk = (node: CardNode): void => {
    if (node.type === 'list') out.push(...node.items);
    else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') node.children.forEach(walk);
    else if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  nodes.forEach(walk);
  return out;
}

/**
 * A keep-only follow-up drops items that are not peer-reviewed. It does not drop a paper
 * the previous card listed that a source still identifies.
 */
export function restoreKeptPapers(
  question: string,
  nodes: readonly (CardNode | undefined)[],
  base: readonly CardNode[] | undefined,
  sources: readonly { text: string; domain?: string }[],
): (CardNode | undefined)[] {
  if (!base?.length || !/\b(?:keep only|drop any|only the)\b/i.test(question) || !wantsPeerPapers(question)) return [...nodes];
  const kept = peerPaperItems(question, paperItems(base), sources);
  if (kept.length < 2) return [...nodes];
  let placed = false;
  const next = nodes.map((node) => {
    if (!node || node.type !== 'list' || placed) return node;
    placed = true;
    const have = new Set(node.items.map((item) => item.text.toLowerCase().slice(0, 48)));
    const items = [
      ...node.items.filter((item) => sourceBacksPaper(item.text, sources)),
      ...kept.filter((item) => !have.has(item.text.toLowerCase().slice(0, 48))),
    ];
    return items.length === node.items.length && items.every((item, index) => item.text === node.items[index]?.text) ? node : { ...node, items };
  });
  if (placed) return next;
  return [{ type: 'list', style: 'number', items: kept }, ...next];
}

/** A line that asserts a benefit the verdict has already rejected. */
export function fightsVerdict(text: string): boolean {
  return text.split(SENTENCE_BREAK).some((sentence) => BENEFIT.test(sentence) && !negated(sentence));
}

export function withoutFighting(text: string): string {
  return text.split(SENTENCE_BREAK).filter((sentence) => !(BENEFIT.test(sentence) && !negated(sentence))).join(' ').trim();
}

function proseOf(nodes: readonly (CardNode | undefined)[]): string {
  return nodes.map((node) => (node ? JSON.stringify(node) : '')).join(' ');
}

/** A stack with no words is an empty body. A value, a caption, or a sentence is not. */
function hasProse(nodes: readonly (CardNode | undefined)[]): boolean {
  const words = proseOf(nodes).replace(/"(?:type|tone|size|style|icon|id|url|href|src)"\s*:\s*"[^"]*"/g, ' ').match(/[A-Za-z]{3,}/g) ?? [];
  return words.length >= 3;
}

/** A sentence from the sources that names the institution, or the institution itself. */
function placeSentence(sourceText: string): string {
  const school = sourceText.match(INSTITUTION)?.[1]?.trim();
  if (!school) return '';
  const sentence = sentencesOf(sourceText).find((line) => line.toLowerCase().includes(school.toLowerCase()));
  if (sentence) return sentence.replace(/\s+/g, ' ').trim();
  return school;
}

/** The first source sentence that names the person the question asks about. */
function bioSentence(question: string, sourceText: string): string {
  const name = question.replace(/^(?:who\s+is|who\s+was|who's)\s+/i, '').replace(/[?.!]+$/g, '').trim();
  const surname = name.split(/\s+/).filter((word) => /^[A-Z]/.test(word)).at(-1)?.toLowerCase();
  if (!surname) return '';
  return sentencesOf(sourceText).find((line) => line.toLowerCase().includes(surname))?.replace(/\s+/g, ' ').trim() ?? '';
}

/**
 * A where-they-work follow-up and a who-is ask keep a body. An empty stack is not an answer.
 * The sentence is one the sources already wrote.
 */
export function keepAnswerBody(question: string, nodes: readonly (CardNode | undefined)[], sourceText: string): (CardNode | undefined)[] {
  if (hasProse(nodes)) return [...nodes];
  const where = WHERE_ROLE.test(question);
  const who = /^(?:who\s+is|who\s+was|who's)\b/i.test(question.trim());
  const sentence = where ? placeSentence(sourceText) : who ? bioSentence(question, sourceText) : '';
  if (!sentence) return [...nodes];
  const text: CardNode = { type: 'text', text: sentence, size: 'lg' };
  if (!nodes.length) return [text];
  let placed = false;
  return nodes.map((node) => {
    if (placed || hasProse([node])) return node;
    placed = true;
    return text;
  });
}

function schoolIn(text: string): string | undefined {
  const school = text.match(INSTITUTION)?.[1]?.trim();
  if (!school) return undefined;
  return school.length <= 48 ? school : school.slice(0, 48).replace(/\s+\S*$/, '');
}

/** The headline answers the new question: where someone works is the institution, and a what-if price is the tax on that price. */
export function answerTitle(question: string, proposed: string, cardText: string): string {
  if (WHERE_ROLE.test(question)) {
    const cueAt = cardText.search(TEACHING);
    if (cueAt >= 0) {
      const school = schoolIn(cardText.slice(Math.max(0, cueAt - 40), cueAt + 180));
      if (school) return school;
    }
    const lead = cardText.match(/"type":"hero","value":"([^"]{2,80})"/)?.[1]?.trim();
    if (lead && !/^(?:no|yes|mixed|unclear)\b/i.test(lead)) return schoolIn(lead) ?? (lead.length <= 48 ? lead : lead.slice(0, 48).replace(/\s+\S*$/, ''));
    const school = schoolIn(cardText);
    if (school && !proposed.toLowerCase().includes(school.toLowerCase())) return school;
  }
  const priced = question.match(/\bwhat if\b[\s\S]{0,80}\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)|\b(?:sales\s+tax|tax)\b[\s\S]{0,40}\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const raw = priced?.[1] ?? priced?.[2];
  if (!raw) return proposed;
  const asked = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(asked)) return proposed;
  const beside = cardText.match(/tax[^\n$]{0,40}\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i)?.[1]
    ?? cardText.match(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)[^\n.]{0,24}\btax\b/i)?.[1];
  const dollars = [...cardText.matchAll(/\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g)]
    .map((match) => Number(match[1]!.replace(/,/g, '')))
    .filter((amount) => amount > 0 && Math.abs(amount - asked) > 0.001 && amount < asked);
  const due = beside ? Number(beside.replace(/,/g, '')) : dollars[0];
  if (due !== undefined) {
    const title = `Tax $${due.toFixed(2)}`;
    return proposed.includes(due.toFixed(2)) ? proposed : title;
  }
  if (/\bexempt\b/i.test(cardText)) return /tax/i.test(proposed) ? proposed : 'No tax';
  const rate = cardText.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
  if (rate && /\btax/i.test(cardText) && !proposed.includes(rate[1]!)) return `${rate[1]}% tax`;
  return proposed;
}

function moneyValue(raw: string): number {
  return Number(raw.replace(/[^\d.]/g, ''));
}

function firstPrice(text: string, ceilings: readonly number[]): { value: number; raw: string } | undefined {
  const re = new RegExp(`(?:under|below|less than|up to|at most)?\\s*${MONEY.source}`, 'gi');
  for (const match of text.matchAll(re)) {
    const raw = match[0].match(MONEY)?.[0];
    if (!raw) continue;
    const value = moneyValue(raw);
    const lead = match[0].slice(0, match[0].toLowerCase().indexOf('$'));
    if (/\b(?:under|below|less than|up to|at most)\b/i.test(lead) && ceilings.includes(value)) continue;
    return { value, raw: raw.replace(/\s/g, '') };
  }
  return undefined;
}

function namesOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !NAME_STOP.has(word)))];
}

interface PricedPick { names: string[]; price?: number; raw?: string }

function collectPicks(nodes: readonly (CardNode | undefined)[], ceilings: readonly number[]): PricedPick[] {
  const out: PricedPick[] = [];
  const take = (name: string, extra = ''): void => {
    const price = firstPrice(`${extra} ${name}`, ceilings);
    out.push({ names: namesOf(name), price: price?.value, raw: price?.raw });
  };
  const walk = (node: CardNode): void => {
    if (node.type === 'list') node.items.forEach((item) => take(item.text, item.meta ?? ''));
    else if (node.type === 'table') node.rows.forEach((row) => take(row[0] ?? '', row.join(' ')));
    else if (node.type === 'tile') take(node.label, `${node.value ?? ''} ${node.sub ?? ''}`);
    else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') node.children.forEach(walk);
    else if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  for (const node of nodes) if (node) walk(node);
  return out.filter((pick) => pick.names.length);
}

function shownCount(nodes: readonly (CardNode | undefined)[]): number | undefined {
  let table = 0;
  let list = 0;
  let tiles = 0;
  const walk = (node: CardNode): void => {
    if (node.type === 'table') table += node.rows.length;
    else if (node.type === 'list') list += node.items.length;
    else if (node.type === 'tile') tiles += 1;
    else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') node.children.forEach(walk);
    else if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  for (const node of nodes) if (node) walk(node);
  if (table) return table;
  if (list) return list;
  if (tiles >= 2) return tiles;
  return undefined;
}

function withCount(text: string, count: number | undefined): string {
  if (!count) return text;
  return text.replace(COUNT_PHRASE, (phrase, prep: string, word: string) => {
    const stated = COUNT_WORD[word.toLowerCase()] ?? Number(word);
    if (!Number.isFinite(stated) || stated === count) return phrase;
    if (count === 1) return prep === 'of' ? '' : phrase;
    const name = COUNT_NAME[count] ?? String(count);
    return `${prep} the ${name}`;
  }).replace(/\s{2,}/g, ' ').trim();
}

function withRowPrice(text: string, picks: readonly PricedPick[]): string {
  const low = text.toLowerCase();
  const named = picks.filter((pick) => {
    if (pick.price === undefined || !pick.raw) return false;
    const distinctive = pick.names.filter((name) => picks.filter((other) => other.names.includes(name)).length === 1);
    const tokens = distinctive.length ? distinctive : pick.names;
    return tokens.some((name) => low.includes(name));
  });
  if (named.length !== 1) return text;
  const pick = named[0]!;
  return text.replace(new RegExp(`(?:under|below|less than|up to|at most)?\\s*${MONEY.source}`, 'gi'), (all) => {
    const lead = all.slice(0, all.toLowerCase().indexOf('$'));
    if (/\b(?:under|below|less than|up to|at most)\b/i.test(lead)) return all;
    const raw = all.match(MONEY)?.[0];
    if (!raw || Math.abs(moneyValue(raw) - pick.price!) < 0.001) return all;
    return `${lead}${pick.raw}`;
  });
}

function overBudget(text: string, ceiling: number, ceilings: readonly number[]): boolean {
  const price = firstPrice(text, ceilings);
  return !!price && price.value > ceiling;
}

function inBudget(text: string, ceiling: number, ceilings: readonly number[]): boolean {
  const price = firstPrice(text, ceilings);
  return !!price && price.value <= ceiling;
}

function anyInBudget(nodes: readonly (CardNode | undefined)[], ceiling: number, ceilings: readonly number[]): boolean {
  const texts: string[] = [];
  const walk = (node: CardNode): void => {
    if (node.type === 'list') node.items.forEach((item) => texts.push(`${item.meta ?? ''} ${item.text}`));
    else if (node.type === 'table') node.rows.forEach((row) => texts.push(row.join(' ')));
    else if (node.type === 'tile') texts.push(`${node.label} ${node.value ?? ''} ${node.sub ?? ''}`);
    else if (node.type === 'stack' || node.type === 'grid' || node.type === 'section' || node.type === 'scroller') node.children.forEach(walk);
    else if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach(walk));
  };
  for (const node of nodes) if (node) walk(node);
  return texts.some((text) => inBudget(text, ceiling, ceilings));
}

/**
 * A count phrase matches how many picks are on the card. A headline price is the price on that pick's row.
 * A priced pick over the stated budget does not stay once another pick is inside it.
 */
export function agreeShopping(shopping: boolean, ceilings: readonly number[], nodes: readonly (CardNode | undefined)[]): (CardNode | undefined)[] {
  if (!shopping) return [...nodes];
  const ceiling = ceilings.length ? Math.min(...ceilings) : undefined;
  const keepInside = ceiling !== undefined && anyInBudget(nodes, ceiling, ceilings);
  const filtered = keepInside
    ? nodes.map((node) => trimOverBudget(node, ceiling!, ceilings))
    : [...nodes];
  const picks = collectPicks(filtered, ceilings);
  const count = shownCount(filtered);
  return filtered.map((node) => (node ? retitleShopping(node, picks, count) : node));
}

function trimOverBudget(node: CardNode | undefined, ceiling: number, ceilings: readonly number[]): CardNode | undefined {
  if (!node) return node;
  switch (node.type) {
    case 'list': {
      const items = node.items.filter((item) => !overBudget(`${item.meta ?? ''} ${item.text}`, ceiling, ceilings));
      if (!items.length) return node;
      return items.length === node.items.length ? node : { ...node, items };
    }
    case 'tile':
      return overBudget(`${node.label} ${node.value ?? ''} ${node.sub ?? ''}`, ceiling, ceilings) ? undefined : node;
    case 'hero':
      return overBudget(`${node.value} ${node.caption ?? ''} ${node.label}`, ceiling, ceilings) ? undefined : node;
    case 'table': {
      const rows = node.rows.filter((row) => !overBudget(row.join(' '), ceiling, ceilings));
      if (!rows.length) return node;
      return rows.length === node.rows.length ? node : { ...node, rows };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.flatMap((child) => {
        const next = trimOverBudget(child, ceiling, ceilings);
        return next ? [next] : [];
      });
      if (!children.length) return undefined;
      return children.length === node.children.length && children.every((child, index) => child === node.children[index]) ? node : { ...node, children };
    }
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.flatMap((child) => {
        const next = trimOverBudget(child, ceiling, ceilings);
        return next ? [next] : [];
      }) })) };
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading':
    case 'stat':
    case 'keyvalue':
    case 'timeline':
    case 'profile':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

function retitleShopping(node: CardNode, picks: readonly PricedPick[], count: number | undefined): CardNode {
  switch (node.type) {
    case 'text':
    case 'callout':
    case 'quote':
    case 'draft':
    case 'heading': {
      const text = withCount(withRowPrice(node.text, picks), count);
      return text === node.text ? node : { ...node, text };
    }
    case 'hero': {
      const value = withRowPrice(node.value, picks);
      const caption = node.caption ? withCount(withRowPrice(node.caption, picks), count) : node.caption;
      return value === node.value && caption === node.caption ? node : { ...node, value, caption };
    }
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller':
      return { ...node, children: node.children.map((child) => retitleShopping(child, picks, count)) };
    case 'tabs':
      return { ...node, tabs: node.tabs.map((tab) => ({ ...tab, children: tab.children.map((child) => retitleShopping(child, picks, count)) })) };
    case 'tile':
    case 'stat':
    case 'keyvalue':
    case 'list':
    case 'timeline':
    case 'profile':
    case 'table':
    case 'steps':
    case 'accordion':
    case 'proscons':
    case 'badges':
    case 'actions':
    case 'choices':
    case 'links':
    case 'citations':
    case 'chart':
    case 'pricing':
    case 'scaler':
    case 'slider':
    case 'reveal':
    case 'image':
    case 'gallery':
    case 'video':
    case 'code':
    case 'divider':
    case 'progress':
    case 'rating':
    case 'diagram':
    case 'ticker':
    case 'slot':
      return node;
    default: {
      const unreachable: never = node;
      return unreachable;
    }
  }
}

/** A hero that asserts a study design the page does not state says so, instead of naming the other design. */
export function honestHero(query: string, node: Extract<CardNode, { type: 'hero' }>, sources: readonly { text: string }[]): Extract<CardNode, { type: 'hero' }> {
  if (!PAPERISH.test(query)) return node;
  const blob = `${node.value} ${node.caption ?? ''} ${node.label}`;
  const kind = designKind(blob);
  if (!kind) return node;
  const page = sources.map((source) => source.text).join('\n');
  const stated = kind === 'review' ? REVIEW_DESIGN.test(page) : ORIGINAL_DESIGN.test(page);
  if (stated) return node;
  const caption = node.caption && !designKind(node.caption) ? node.caption : HONEST_DESIGN;
  const value = designKind(node.value) ? 'Not stated' : node.value;
  return value === node.value && caption === node.caption ? node : { ...node, value, caption };
}

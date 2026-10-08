/**
 * T453: the follow-up a tapped card box sends, and the `ref` that rides with it.
 *
 * askQuestion() turns a box (label + value + the card's entity) into a natural question:
 * "Agent: AMP" on a BlueFlame AI card -> "What is AMP, BlueFlame AI's agent?".
 * cleanRef()/refContext()/withRef() are the server side: validate the ref, give the
 * rewrite/design prompt a line about it, and keep the tapped thing in the search query.
 * Pure: no DOM, no network.
 */

/** The card box a tapped follow-up is about. Every string is trimmed and at most REF_MAX chars; sourceUrl is https only. */
export interface AskRef { label?: string; value?: string; entity?: string; sourceUrl?: string; snippet?: string }

export type BoxKind = 'tile' | 'stat' | 'row' | 'list' | 'profile' | 'fact' | 'verdict' | 'timeline' | 'link';

export interface Box {
  kind: BoxKind;
  /** Tile/stat/fact label, row/list/link text, profile name, timeline title. */
  label?: string;
  /** Tile/stat/fact value, profile subtitle. */
  value?: string;
  unit?: string;
  /** What the card is about (card title / profile name). */
  entity?: string;
  /** Extra words about a row ("Warriors forward"). */
  detail?: string;
  /** Timeline date. */
  when?: string;
}

export const REF_MAX = 300;

/** Markdown bold, inline [n] markers and extra whitespace removed. */
const clean = (s: string | undefined) => (s ?? '').replace(/\s*\[\d+\]/g, '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

/** Cut at a word near n chars, with … (never a dangling dash/comma before it). */
function cut(s: string, n = 80): string {
  if (s.length <= n) return s;
  const head = s.slice(0, n).replace(/\s+\S*$/, '') || s.slice(0, n);
  return `${head.replace(/[\s—–,;:-]+$/, '')}…`;
}

const isCap = (w: string) => /^[A-Z][a-z'’.-]*$/.test(w);
const isLowerWord = (w: string) => /^[a-z][a-z'’-]*$/.test(w);

/** "Revenue Growth" -> "revenue growth"; keeps ARR, CEO, BlueFlame, iPhone. */
const lowerLabel = (label: string) => label.split(' ').map((w) => (isCap(w) ? w.toLowerCase() : w)).join(' ');

/** "BlueFlame AI" -> "BlueFlame AI's", "Warriors" -> "Warriors'". */
const possessive = (e: string) => (/s$/i.test(e) ? `${e}’`.replace('’', "'") : `${e}'s`);

const isNumeric = (v: string) => /^[~≈<>+−-]?\s*[$€£¥]?\s*\d/.test(v);
const isYear = (v: string) => /^(c\.\s*)?\d{4}s?$/i.test(v) || /^\d{4}-\d{2}(-\d{2})?$/.test(v) || /^[A-Z][a-z]{2,8}\.? \d{4}$/.test(v);
const VERDICT = /^(yes|true|no|false|mixed|unclear|depends|partly)\b/i;
const isVerdict = (v: string | undefined) => !!v && v.trim().length <= 24 && VERDICT.test(v.trim());

const PERSON = /\b(founders?|co-?founders?|ceo|cto|cfo|coo|chief|president|chair(man|woman|person)?|owners?|coach|manager|director|author|creator|inventor|leader|captain|spouse|wife|husband|partner|father|mother|host|mayor|governor|senator|minister|head)\b/i;
const BY: [RegExp, string][] = [
  [/^co-?founded by$/i, 'co-founder'], [/^founded by$/i, 'founder'], [/^led by$/i, 'leader'], [/^created by$/i, 'creator'],
  [/^written by$/i, 'author'], [/^directed by$/i, 'director'], [/^headed by$/i, 'head'], [/^owned by$/i, 'owner'],
];
const LOC = /\b(headquarters|hq|location|based|city|hometown|country|region|address)\b/i;
const EDU = /\b(education|school|college|university|alma mater|studied)\b/i;
const ORG = /\b(company|employer|team|club|organi[sz]ation|works? at)\b/i;
const ROLE = /\b(role|job|title|position|occupation|profession)\b/i;
const START = /\b(founded|launched|established|started|released|introduced|created)\b/i;
const PEOPLE_CONTEXT = /\b(players?|rookies?|people|athletes?|actors?|actress(es)?|singers?|artists?|authors?|candidates?|coach(es)?|picks?|draft|mvp|roster|forward|guard|center|quarterback|pitcher|striker|midfielder|goalkeeper)\b/i;

const LABEL_WORDS = new Set(`agent product model platform type category status stage focus industry sector market customer user employee team size
founded launch release version price pricing cost plan tier funding revenue valuation growth profit income sale share rate score point rebound
assist goal yard win loss record rank rating age height weight population area capacity speed range battery storage memory screen display camera
chip processor engine power fuel mileage salary worth follower subscriber view download language genre award title feature benefit risk pro con use
case integration partner investor competitor rival headquarters hq website app api license owner parent subsidiary brand origin hobby favorite
favourite nickname known specialty skill strength weakness availability support security privacy policy ticker symbol exchange dividend margin debt
cash net gross total average median minimum maximum duration time date year season game match round pick draft contract deal
raised raise acquired acquisition valued backed employees users customers`.split(/\s+/));

/** A label that names a kind of fact ("Agent", "Revenue growth", "Team FG%") rather than a person or thing ("Steph"). */
function isGenericLabel(label: string): boolean {
  const words = label.split(' ');
  if (words.some(isLowerWord)) return true;
  if (/\d|%/.test(label) || words.some((w) => /^[A-Z]{2,}[A-Z0-9&%]*$/.test(w))) return true;
  if ([PERSON, ROLE, LOC, EDU, ORG, START].some((re) => re.test(label)) || BY.some(([re]) => re.test(label))) return true;
  return words.some((w) => {
    const base = w.toLowerCase().replace(/[^a-z]/g, '');
    return LABEL_WORDS.has(base) || LABEL_WORDS.has(base.replace(/s$/, '')) || LABEL_WORDS.has(base.replace(/es$/, ''));
  });
}

const AUX = /^(is|are|was|were|do|does|did|can|could|should|will|would|has|have|had)\s+(.+)$/i;
const NEG: Record<string, string> = { is: "isn't", are: "aren't", was: "wasn't", were: "weren't", do: "don't", does: "doesn't", did: "didn't", can: "can't", could: "couldn't", should: "shouldn't", will: "won't", would: "wouldn't", has: "hasn't", have: "haven't", had: "hadn't" };

/** First word lower-cased when it is an ordinary capitalised word (not a name, not the entity). */
function lowerFirst(s: string, entity?: string): string {
  const [first, second] = s.split(' ');
  if (!first || !isCap(first)) return s;
  if (second && /^[A-Z]/.test(second)) return s;
  if (entity && entity.split(' ')[0].toLowerCase() === first.toLowerCase()) return s;
  return first.toLowerCase() + s.slice(first.length);
}

function verdictQuestion(label: string, value: string, entity?: string): string {
  const p = value.trim().toLowerCase();
  const yes = /^(yes|true)/.test(p);
  const no = /^(no|false)/.test(p);
  const q = label.replace(/\?+$/, '').trim();
  const aux = q.match(AUX);
  if (aux) {
    const a = aux[1].toLowerCase();
    if (yes) return `Why ${a} ${aux[2]}?`;
    if (no) return `Why ${NEG[a]} ${aux[2]}?`;
    return `When ${a} ${aux[2]}?`;
  }
  const claim = lowerFirst(q, entity);
  if (yes) return `Why is it true that ${claim}?`;
  if (no) return `Why is it false that ${claim}?`;
  return `How true is it that ${claim}?`;
}

/** Subject and the rest of a row: "**Yaxel Lendeborg** — Warriors forward" -> ["Yaxel Lendeborg", "Warriors forward"]. */
function split(text: string): [string, string] {
  const m = text.match(/^(.+?)(?:\s[—–-]\s|:\s)(.+)$/);
  if (m) return [m[1].trim(), m[2].trim()];
  const c = text.match(/^([^,]+),\s(.+)$/);
  return c && nameLike(c[1].trim()) ? [c[1].trim(), c[2].trim()] : [text, ''];
}

const nameLike = (s: string) => {
  const w = s.split(' ');
  return w.length >= 2 && w.length <= 4 && w.every((x) => /^[A-Z][A-Za-z'’.-]*$/.test(x));
};

const mentions = (hay: string | undefined, needle: string | undefined) => !!hay && !!needle && hay.toLowerCase().includes(needle.toLowerCase());

function labelOnly(box: Box, label: string, E?: string): string {
  const [subject0, rest] = split(label);
  const subject = cut(subject0, 80);
  const detail = [rest, clean(box.detail)].filter(Boolean).join(' ');
  const ctx = `${detail} ${label} ${E ?? ''}`;
  if (nameLike(subject0) && (PERSON.test(ctx) || PEOPLE_CONTEXT.test(ctx))) return `Who is ${subject}?`;
  if (subject0.split(' ').length > 7) return `Explain "${cut(subject0, 80)}"`;
  if (E && (box.kind === 'tile' || box.kind === 'stat' || box.kind === 'fact') && subject0.split(' ').every((w) => isCap(w) || isLowerWord(w)) && !mentions(subject0, E)) {
    return `What is ${possessive(E)} ${lowerLabel(subject)}?`;
  }
  return `What is ${subject}?`;
}

function labelValue(label: string, V: string, unit: string, E?: string): string {
  const by = BY.find(([re]) => re.test(label));
  const L = by ? by[1] : lowerLabel(label);
  if (!isGenericLabel(label)) {
    if (isYear(V)) return `What happened with ${label} in ${V}?`;
    if (isNumeric(V)) return `What is behind ${possessive(label)} ${V}${unit}?`;
    return `What about ${label} (${V})?`;
  }
  if ((PERSON.test(label) || by) && !isNumeric(V)) {
    const many = /,|\band\b|&/.test(V);
    const role = many && !/s$/.test(L) ? `${L}s` : L;
    return E ? `${many ? 'Who are' : 'Who is'} ${V}, ${possessive(E)} ${role}?` : `${many ? 'Who are' : 'Who is'} ${V}, the ${role}?`;
  }
  if (START.test(label) && isYear(V)) return E ? `How was ${E} ${L} in ${V}?` : `What happened in ${V}?`;
  if (isYear(V)) return E ? `What happened with ${E} in ${V}?` : `What happened in ${V}?`;
  if (isNumeric(V)) return E ? `What is behind ${possessive(E)} ${V}${unit} ${L}?` : `What is behind the ${V}${unit} ${L}?`;
  if (ROLE.test(label)) return E ? `What does ${possessive(E)} role as ${V} involve?` : `What does the role of ${V} involve?`;
  if (LOC.test(label)) return E ? `What is ${possessive(E)} connection to ${V}?` : `What is ${V} known for?`;
  if (EDU.test(label)) return E ? `What did ${E} study at ${V}?` : `What is ${V} known for?`;
  if (ORG.test(label)) return E ? `What does ${E} do at ${V}?` : `What is ${V}?`;
  return E ? `What is ${V}, ${possessive(E)} ${L}?` : `What is the ${L} ${V}?`;
}

/** The natural follow-up a tapped box sends. Never "Ask about …". */
export function askQuestion(box: Box): string {
  const label = cut(clean(box.label), 80);
  const value = cut(clean(box.value), 80);
  const unitRaw = clean(box.unit);
  const unit = !unitRaw ? '' : unitRaw === '%' ? '%' : ` ${unitRaw}`;
  let E: string | undefined = cut(clean(box.entity), 80) || undefined;
  const out = (s: string) => (s.length > 220 ? `${s.slice(0, 219).replace(/\s+\S*$/, '')}…` : s);

  if (box.kind === 'profile') {
    if (!label) return 'What is this?';
    return out(value ? `Who is ${label}, ${lowerFirst(cut(value, 60))}?` : `Who is ${label}?`);
  }
  if (box.kind === 'timeline' && label && box.when) return out(`What happened in ${cut(clean(box.when), 40)}: ${label}?`);
  if ((box.kind === 'verdict' || isVerdict(value)) && label && value) return out(verdictQuestion(label, value, E));
  // An entity the value already names adds nothing ("Company: BlueFlame AI" on a BlueFlame AI card).
  if (E && value && mentions(value, E)) E = undefined;
  // Game tiles ("vs Trail Blazers" / "L 118-123"): ask about the game, keep the opponent's own casing.
  const game = label?.match(/^(vs\.?|v\.?|@|at)\s+(.+)$/i);
  if (game && (box.kind === 'tile' || box.kind === 'stat' || box.kind === 'row')) {
    const side = /^(@|at)$/i.test(game[1]) ? 'at' : 'vs';
    const opp = cut(game[2], 60);
    const who = E ? `${possessive(E)} game` : 'the game';
    if (!value || /^(upcoming|scheduled|tbd|preview|next)\b|\d{1,2}:\d{2}/i.test(value)) return out(`What should I know about ${who} ${side} ${opp}?`);
    return out(`What happened in ${who} ${side} ${opp} (${cut(value, 30)})?`);
  }
  // A sentence-long label reads badly inside the question; ask about the value.
  if (label && value && label.split(' ').length <= 6) return out(labelValue(label, value, unit, E));
  if (value) {
    if (isNumeric(value)) return out(E ? `What is behind ${possessive(E)} ${value}${unit}?` : `What is behind ${value}${unit}?`);
    return out(E ? `What is ${value} at ${E}?` : `What is ${value}?`);
  }
  if (label) return out(labelOnly(box, label, E));
  return 'What is this?';
}

/** The thing a card is about, from its title: "What is BlueFlame AI?" -> "BlueFlame AI"; "BlueFlame AI — agents for funds" -> "BlueFlame AI". */
export function entityOf(title: string | undefined): string | undefined {
  let t = clean(title);
  t = t.replace(/^(what|who)\s+(is|are|was|were)\s+/i, '').replace(/^about\s+/i, '').replace(/\?+$/, '');
  t = t.split(/\s[—–|]\s|:\s|\s\(/)[0].trim();
  if (!t || t.length > 80) return undefined;
  // A topic title ("Best apples for pie", "2026 NBA preseason", "How to …") is not a thing to ask about by name.
  const words = t.split(' ');
  if (/^\d/.test(t) || TOPIC_START.test(words[0]) || words.length > 5) return undefined;
  if (words.filter((w) => isLowerWord(w) && !SMALL.has(w)).length >= 2) return undefined;
  return t;
}

const TOPIC_START = /^(best|top|cheapest|latest|new|how|why|when|where|which|what|who|should|is|are|can|do|does|ways|tips|guide|list|ranking)$/i;
const SMALL = new Set(['of', 'the', 'and', 'for', 'de', 'la', 'del', 'von', 'van', 'to', 'in', 'on', 'at', '&']);

const refText = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, REF_MAX).trim() : '');

/** Server-side validation of a client ref: plain object, strings trimmed and capped, sourceUrl https only. Never throws. */
export function cleanRef(raw: unknown): AskRef | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const ref: AskRef = {};
  for (const k of ['label', 'value', 'entity', 'snippet'] as const) {
    const v = refText(r[k]);
    if (v) ref[k] = v;
  }
  if (typeof r.sourceUrl === 'string' && r.sourceUrl.length <= REF_MAX) {
    try {
      const u = new URL(r.sourceUrl.trim());
      if (u.protocol === 'https:') ref.sourceUrl = u.href;
    } catch {
      /* not a URL: dropped */
    }
  }
  return ref.label || ref.value ? ref : undefined;
}

/** Lines for the rewrite/plan/design context, so the answer is about the tapped thing. */
export function refContext(ref: AskRef): string {
  const head = `${ref.label ?? ''}${ref.label && ref.value ? ': ' : ''}${ref.value ?? ''}`;
  const lines = [`Tapped on the card: ${head}${ref.entity ? ` (about ${ref.entity})` : ''}`];
  if (ref.snippet) lines.push(`Source snippet: ${ref.snippet}`);
  if (ref.sourceUrl) {
    try {
      lines.push(`Source: ${new URL(ref.sourceUrl).hostname.replace(/^www\./, '')}`);
    } catch {
      /* ignore */
    }
  }
  return lines.join('\n');
}

/** A search query that still names the tapped thing and its entity. */
export function withRef(query: string, ref: AskRef | undefined): string {
  if (!ref) return query;
  let q = query;
  const thing = ref.value ?? ref.label;
  if (thing && !mentions(q, thing)) q = `${q} ${thing}`;
  if (ref.entity && !mentions(q, ref.entity)) q = `${q} ${ref.entity}`;
  return q.replace(/\s+/g, ' ').trim().slice(0, 300);
}

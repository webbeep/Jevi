import { NAME_PARTICLE, TOPIC_WORD } from '../shared/askAbout';
import { compareSides } from './patterns';
import { boundAsk } from '../shared/queryBound';
import { nameLike, namesPerson, tokens, type EntityHint } from './imageGate';
import { hasProductModel } from './productModel';
import { isBlockedHost, isFictionHost } from './spamHosts';

/**
 * T444 entity disambiguation for people/profile asks.
 * Before building a profile/person card, pick ONE entity (name+role+org+location)
 * from the top search results. Deterministic, zero extra paid calls.
 */

export interface Entity {
  /** Stable slug from name+role+org (lowercase, hyphenated). */
  id: string;
  name: string;
  role?: string;
  org?: string;
  location?: string;
  /** Disambiguating tokens (role/org/location cores, lowercase). */
  terms: string[];
  /** Official/org hosts from kept sources (no aggregators). */
  domains?: string[];
  aliases?: string[];
}

export interface EntityChoice {
  name: string;
  /** One line, factual — no model/engine names, no fluff. */
  descriptor: string;
  /** Standalone re-ask query. */
  query: string;
  id: string;
  /**
   * EN4 part 8: indices (into the rows this decision saw) of the sources behind this choice.
   * Internal only — the client gets `publicChoices()`, which never carries it.
   */
  seeds?: number[];
}

export type EntityDecision =
  | { kind: 'single'; entity: Entity; kept: number[]; dropped: number[] }
  | { kind: 'choices'; choices: EntityChoice[] }
  | { kind: 'skip' };

export interface EntityRow {
  title: string;
  url: string;
  snippet?: string;
  /** Opening of the fetched page. Snippets often omit the company the page itself names. */
  content?: string;
}

/** Choices ride on the `done` event: the FE reads {name, descriptor, query, id} (shared/choices.ts). */
export function publicChoices(choices: EntityChoice[]): { name: string; descriptor: string; query: string; id: string }[] {
  return choices.map(({ name, descriptor, query, id }) => ({ name, descriptor, query, id }));
}

/** Words that prove a short query is NOT a person name. */
const COMMON = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'at', 'to', 'from', 'with', 'about',
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'best', 'top', 'fastest', 'tallest', 'cheapest', 'newest', 'latest', 'most', 'least', 'first',
  'tell', 'show', 'find', 'give', 'list', 'compare', 'vs', 'versus', 'it', 'this', 'that',
  // SPD-C1 (t457): task verbs that open a request ("Fact-check: Gmail…", "Summarize…", "Recommend 3 books…").
  'fact-check', 'factcheck', 'check', 'verify', 'summarize', 'summarise', 'recommend', 'explain', 'define', 'describe',
]);

const WHO_IS = /^(who\s+is|who\s+was|who's|whos)\b\s*/i;
const ABOUT = /^(tell\s+me\s+about|profile\s+of|biography\s+of|bio\s+of)\s+/i;
/** "How is Nique Clifford…" / "What is …" — strip so Cap runs start at the name. */
const LEAD_Q = /^(who|what|when|where|why|how)\s+(is|are|was|were|did|does|do)\b\s*/i;

const cleanWord = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

/** "Bf", "GE", "JP": a short capitalised abbreviation of a company or school. */
const ABBREV = /^[A-Z][A-Za-z]$/;
const NAME_SUFFIX = /^(jr|sr|ii|iv|vi|dr|mr|ms|md)$/i;
/** Org/product-ish Cap tokens that end a person+org query ("Ray Lee BlueFlame AI"). */
const ORG_TAIL = /^(ai|ml|io|inc|llc|ltd|corp|co|labs?|technologies|technology|group|studios?|systems?|partners?|associates?)$/i;
const SPORTS_LEAGUE = /^(nba|nfl|mlb|nhl|ncaa|wnba|mls|pga|ufc|wwe)$/i;
/** Ends a Cap name run: CamelCase orgs, Inc/AI tails, or ALL-CAPS acronyms (USATF). */
const looksLikeOrgToken = (w: string) =>
  ORG_TAIL.test(w) ||
  /[a-z][A-Z]/.test(w) ||
  (/^[A-Z]{3,}$/.test(w) && !/^(JR|SR|II|III|IV)$/.test(w));

/**
 * Occupation/descriptor words that name no part of a person's name, as they come from a
 * Wikipedia qualifier ("John Smith (explorer)", "David Kim (restaurateur)"). Most are also
 * in ROLE1 below; a qualifier can carry either kind of word.
 */
const DESCRIPTOR_WORDS = new Set([
  'explorer', 'housebreaker', 'artist', 'athlete', 'violinist', 'restaurateur', 'footballer', 'analyst',
  'musician', 'rapper', 'painter', 'poet', 'scientist', 'politician', 'businessman', 'businesswoman',
  'entrepreneur', 'journalist', 'professor', 'lawyer', 'physician', 'cricketer', 'boxer', 'wrestler',
]);

/**
 * EN4 part 8: the specific role a generic choice descriptor ("Athlete", "Artist") becomes, in the
 * order the first match wins. Sourced from the cluster's own title+snippet text.
 */
const SPECIFIC_ROLES: [RegExp, string][] = [
  [/\b(?:footballer|soccer player)\b/i, 'Footballer'],
  [/\bcricketer\b/i, 'Cricketer'],
  [/\bbasketball player\b/i, 'Basketball Player'],
  [/\bbaseball player\b/i, 'Baseball Player'],
  [/\bboxer\b/i, 'Boxer'],
  [/\bwrestler\b/i, 'Wrestler'],
  [/\bsprinter\b/i, 'Sprinter'],
  [/\bsinger\b|\bsung\b|\bsongs\b/i, 'Singer'],
  [/\brapper\b/i, 'Rapper'],
  [/\bguitarist\b/i, 'Guitarist'],
  [/\bdrummer\b/i, 'Drummer'],
  [/\bpainter\b/i, 'Painter'],
  [/\bsculptor\b/i, 'Sculptor'],
  [/\bactor\b/i, 'Actor'],
  [/\bactress\b/i, 'Actress'],
];

/** Every word of those roles, so a pick query built from one still cuts at the person name. */
const ROLE_TAIL = new Set(SPECIFIC_ROLES.flatMap(([, label]) => label.toLowerCase().split(' ')));

/** Lowercase words after a name that are about the person, not part of the name ("Messi now", "Ed playing"). */
const LOWER_STOP = /^(?:now|today|currently|really|actually|exactly|again|anyway|net|worth|age|wife|husband|married|dating|dead|alive|famous|known|.*ing|.*ed|.*ly)$/;
/** A lowercase second word that is a thing, not a surname ("Apple watch", "Open source", "New phone"). */
const NOT_SURNAME = /^(?:phone|phones|watch|watches|source|sources|database|databases|headphones|stock|price|prices|review|reviews|news|guide|app|apps|pro|max|mini|air|plus|case|cases|band|bands|book|books|paper|music|video|game|games|city|state|park|home|store|shop|sale|deal|deals)$/i;

/**
 * A workplace and a given name, with a company mark between them ("Acme AI Sam"),
 * is that given name. Two words ("Acme Sam") can still be the person's own name.
 */
function workplaceGivenName(query: string): string | undefined {
  const ask = readWorkplaceFirst(query);
  if (!ask?.confident) return undefined;
  const rest = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  const words = rest.split(/\s+/).map(cleanWord).filter(Boolean);
  if (words.length < 3) return undefined;
  return ask.given;
}

/** The person the query is about, or '' when there is none. */
export function personSubject(query: string): string {
  const given = workplaceGivenName(query);
  if (given) return given;
  const raw = query.trim();
  const hadWho = WHO_IS.test(raw) || ABOUT.test(raw);
  let s = raw.replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  if (!s) return '';
  const rawWords = s.split(/\s+/).filter((w) => cleanWord(w));
  const words = rawWords.map(cleanWord);
  if (!words.length) return '';
  const run: string[] = [];
  let commaEnd = false;
  for (const [i, w] of words.entries()) {
    // Skip leading Cap interrogatives / common words ("How is…").
    if (!run.length && (COMMON.has(w.toLowerCase()) || /^(how|what|when|where|why|which)$/i.test(w))) continue;
    if (/^[A-Z]/.test(w)) {
      // "Tim From Blueflame Ai": From is the workplace, not a surname, once a place follows it.
      if (run.length === 1 && /^(?:from|at|with)$/i.test(w) && i + 1 < words.length) break;
      // "Mara Chen Where does she teach": the question starts after the full name.
      if (run.length >= 2 && /^(?:how|what|when|where|why|which|who)$/i.test(w) && i + 1 < words.length && /^(?:does|did|do|is|are|was|were|can|could|should|would|has|have)$/i.test(words[i + 1]!)) break;
      run.push(w);
      if (run.length === 6) break;
      // "Ed Chu, Montefiore": a comma after a full name ends it; what follows is the detail.
      if (run.length >= 2 && rawWords[i]!.endsWith(',')) {
        commaEnd = true;
        break;
      }
    } else if (run.length && NAME_PARTICLE.test(w) && i + 1 < words.length && /^[A-Z]/.test(words[i + 1]!)) {
      // "Sergio de Larrea": the particle belongs to the name.
      run.push(w);
    } else break;
  }
  // "who is Ed chu" and a bare "Scott eberle": a sloppy-case surname after a capitalised first name
  // still belongs to the name. Two words only, so "Apple watch" and "Open source" stay topics.
  const bareSloppy = !hadWho && words.length === 2 && run.length === 1 && likelyGivenName(run[0]!) && !TOPIC_WORD.test(run[0]!);
  if ((hadWho || bareSloppy) && !commaEnd && run.length && run.length < 3 && words.length <= 4) {
    const start = words.indexOf(run[0]!);
    const from = start + run.length;
    for (const [k, w] of words.slice(from).entries()) {
      const lw = w.toLowerCase();
      if (run.length >= 3 || !/^[a-z][a-z'-]+$/.test(w) || COMMON.has(lw) || LOWER_STOP.test(lw) || NOT_SURNAME.test(lw)) break;
      if (ROLE1.has(lw) || DESCRIPTOR_WORDS.has(lw) || ROLE_TAIL.has(lw) || SPORTS_LEAGUE.test(lw) || ORG_TAIL.test(lw)) break;
      run.push(w[0]!.toUpperCase() + w.slice(1));
      if (rawWords[from + k]!.endsWith(',')) break;
    }
  }
  if (run.length) {
    // "Ray Lee BlueFlame AI" / "Ray Lee Raycon Founder" → person "Ray Lee";
    // keep "Barack Hussein Obama" (exactly 3 name tokens, no org/role tail).
    let cut = run.length;
    for (let i = 2; i < run.length; i++) {
      const w = run[i]!;
      const lowW = w.toLowerCase();
      // A role or descriptor word ends the name: "John Smith Explorer", "David Kim Violinist".
      // A two-letter word after a full name is an abbreviation ("Ed Chu Bf ai" = BlueFlame AI), not a surname.
      if (NAME_PARTICLE.test(w)) continue;
      if (looksLikeOrgToken(w) || ROLE1.has(lowW) || DESCRIPTOR_WORDS.has(lowW) || ROLE_TAIL.has(lowW) || /^co-founder$/i.test(w) || (ABBREV.test(w) && !NAME_SUFFIX.test(w))) {
        cut = i;
        break;
      }
    }
    // Choice-query shape "Name Name Org Role" (≥4 Cap tokens): never treat Org as a middle name.
    // A particle keeps the surname after it: "Sergio de Larrea Mavericks" stays three words.
    if (run.length >= 4 && cut > 2) {
      let keep = 2;
      if (NAME_PARTICLE.test(run[1] ?? '')) keep = NAME_PARTICLE.test(run[2] ?? '') ? 4 : 3;
      cut = Math.min(cut, keep);
    }
    const cap = run.some((w) => NAME_PARTICLE.test(w)) ? 4 : 3;
    return run.slice(0, Math.min(cut, cap)).join(' ');
  }
  // Lowercase person asks only after who/about: "who is barack obama" (not "open source database" or "zxqv").
  // "who is tim from blueflame": the name ends before from / at / with; the rest is the workplace.
  const placeAt = words.findIndex((w, i) => i >= 1 && /^(from|at|with)$/i.test(w) && i + 1 < words.length);
  const nameWords = placeAt > 0 ? words.slice(0, placeAt) : words;
  const barePlace = !hadWho && placeAt === 1 && likelyGivenName(nameWords[0] ?? '');
  if ((hadWho || barePlace) && nameWords.length <= 4 && nameWords.every((w) => /^[a-z0-9][a-z0-9.'-]*$/i.test(w) && !COMMON.has(w.toLowerCase()))) {
    return nameWords.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

/** Strong org/role context beyond the person name (BlueFlame, AI) — not sports acronyms or filler. */
export function contextTerms(query: string, name = personSubject(query)): string[] {
  if (!name) return [];
  const nameSet = new Set(tokens(name));
  const raw = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '');
  const words = raw.split(/\s+/).map(cleanWord).filter(Boolean);
  // "Ed Chu, bf ai": everything after the comma is the detail the asker typed, whatever its case.
  const typed = raw.trim().toLowerCase().startsWith(`${name.toLowerCase()},`);
  const out: string[] = [];
  for (const w of words) {
    const t = tokens(w)[0];
    if (!t || nameSet.has(t) || COMMON.has(t)) continue;
    if (typed && t.length >= 2 && !SPORTS_LEAGUE.test(w)) {
      if (!out.includes(t)) out.push(t);
      continue;
    }
    // CamelCase orgs (BlueFlame) or short org tails (AI, Inc) — not NBA/NFL alone.
    // Sports leagues (NBA) and season words (Preseason, Stats) are what was asked, not which
    // person. Requiring them dropped every page and the ask came back as "no results".
    if (SPORTS_LEAGUE.test(w) || TOPIC_WORD.test(w)) continue;
    // Cap tokens after the person name count as context (Raycon, USATF, Stripe) — not only CamelCase/ALLCAPS.
    // Alphanumeric org tokens carry a digit and a letter ("C2") — too short for capCtx, still identity.
    const capCtx = /^[A-Z]/.test(w) && (w.length >= 3 || (ABBREV.test(w) && !NAME_SUFFIX.test(w))) && !/^(Who|What|When|Where|Why|How)$/i.test(w);
    const alnumCtx = /^[A-Za-z0-9]{2,}$/.test(w) && /[0-9]/.test(w) && /[A-Za-z]/.test(w);
    if (looksLikeOrgToken(w) || ORG_TAIL.test(w) || capCtx || alnumCtx) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Multi-word person name must appear as an adjacent phrase in title/snippet
 * (not URL — "blu-ray" / "lee-a-ray" false positives). A single name token is never enough.
 */
/**
 * A capitalised run the results don't print as a name is a topic, not a person: "Lebron Preseason debut"
 * finds "LeBron James' preseason debut" pages, which carry both words but rarely side by side.
 * "Who is …" asks always stay person asks.
 */
export function nameIsTopic(query: string, rows: readonly EntityRow[]): boolean {
  const q = query.trim();
  if (WHO_IS.test(q) || ABOUT.test(q) || !rows.length) return false;
  const name = personSubject(q);
  // "Ed Chu, Bf ai": the comma says the words before it are a name.
  if (name && q.toLowerCase().startsWith(`${name.toLowerCase()},`)) return false;
  const nameToks = tokens(name).filter((t) => t.length >= 2);
  if (nameToks.length < 2) return false;
  let carry = 0;
  let named = 0;
  for (const row of rows) {
    const text = ` ${tokens(`${row.title ?? ''} ${row.snippet ?? ''}`).join(' ')} `;
    if (!nameToks.every((t) => text.includes(` ${t} `))) continue;
    carry += 1;
    if (hasFullPersonName(name, row)) named += 1;
  }
  return carry > 0 && named * 2 < carry;
}

/** Short and formal forms of a first name that name the same person ("ed" ↔ "edward"). */
const NICKNAMES = [
  ['ed', 'eddie', 'edward', 'edwin', 'edmund'], ['bob', 'bobby', 'rob', 'robbie', 'robert'], ['bill', 'billy', 'will', 'willie', 'william'],
  ['mike', 'mikey', 'michael'], ['jim', 'jimmy', 'james'], ['joe', 'joey', 'joseph'], ['tom', 'tommy', 'thomas'], ['dave', 'david'],
  ['dan', 'danny', 'daniel'], ['chris', 'christopher'], ['matt', 'matthew'], ['nick', 'nicholas'], ['tony', 'anthony'],
  ['steve', 'steven', 'stephen'], ['andy', 'drew', 'andrew'], ['ben', 'benjamin'], ['sam', 'samuel', 'samantha'],
  ['kate', 'katie', 'kathy', 'katherine', 'catherine'], ['liz', 'beth', 'betty', 'elizabeth'], ['jen', 'jenny', 'jennifer'],
  ['rick', 'ricky', 'rich', 'dick', 'richard'], ['greg', 'gregory'], ['jeff', 'jeffrey'], ['ken', 'kenny', 'kenneth'],
  ['larry', 'lawrence'], ['pat', 'patrick', 'patricia'], ['tim', 'timothy'], ['charlie', 'chuck', 'charles'],
  ['johnny', 'jack', 'john'], ['jon', 'jonathan'], ['alex', 'alexander', 'alexandra'], ['fred', 'freddie', 'frederick'],
  ['frank', 'francis'], ['gene', 'eugene'], ['hank', 'henry'], ['jerry', 'gerald'], ['phil', 'philip', 'phillip'],
  ['pete', 'peter'], ['ron', 'ronnie', 'ronald'], ['don', 'donnie', 'donald'], ['sue', 'susan', 'suzanne'], ['vic', 'victor'],
  ['jess', 'jessie', 'jessica'],
];
const NICK_OF = new Map(NICKNAMES.flatMap((forms) => forms.map((f) => [f, forms] as const)));
export const firstNameForms = (tok: string): readonly string[] => NICK_OF.get(tok) ?? [tok];

const FORMAL: Record<string, string> = {
  ed: 'Edward', eddie: 'Edward', bob: 'Robert', bobby: 'Robert', rob: 'Robert', bill: 'William', will: 'William', mike: 'Michael',
  jim: 'James', jimmy: 'James', joe: 'Joseph', tom: 'Thomas', dave: 'David', dan: 'Daniel', danny: 'Daniel', chris: 'Christopher',
  matt: 'Matthew', nick: 'Nicholas', tony: 'Anthony', steve: 'Steven', andy: 'Andrew', ben: 'Benjamin', sam: 'Samuel',
  kate: 'Katherine', liz: 'Elizabeth', jen: 'Jennifer', rick: 'Richard', greg: 'Gregory', jeff: 'Jeffrey', ken: 'Kenneth',
  larry: 'Lawrence', pat: 'Patrick', tim: 'Timothy', charlie: 'Charles', alex: 'Alexander', pete: 'Peter', ron: 'Ronald', don: 'Donald',
};

/**
 * "who is Ed Chu" also searches "Edward Chu": pages about a person mostly use the formal first name,
 * so the short form alone misses most of the namesakes the asker has to choose between.
 */
export function formalNameQueries(query: string): string[] {
  if (!isPersonAsk(query)) return [];
  const name = personSubject(query);
  const [first, ...rest] = name.split(/\s+/);
  const formal = first ? FORMAL[first.toLowerCase()] : undefined;
  return formal && rest.length ? [`${formal} ${rest.join(' ')}`] : [];
}

export function hasFullPersonName(name: string, row: EntityRow): boolean {
  const nameToks = tokens(name).filter((t) => t.length >= 2);
  if (nameToks.length < 2) return false;
  const segments = [row.title ?? '', row.snippet ?? ''].filter((s) => s.trim());
  if (!segments.length) return false;
  const escRe = /[.*+?^${}()|[\]\\]/g;
  const esc = nameToks.map((t) => t.replace(escRe, '\\$&')).join('\\s+');
  const re = new RegExp(`\\b${esc}\\b`, 'i');
  // "Ed Chu" is written "Edward Chu", "Edward “Ed” Chu" or "Edward L. Chu" just as often.
  const first = `(?:${firstNameForms(nameToks[0]!).map((t) => t.replace(escRe, '\\$&')).join('|')})`;
  const rest = nameToks.slice(1).map((t) => t.replace(escRe, '\\$&')).join('\\s+');
  const mid = new RegExp(`\\b${first}\\s+(?:(?:[A-Za-z]\\.?|["“'‘(][A-Za-z]+["”'’)])\\s+)?${rest}\\b`, 'i');
  // Match on title/snippet separately so "Ray Lee" + "Ray Lee, …" does not look like "Ray Lee Ray".
  if (!segments.some((s) => re.test(s) || mid.test(s))) return false;
  const AFTER_OK = new Set([
    'is', 'was', 'as', 'the', 'a', 'an', 'of', 'at', 'in', 'on', 'for', 'and', 'or', 'who', 'whose',
    'from', 'with', 'to', 'by', 'ceo', 'cto', 'cfo', 'coo', 'vp', 'co-founder', 'founder', 'director',
    'mayor', 'dr', 'mr', 'ms', 'mrs', 'jr', 'sr', 'ii', 'iii', 'phd', 'md', 'esq',
    // Institutional / title continuations — not a longer personal name ("… Presidential Center").
    'presidential', 'center', 'centre', 'foundation', 'library', 'institute', 'university', 'college',
    'hospital', 'school', 'museum', 'park', 'bridge', 'administration', 'biography', 'official',
    'former', 'family', 'memorial', 'museum', 'stadium', 'airport', 'boulevard', 'avenue', 'street',
  ]);
  const longer = new RegExp(`\\b${esc}\\s+([A-Za-z][A-Za-z'’\\-]{1,})`, 'gi');
  const prefix = new RegExp(`\\b([A-Za-z][A-Za-z'’\\-]*)\\s+${esc}\\b`, 'gi');
  for (const seg of segments) {
    for (const m of seg.matchAll(longer)) {
      if (!/^[A-Z]/.test(m[1] ?? '')) continue;
      const nxt = (m[1] ?? '').toLowerCase().replace(/[’']/g, '');
      if (!nxt || AFTER_OK.has(nxt) || TOPIC_WORD.test(nxt)) continue;
      // "Jayson Tatum STATS" / "Jayson Tatum BOS": a short all-caps label is a column or a team, not a longer name.
      if (/^[A-Z]{2,5}$/.test(m[1] ?? '')) continue;
      if (!ORG_TAIL.test(m[1]!) && !/^(Inc|LLC|Ltd|Corp|Co|AI|ML)$/i.test(m[1]!)) return false;
    }
    // Only a repeated first name ("Ray Ray Lee") is a longer-name prefix — not "Description Ray Lee".
    for (const m of seg.matchAll(prefix)) {
      if ((m[1] ?? '').toLowerCase() === nameToks[0]) return false;
    }
  }
  return true;
}

/** "define" and "defined" are the same word. A misspelling is not an inflection. */
export function isInflection(typed: string, spelled: string): boolean {
  const [shorter, longer] = typed.length <= spelled.length ? [typed, spelled] : [spelled, typed];
  if (!longer.startsWith(shorter) || longer.length === shorter.length) return false;
  return /^(?:s|es|ed|d|ing|er|est|ly)$/.test(longer.slice(shorter.length));
}

/** "near-term" and "nearterm" are the same spelling. A hyphen is not a typo. */
export function sameLetters(typed: string, spelled: string): boolean {
  const fold = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = fold(typed);
  const right = fold(spelled);
  return left.length >= 4 && left === right;
}

/** Closed-class words are already spelled. "where" is not a typo for "there". */
const FUNCTION_WORD = new Set([
  'about', 'above', 'after', 'again', 'against', 'along', 'among', 'another', 'around', 'because',
  'before', 'being', 'below', 'between', 'could', 'during', 'every', 'might', 'other', 'ought',
  'quite', 'rather', 'shall', 'should', 'since', 'their', 'there', 'these', 'those', 'through',
  'toward', 'under', 'until', 'where', 'which', 'while', 'within', 'without', 'would',
]);

/** One insertion, deletion, substitution, or adjacent transposition. Both sides are already long enough. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    const diff: number[] = [];
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) diff.push(i);
    if (diff.length === 1) return true;
    const i0 = diff[0]!;
    return diff.length === 2 && diff[1] === i0 + 1 && a[i0] === b[i0 + 1] && a[i0 + 1] === b[i0];
  }
  const [shorter, longer] = la < lb ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else {
      skipped++;
      j++;
      if (skipped > 1) return false;
    }
  }
  return skipped + (longer.length - j) <= 1;
}

/**
 * The spelling the pages actually use for a company the asker mistyped ("bleuflame" → "blueflame").
 * '' when nothing on these pages is one edit away.
 */
export function nearOrgSpelling(term: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): string {
  if (term.length < 5) return '';
  const counts = new Map<string, { display: string; n: number }>();
  for (const row of rows) {
    const seq = `${row.title ?? ''} ${row.snippet ?? ''} ${row.url ?? ''}`.split(/[^A-Za-z0-9]+/).filter((word) => word.length >= 1);
    for (let i = 0; i < seq.length; i++) {
      const w = seq[i]!;
      const cands = [w];
      const nxt = seq[i + 1];
      if (nxt && w.length >= 3 && nxt.length >= 3) cands.push(w + nxt);
      for (const cand of cands) {
        const key = cand.toLowerCase();
        if (key.length < 5 || key === term || !withinOneEdit(term, key)) continue;
        const prev = counts.get(key);
        counts.set(key, { display: prev && prev.n >= 1 ? prev.display : cand, n: (prev?.n ?? 0) + 1 });
      }
    }
  }
  let best = '';
  let n = 0;
  for (const { display, n: count } of counts.values()) if (count > n) { best = display; n = count; }
  return best;
}

/**
 * "Ricky Cheuk Bleuflame AI" plus pages that say Blueflame → "Ricky Cheuk Blueflame".
 * '' when these pages don't show a correctable spelling.
 */
/**
 * One adjacent vowel swap ("bleuflame" → "blueflame"). '' when the word has no such pair.
 * Only worth searching after the typed spelling found nothing.
 */
export function vowelSwap(term: string): string {
  const chars = [...term.toLowerCase()];
  for (let i = 0; i < chars.length - 1; i++) {
    const a = chars[i]!;
    const b = chars[i + 1]!;
    if (!/[aeiou]/.test(a) || !/[aeiou]/.test(b) || a === b) continue;
    chars[i] = b;
    chars[i + 1] = a;
    return chars.join('');
  }
  return '';
}

/**
 * A mistyped word the pages already spell ("Nvdia" → "Nvidia"). '' when nothing qualifies.
 * A corrected word that had been read as a third personal name is put after a comma, so
 * "Jensen Huang Nvdia" becomes "Jensen Huang, Nvidia" and the company stays a detail.
 */
/** Tokens of a versus side stay as typed. A one-letter change would name a different product. */
function comparisonTokens(query: string): Set<string> {
  const tokens = new Set<string>();
  for (const side of compareSides(query)) {
    for (const word of side.toLowerCase().split(/[^a-z0-9]+/)) {
      if (word.length >= 4) tokens.add(word);
    }
  }
  return tokens;
}

/**
 * The pages write this word as a name: capitalized mid-sentence in their text more often than not (or with a digit).
 * Titles are Title Case and a sentence's first word is capitalized anyway, so neither counts.
 */
function writtenAsName(word: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): boolean {
  if (/\d/.test(word)) return true;
  const key = word.toLowerCase();
  let upper = 0;
  let lower = 0;
  for (const row of rows) {
    for (const match of (row.snippet ?? '').matchAll(/[A-Za-z0-9]+/g)) {
      if (match[0].toLowerCase() !== key) continue;
      const before = (row.snippet ?? '').slice(0, match.index).trimEnd();
      if (!before || /[.!?:…]$/.test(before)) continue;
      if (/^[A-Z]/.test(match[0])) upper++;
      else lower++;
    }
  }
  if (upper || lower) return upper > lower;
  // Only titles use it: a title is Title Case, so only a name's own casing there counts ("NVIDIA", "iPhone").
  return rows.some((row) => (row.title ?? '').split(/[^A-Za-z0-9]+/).some((token) => token.toLowerCase() === key && token.length >= 3 && !/^[A-Z]?[a-z]+$/.test(token)));
}

export function spellingQuery(query: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): string {
  const words = query.trim().split(/\s+/);
  const kept = comparisonTokens(query);
  let changed = false;
  const next = words.map((word) => {
    const core = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (core.length < 5) return word;
    const low = core.toLowerCase();
    if (FUNCTION_WORD.has(low) || kept.has(low)) return word;
    const spell = nearOrgSpelling(low, rows);
    if (!spell || spell === low || isInflection(low, spell.toLowerCase()) || sameLetters(low, spell)) return word;
    // A mistyped name is corrected to the name the pages write ("Nvdia" → "NVIDIA"). An everyday word one letter
    // from "right" ("eight") is not a correction: the pages write it in lower case.
    if (!writtenAsName(spell, rows)) return word;
    // A snippet often repeats the typed query. The title and the address are the page's own spelling.
    const typed = rows.some((row) => tokens(`${row.title ?? ''} ${row.url ?? ''}`).includes(low));
    if (typed) return word;
    changed = true;
    const capped = /^[A-Z]/.test(core) ? `${spell[0]!.toUpperCase()}${spell.slice(1)}` : spell;
    return word.replace(core, capped);
  });
  if (!changed) return '';
  const fixed = next.join(' ');
  const parts = personSubject(query).split(' ').filter(Boolean);
  if (parts.length >= 3) {
    const last = parts[parts.length - 1]!.toLowerCase().replace(/[^a-z0-9]/g, '');
    const stillTyped = next.some((word) => word.toLowerCase().includes(last));
    if (last.length >= 5 && !stillTyped) {
      // The person keeps the spelling just corrected ("Satya Nadela" → "Satya Nadella").
      const person = fixed.split(/\s+/).slice(0, parts.length - 1).join(' ');
      const detail = fixed.split(/\s+/).slice(parts.length - 1).join(' ');
      return `${person}, ${detail}`.replace(/\s+/g, ' ').trim();
    }
  }
  return fixed;
}

export function correctedPersonQuery(query: string, rows: readonly { title?: string; snippet?: string; url?: string }[]): string {
  const name = personSubject(query);
  const term = distinguishingTerms(query, name).find((t) => t.length >= 6);
  if (!name || !term) return '';
  const spelling = nearOrgSpelling(term, rows);
  if (!spelling) return '';
  return `${name} ${spelling[0]!.toUpperCase()}${spelling.slice(1)}`;
}

/** "Bleuflame" is "Blueflame", including when the page writes it as two words. */
function mentionsOrg(term: string, seq: readonly string[]): boolean {
  if (term.length < 5) return false;
  for (let i = 0; i < seq.length; i++) {
    const w = seq[i]!;
    if (withinOneEdit(term, w)) return true;
    const nxt = seq[i + 1];
    if (nxt && w.length >= 3 && nxt.length >= 3 && withinOneEdit(term, w + nxt)) return true;
  }
  return false;
}

/** Opening of the fetched page. Enough for "Software Engineer at Blueflame AI", not the whole document. */
function pageOpening(row: EntityRow): string {
  return (row.content ?? '').slice(0, 800);
}

/**
 * LinkedIn often prints "Ricky C." and puts the surname only in the profile URL
 * (`/in/rickycheuk`). With a company on the page, that is still this person.
 */
function truncatedName(name: string, row: EntityRow): boolean {
  const parts = name.split(/\s+/).filter((w) => w.length >= 2);
  if (parts.length < 2) return false;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  const text = `${row.title ?? ''} ${row.snippet ?? ''} ${pageOpening(row)}`;
  const initial = new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+${last[0]}\\b`, 'i');
  if (initial.test(text)) return true;
  const slug = parts.join('').toLowerCase();
  return tokens(row.url ?? '').some((t) => t.replace(/-/g, '') === slug);
}

/** Source is about this person ask: full name + (>=1 context token when the query gives one). */
export function personSourceOk(query: string, row: EntityRow, name = personSubject(query)): boolean {
  const opening = pageOpening(row);
  // The full name is often only in the page text ("Ricky C." in the title, "Ricky Cheuk" in the body).
  const named = !!name && (hasFullPersonName(name, row) || truncatedName(name, row)
    || (!!opening && hasFullPersonName(name, { title: opening, url: row.url, snippet: '' }))
    || nameBeforeTerm(name, row, distinguishingTerms(query, name)));
  if (!named) return false;
  const ctx = contextTerms(query, name);
  if (!ctx.length) return true;
  // Only a distinguishing term counts: a picked "Ray Lee Raycon Founder" must name Raycon, not the role.
  const need = distinguishingTerms(query, name);
  if (!need.length) return true;
  const raw = `${row.title ?? ''} ${row.snippet ?? ''} ${opening}`;
  const seq = tokens(`${raw} ${row.url ?? ''}`);
  const body = new Set(seq);
  // A short detail's other words must sit right after the match ("bf ai" -> "Blueflame AI"), so an
  // author list's "Bernd Fischer" never reads as "bf".
  const tails = new Set(ctx.filter((t) => !need.includes(t)));
  const short = need.some((t) => t.length <= 4) ? initialisms(raw, tails) : new Set<string>();
  // "Blue Flame" is the same workplace as "Blueflame".
  const joined = new Set(seq.flatMap((w, i) => [w + (seq[i + 1] ?? ''), w + (seq[i + 1] ?? '') + (seq[i + 2] ?? '')]));
  const hit = (t: string) => body.has(t)
    || (t.length >= 5 && seq.some((w) => w.includes(t)))
    || (t.length >= 6 && joined.has(t))
    || (t.length <= 4 && short.has(t))
    || mentionsOrg(t, seq);
  // "one" is a pointer. It only counts inside the company it belongs to ("Capital One").
  const cores = need.filter((t) => !FILLER_TERM.has(t));
  const particles = need.filter((t) => FILLER_TERM.has(t));
  if (!cores.some(hit)) return false;
  if (!particles.length) return true;
  return particles.some((p) => cores.some((c) => new RegExp(`\\b${c}\\s+${p}\\b|\\b${p}\\s+${c}\\b`, 'i').test(raw)));
}

/**
 * "Tim Kemp Blue Flame" looks like a longer name, but the words after it spell the workplace the ask names
 * ("Blueflame"), so the row is that person at that place.
 */
function nameBeforeTerm(name: string, row: EntityRow, terms: readonly string[]): boolean {
  const parts = tokens(name).filter((t) => t.length >= 2);
  const long = terms.filter((t) => t.length >= 5);
  if (parts.length < 2 || !long.length) return false;
  const esc = parts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const re = new RegExp(`\\b${esc}\\s+((?:[A-Za-z][A-Za-z'’-]*\\s*){1,3})`, 'gi');
  for (const text of [row.title ?? '', row.snippet ?? '']) {
    for (const match of text.matchAll(re)) {
      const words = (match[1] ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      for (let n = 1; n <= words.length; n++) {
        const joined = words.slice(0, n).join('').replace(/['’-]/g, '');
        if (long.includes(joined)) return true;
      }
    }
  }
  return false;
}

/**
 * Initials a short detail may stand for. CamelCase always counts ("BlueFlame" -> "bf"); a run of
 * capitalised words ("Blue Flame") or one word read by its letters ("Blueflame") only counts when the
 * next word is one of `tails`, the detail's other words ("bf ai" needs "… AI" right after).
 */
export function initialisms(text: string, tails: ReadonlySet<string> = new Set()): Set<string> {
  const out = new Set<string>();
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const tailAt = (i: number) => tails.has((words[i] ?? '').toLowerCase());
  for (const [i, w] of words.entries()) {
    const caps = w.match(/[A-Z][a-z0-9]*/g);
    if (caps && caps.length >= 2 && caps.length <= 4) out.add(caps.map((c) => c[0]).join('').toLowerCase());
    if (/^[A-Z][a-z]{4,}$/.test(w) && tailAt(i + 1)) {
      const lw = w.toLowerCase();
      for (let k = 2; k < lw.length; k++) out.add(lw[0]! + lw[k]!);
    }
  }
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    for (let j = i; j < Math.min(i + 4, words.length) && /^[A-Z]/.test(words[j]!); j++) {
      acc += words[j]![0]!.toLowerCase();
      if (acc.length >= 2 && tailAt(j + 1)) out.add(acc);
    }
  }
  return out;
}

/** SPD3 (t457): "A vs B" / "compare A and B" names two things, so it is never one person to disambiguate. */
const COMPARE_ASK = /\b(?:vs\.?|versus|compare[sd]?|comparison)\b/i;

/** Words in a query, as personSubject splits them. */
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const MACHINE_ADDRESS = /\b(?:\d{1,3}\.){3}\d{1,3}\b|\b(?:[0-9a-f]{1,4}:){2,}/i;

/**
 * "Who is Tim from Blueflame": a given name plus where they are. Still a person.
 * "Who is Datasite, owner of BlueFlame AI": a company and an appositive, not a person.
 */
export function givenWithPlace(query: string): boolean {
  const q = query.trim();
  if (!WHO_IS.test(q) && !ABOUT.test(q)) return bareGivenWithPlace(q);
  const name = personSubject(q);
  if (!name || /\s/.test(name)) return false;
  if (looksLikeOrgToken(name) || ORG_TAIL.test(name) || ROLE1.has(name.toLowerCase())) return false;
  const rest = q.replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  const at = rest.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return false;
  const after = rest.slice(at + name.length).trim();
  if (!after || /^[,:]/.test(after) || /\b(?:owners?|company|startup|firm)\b/i.test(after)) return false;
  return /^(?:from|at|with)\s+\S/i.test(after);
}

/**
 * "Tim From Blueflame Ai" with no "who is": a given name, from/at/with, and a workplace.
 * "Tim Cook" has no preposition. "Photos from Paris" is not a given name plus an organisation.
 */
function bareGivenWithPlace(query: string): boolean {
  const words = query.replace(/\?+\s*$/, '').split(/\s+/).map(cleanWord).filter(Boolean);
  if (words.length < 3 || words.length > 6) return false;
  if (!/^(?:from|at|with)$/i.test(words[1] ?? '')) return false;
  const given = words[0] ?? '';
  if (!/^[\p{L}]/u.test(given) || !likelyGivenName(given)) return false;
  const place = words.slice(2);
  return place.some((w) => ORG_TAIL.test(w) || looksLikeOrgToken(w) || w.length >= 8);
}

/** The workplace words of a given-name ask ("Who is Tim from Blueflame" → ["blueflame"]), in any case. */
function placeWords(query: string, name: string): string[] {
  const rest = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  const at = rest.toLowerCase().indexOf(name.toLowerCase());
  const after = at < 0 ? '' : rest.slice(at + name.length).trim().replace(/^(?:from|at|with)\s+/i, '');
  return [...new Set(tokens(after).filter((t) => t.length >= 3 && !COMMON.has(t) && !GENERIC_PLACE_WORD.has(t)))];
}

const GENERIC_PLACE_WORD = new Set(['the', 'inc', 'llc', 'ltd', 'corp', 'company', 'group', 'labs', 'lab', 'team']);

/** The row names the workplace as a word or the head of a compound ("BlueFlame AI", "blueflame.ai"), not a shorter namesake word ("Blue"). */
function namesPlace(row: EntityRow, place: string[]): boolean {
  const words = tokens(`${row.title ?? ''} ${row.snippet ?? ''} ${(row.url ?? '').replace(/[./]/g, ' ')}`);
  return place.some((t) => words.includes(t) || (t.length >= 5 && words.some((w) => w.startsWith(t))));
}

const GIVEN_NAME = (word: string) => NICK_OF.has(word.toLowerCase());

/** A capitalised word that can be a person's given name, not a role or a company token. */
/** When an ask is about, not who: "NBA scores tonight" names no one called Tonight. */
const TIME_WORD = /^(?:today|tonight|tomorrow|yesterday|now|live|latest|weekend|week|month|year|morning|evening|night)$/i;

function likelyGivenName(word: string): boolean {
  const key = word.toLowerCase();
  if (TIME_WORD.test(key)) return false;
  if (ROLE1.has(key) || ROLE_TAIL.has(key) || DESCRIPTOR_WORDS.has(key) || looksLikeOrgToken(word) || ORG_TAIL.test(word) || COMMON.has(key)) return false;
  if (GIVEN_NAME(word)) return true;
  return /^[A-Za-z][a-z'’-]{1,}$/.test(word) && word.length >= 3;
}

/**
 * The words before the last one are a workplace, not another given name.
 * "Tim Cook" and "Michael Jordan" start with the given name, so they stay full names.
 */
function earlierIsWorkplace(placeRaw: string[], givenWord: string): boolean {
  if (placeRaw.some((w) => ROLE1.has(w.toLowerCase()) || ROLE_TAIL.has(w.toLowerCase()) || DESCRIPTOR_WORDS.has(w.toLowerCase()))) return false;
  if (GIVEN_NAME(placeRaw[0] ?? '')) return false;
  if (GIVEN_NAME(givenWord)) return true;
  return placeRaw.some((w) => looksLikeOrgToken(w) || w.length >= 6);
}

/**
 * The last word is a given name and the words before it are a workplace.
 * Does not call personSubject, so personSubject can call this.
 */
function readWorkplaceFirst(query: string): { given: string; place: string[]; placeText: string; confident: boolean } | undefined {
  const rest = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  const words = rest.split(/\s+/).map(cleanWord).filter((w) => w && !COMMON.has(w.toLowerCase()));
  if (words.length < 2 || words.length > 4) return undefined;
  if (words.some((w) => /^(?:from|at|with)$/i.test(w))) return undefined;
  const givenWord = words[words.length - 1]!;
  const placeRaw = words.slice(0, -1);
  if (!placeRaw.length || !likelyGivenName(givenWord) || !earlierIsWorkplace(placeRaw, givenWord)) return undefined;
  // Without "who is", a lowercase last word is a topic ("NBA standings", "Premier League table"), unless it is a known first name.
  if (!WHO_IS.test(query.trim()) && !ABOUT.test(query.trim()) && !GIVEN_NAME(givenWord) && !/^[A-Z]/.test(givenWord)) return undefined;
  const place = [...new Set(placeRaw.flatMap((w) => tokens(w)).filter((t) => t.length >= 3 && !COMMON.has(t) && !GENERIC_PLACE_WORD.has(t)))];
  if (!place.length) return undefined;
  const given = givenWord[0]!.toUpperCase() + givenWord.slice(1);
  // A short camel-case name ("LeBron James") is still a person. A workplace here is a long
  // token ("Northwind") or a company mark ("NorthWind", "NASA"), and the last word is the given name.
  const first = placeRaw[0] ?? '';
  const orgLike = placeRaw.some((w) => ORG_TAIL.test(w) || (/^[A-Z]{2,}$/.test(w) && !/^(JR|SR|II|III|IV)$/.test(w)) || (looksLikeOrgToken(w) && w.length >= 8));
  const confident = orgLike || (!GIVEN_NAME(first) && first.length >= 8 && GIVEN_NAME(givenWord));
  return { given, place, placeText: placeRaw.join(' '), confident };
}

/**
 * "Who is Northwind Tim" is the same ask as "Who is Tim from Northwind": a workplace and a
 * given name, with the workplace first. from/at/with already return undefined here.
 * A confident shape (a known given name, or a clear company mark) is the same ask with no
 * "who is", so the search can ask "Tim at Northwind" without waiting.
 * `confident` is true when that shape is clear before any search.
 */
export function workplaceFirst(query: string): { given: string; place: string[]; placeText: string; confident: boolean } | undefined {
  const q = query.trim();
  if (givenWithPlace(q)) return undefined;
  const ask = readWorkplaceFirst(q);
  if (!ask) return undefined;
  const prefixed = WHO_IS.test(q) || ABOUT.test(q);
  if (!prefixed && !ask.confident) return undefined;
  return ask;
}

/** A given name plus a workplace, in either order. "Tim Cook" is not one of these. */
export function nameWithWorkplace(query: string): boolean {
  return givenWithPlace(query) || !!workplaceFirst(query)?.confident;
}

/**
 * Searches that find the person when the ask puts the workplace first.
 * "Who is Blueflame Tim" also searches "Tim at Blueflame" (and the formal given name).
 */
export function workplaceQueries(query: string): string[] {
  const ask = workplaceFirst(query);
  if (ask?.confident) {
    const at = `${ask.given} at ${ask.placeText}`;
    const formal = FORMAL[ask.given.toLowerCase()];
    return formal && formal.toLowerCase() !== ask.given.toLowerCase() ? [at, `${formal} at ${ask.placeText}`] : [at];
  }
  // "Who is Tim from Blueflame" already searches well. "Tim From Blueflame Ai" does not:
  // the extra company word pulls the leadership page, so search the person at the workplace.
  if (WHO_IS.test(query.trim()) || ABOUT.test(query.trim()) || !givenWithPlace(query)) return [];
  const given = personSubject(query);
  if (!given || /\s/.test(given)) return [];
  const words = query.trim().replace(/\?+\s*$/, '').split(/\s+/).map(cleanWord).filter(Boolean);
  const at = words.findIndex((w) => /^(?:from|at|with)$/i.test(w));
  const placeRaw = words.slice(at + 1).filter((w) => !ORG_TAIL.test(w));
  const placeText = (placeRaw.length ? placeRaw : words.slice(at + 1)).join(' ');
  if (!placeText) return [];
  const line = `${given} at ${placeText}`;
  const formal = FORMAL[given.toLowerCase()];
  return formal && formal.toLowerCase() !== given.toLowerCase() ? [line, `${formal} at ${placeText}`] : [line];
}

/**
 * Rows to keep for "Tim From Blueflame Ai": the given name and the workplace, not the company roster.
 * Undefined when this is not that ask.
 */
export function givenPlaceKept<T extends EntityRow>(query: string, rows: readonly T[]): T[] | undefined {
  if (!givenWithPlace(query)) return undefined;
  const given = personSubject(query);
  if (!given || /\s/.test(given)) return undefined;
  const place = placeWords(query, given);
  if (!place.length) return undefined;
  const kept = rows.filter((row) => namesPlace(row, place) && mentionsGiven(row, given));
  // No page names that person. Keep the roster so the ask can offer who the sources do name.
  if (!kept.length) return undefined;
  return kept;
}

/** The title's subject is this exact name ("Blueflame Tim - Wikipedia"), not a later mention. */
function titleNames(name: string, title: string): boolean {
  const head = title.split(/\s+[|–—]\s+|\s+-\s+/)[0] ?? '';
  return hasFullPersonName(name, { title: head, url: '', snippet: '' });
}

/** Some page prints these words as one person's name, or Wikipedia has that article. */
function gluedNameIsPerson(name: string, rows: readonly EntityRow[]): boolean {
  if (tokens(name).length < 2) return false;
  return rows.some((row) => exactWikiArticle(row, name) || titleNames(name, row.title ?? ''));
}

function mentionsGiven(row: EntityRow, given: string): boolean {
  const words = new Set(tokens(`${row.title ?? ''} ${row.snippet ?? ''} ${row.content ?? ''} ${(row.url ?? '').replace(/[./]/g, ' ')}`));
  return firstNameForms(given.toLowerCase()).some((form) => words.has(form));
}

/**
 * Rows to keep for a workplace-first ask, once no page prints that word order as a person's name.
 * Undefined when this is not that ask, or when the words are already someone's name: the ordinary
 * full-name gate then keeps "Tim Cook" and "Michael Jordan".
 */
export function workplaceKept<T extends EntityRow>(query: string, rows: readonly T[]): T[] | undefined {
  const ask = workplaceFirst(query);
  if (!ask) return undefined;
  const name = personSubject(query);
  if (!name || gluedNameIsPerson(name, rows)) return undefined;
  const kept = rows.filter((row) => namesPlace(row, ask.place) && mentionsGiven(row, ask.given));
  if (!kept.length) return undefined;
  return kept;
}

export function isPersonAsk(query: string, pattern?: string): boolean {
  if (MACHINE_ADDRESS.test(query)) return false;
  if (COMPARE_ASK.test(query) && !WHO_IS.test(query.trim())) return false;
  const subject = personSubject(query);
  // "Who was Japan's Prime Minister after Hatoyama" names an office, not a person.
  // The person gate would require that office title as a full name and drop every page.
  if (officeSubject(subject)) return false;
  if (givenWithPlace(query)) return true;
  // "Northwind AI Sam" names a person and a company even with no "who is".
  // A company on its own ("Northwind AI") is not this shape.
  if (workplaceFirst(query)?.confident && !BUSINESS_TOPIC.test(query)) return true;
  if (pattern === 'profile') return subject !== '';
  if (WHO_IS.test(query.trim()) || ABOUT.test(query.trim())) {
    // "Who is Datasite, owner of BlueFlame AI": one name word plus more words is a company asked about
    // with context; the person gate needs a full name, so it would drop every source.
    // "Who is Tim from Blueflame" names a person and where they are, so it stays a person.
    const rest = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '');
    if (wordCount(subject) < 2 && wordCount(rest) > wordCount(subject) && !givenWithPlace(query)) return false;
    return subject !== '';
  }
  // "Xiaomi Miband 11" is a product, not a person named Xiaomi Miband. The person gate would
  // require that glued name and drop every "Mi Band 11" page.
  if (hasProductModel(query)) return false;
  // SPD-C1 (t457): a capitalised phrase inside a longer sentence is the topic, not a person lookup
  // ("Fact-check: Gmail lets you attach files up to 50 MB", "Does AirPods Pro 3 have a heart rate sensor?").
  // Treating it as a person dropped every source without that exact name (live H2H P11/P12/P13: 0–1 sources).
  if (subject && wordCount(query) - wordCount(subject) > 3) return false;
  // One capitalised word ("TypeSafe $870M funding round", "Gemini 4 Argon launch") is a company or
  // product far more often than a person; and money or launch words make it a business topic, so the
  // person gate would drop every news page about it (live tapped ask-about chip → "couldn't find more").
  if (wordCount(subject) < 2 || BUSINESS_TOPIC.test(query)) return false;
  // "Lakers score" and "Premier League table" ask for a thing about a team or league, not a person.
  if (TOPIC_TAIL.test(query.trim())) return false;
  return subject !== '' && nameLike(subject);
}

const TOPIC_TAIL = /\b(?:scores?|table|standings|schedule|fixtures|results|roster|lineups?|odds|rankings?|weather|forecast|price|prices|tickets|score today|score tonight)\s*\??$/i;

const BUSINESS_TOPIC = /[$€£]\s?\d|\b\d+(?:\.\d+)?\s?(?:[mbk]|million|billion)\b|\b(funding|raises?|raised|series [a-f]|seed round|valuation|ipo|acquisition|acquires?|acquired|merger|earnings|revenue|stock|shares|launch(?:es|ed)?|release[sd]?|model|startup|company|layoffs?)\b/i;

/** Single-word roles (lowercase) plus a few two-word ones. */
const ROLE2 = ['software engineer', 'software developer', 'concert pianist', 'general dentist', 'prime minister', 'chief executive', 'medical doctor'];

const OFFICE_FILLER = new Set(['the', 'of', 'a', 'an', 'and']);

const ROLE1 = new Set([
  'actor', 'actress', 'engineer', 'mayor', 'mayoral', 'dentist', 'pianist', 'president', 'presidential',
  'senator', 'doctor', 'physician', 'lawyer', 'attorney', 'professor', 'teacher', 'ceo', 'cto', 'cfo', 'coo',
  'founder', 'author', 'writer', 'singer', 'musician', 'player', 'athlete', 'coach', 'judge', 'officer',
  'nurse', 'designer', 'artist', 'director', 'manager', 'analyst', 'scientist', 'researcher', 'developer',
  'executive', 'consultant', 'comedian', 'governor', 'representative', 'secretary', 'chef', 'photographer',
  'architect', 'pharmacist', 'therapist', 'surgeon', 'pilot', 'astronaut', 'journalist', 'reporter', 'editor',
  'producer', 'entrepreneur', 'investor', 'banker', 'economist', 'historian', 'activist', 'politician',
  'diplomat', 'sheriff', 'clerk', 'violinist', 'guitarist', 'drummer', 'composer', 'dancer', 'poet',
  'novelist', 'scholar', 'restaurateur', 'businessman', 'businesswoman', 'dean', 'principal', 'quarterback', 'pitcher', 'chairman', 'spokesperson',
  'nurse', 'librarian', 'pastor', 'rabbi', 'monk', 'chief', 'king', 'queen', 'prince', 'princess',
]);

/**
 * The subject is an office ("Japan's Prime Minister", "Secretary"), not a person's name.
 * A title in front of a name ("President Barack Obama") stays a person: the extra words are not roles.
 * A multi-word role phrase is an office even with a place in front of it.
 */
function officeSubject(subject: string): boolean {
  const low = subject.toLowerCase().replace(/['’]s\b/g, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!low) return false;
  if (ROLE2.some((role) => new RegExp(`\\b${role}\\b`).test(low))) return true;
  const words = low.split(' ').filter((word) => word && !OFFICE_FILLER.has(word));
  return words.length > 0 && words.every((word) => ROLE1.has(word));
}

/** Maps a matched role token to its canonical display + core. */
function canonRole(matched: string): { display: string; core: string } {
  const low = matched.toLowerCase();
  const core = low === 'mayoral' ? 'mayor' : low === 'presidential' ? 'president' : low;
  const display = /^(ceo|cto|cfo|coo)$/i.test(core) ? core.toUpperCase()
    : core.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  return { display, core };
}

/** Generic org words that name no specific organisation ("C2 Education Centers" → "C2"). */
const GENERIC_ORG = /^(education|centers?|centre|group|global|international|services|solutions|company|holdings|partners|capital|media|studios?|foundation|institute|university|college|school|academy|club|team|labs?|technologies|technology|systems)$/i;

/** Pointer words ("the celtics one", "which one"). They never identify a person on their own. */
const FILLER_TERM = new Set(['one', 'two', 'guy', 'person', 'someone', 'somebody', 'here', 'there', 'just', 'only', 'same']);

const isRoleWord = (t: string) => ROLE1.has(t) || ROLE2.some((r) => r.split(' ').includes(t));

/**
 * "Capital One": a generic org word the asker put next to a name-particle is the company.
 * "C2 Education Centers" has a real core, so this pair is never reached.
 */
function brandPair(ctx: string[]): string[] {
  for (let i = 0; i < ctx.length - 1; i++) {
    const a = ctx[i]!;
    const b = ctx[i + 1]!;
    if ((GENERIC_ORG.test(a) && FILLER_TERM.has(b)) || (FILLER_TERM.has(a) && GENERIC_ORG.test(b))) return [a, b];
  }
  return [];
}

/**
 * Context words that actually tell one person from the next: role words, org tails
 * and generic org words drop out ("C2 Education Centers Founder" → ["c2"]), and a
 * role-only ask keeps its role ("David Kim Violinist" → ["violinist"]).
 * A lone "one" is a pointer, never the thing that picks the person.
 */
export function distinguishingTerms(query: string, name = personSubject(query)): string[] {
  const ctx = contextTerms(query, name);
  if (!ctx.length) return [];
  const specific = ctx.filter((t) => !isRoleWord(t) && !ORG_TAIL.test(t) && !GENERIC_ORG.test(t) && !FILLER_TERM.has(t));
  if (specific.length) return specific;
  const paired = brandPair(ctx);
  if (paired.length) return paired;
  const noTails = ctx.filter((t) => !isRoleWord(t) && !ORG_TAIL.test(t) && !FILLER_TERM.has(t));
  if (noTails.length) return noTails;
  return ctx.filter(isRoleWord);
}

/**
 * "Ricky Cheuk, Capital one" — the detail after the comma is who they meant.
 * Title-cased, with short org tails kept as initials ("ai" → "AI"). '' when there is no detail.
 */
export function commaDetailQuery(query: string): string {
  const name = personSubject(query);
  if (!name) return '';
  const raw = query.trim().replace(/\?+\s*$/, '');
  if (!raw.toLowerCase().startsWith(`${name.toLowerCase()},`)) return '';
  const detail = raw.slice(name.length).replace(/^[\s,]+/, '').replace(/[?.!\s]+$/, '').trim();
  if (!detail || FILLER_TERM.has(detail.toLowerCase())) return '';
  const words = detail.split(/\s+/).filter(Boolean).map((w) => {
    if (ORG_TAIL.test(w) && w.length <= 3) return w.toUpperCase();
    if (/^[a-z]/.test(w) && w.length > 1) return w[0]!.toUpperCase() + w.slice(1);
    return w;
  });
  return boundAsk(`${name} ${words.join(' ')}`);
}

const title = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
const low = (s: string) => s.toLowerCase();

const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normText = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Generic words that carry no disambiguating signal inside org/location phrases. */
const GENERIC = new Set(['the', 'of', 'and', 'for', 'at', 'in', 'a', 'an', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'group', 'official']);
const coreWords = (s: string) => normText(s).split(' ').filter((t) => t.length >= 2 && !GENERIC.has(t));

/** Site names that never belong inside a capture ("Wikipedia article", "Gaana"). */
const SITE_WORDS = new Set([
  'wikipedia', 'wiktionary', 'wikimedia', 'wikidata', 'wikiquote', 'wikisource',
  'imdb', 'linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'tiktok',
  'fandom', 'reddit', 'google', 'amazon', 'spotify', 'gaana', 'zoominfo',
  'crunchbase', 'quora', 'pinterest', 'bibliocommons', 'baidu', 'baike',
]);

/** Whole values that are only a filler word (pronoun, month, wiki chrome) say nothing. */
const JUNK_VALUE = new Set([
  'it', 'he', 'she', 'they', 'his', 'her', 'its', 'their', 'this', 'that', 'these', 'those', 'there', 'here',
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'of', 'for', 'with', 'by', 'from', 'to', 'as', 'also',
  'other', 'others', 'more', 'new', 'first', 'one', 'two', 'all', 'some', 'many',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'today', 'yesterday', 'page', 'article', 'list', 'see', 'category', 'help', 'edit',
]);

/**
 * A label/role that is only a birth/death year phrase ("born 1979", "d. 1968", "1970s")
 * is a date, never a descriptor: it says nothing about the person (live: "born 1979"
 * offered as a David Kim choice).
 */
const YEAR_PHRASE = /^(?:born|b\.|died|d\.)\s*(?:c\.\s*)?\d{3,4}$/i;
const BARE_YEAR = /^\d{3,4}s?$/;
const isYearOnly = (v: string) => {
  const s = v.trim();
  return YEAR_PHRASE.test(s) || BARE_YEAR.test(s);
};

/** Sentence enders that must not cut a capture: "J." initials, "U.S", "St", "Inc". */
const ABBREV_TAIL = /^(u\.s|st|jr|sr|dr|mr|mrs|ms|inc|co)$/i;

/**
 * A regnal/monarch name ("George II", "Charles IX") is a person, never an org or a place:
 * captured as an org it produced the choice label "Linked to George II" (live: ls-js).
 */
const REGNAL_NAME = /^[A-Z][a-z]+\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/;

/** True when any word of the value is a site name. */
const hasSiteWord = (v: string) => v.split(/[^A-Za-z0-9]+/).some((w) => SITE_WORDS.has(w.toLowerCase()));

/**
 * Normalise a captured org/location: cut run-on sentences ("China. He" → "China"),
 * drop trailing punctuation, site names and filler words. '' when nothing is left.
 */
export function cleanCapture(v: string): string {
  let s = title(v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Cut at the first sentence end, keeping "J." initials and "U.S"/"St"-style abbreviations.
  for (const m of s.matchAll(/[.!?]\s+(?=[A-Z])/g)) {
    const before = s.slice(0, m.index!);
    const tail = (before.split(/\s+/).pop() ?? '').replace(/[^A-Za-z.]/g, '').replace(/\.+$/, '');
    if (/^[A-Z]$/.test(tail) || ABBREV_TAIL.test(tail)) continue;
    s = before;
    break;
  }
  s = s.replace(/[\s.,;:!?…“”"'’)\]}–—-]+$/, '').trim();
  if (!s || isYearOnly(s) || REGNAL_NAME.test(s) || hasSiteWord(s)) return '';
  if (s.length < 2 || JUNK_VALUE.has(s.toLowerCase())) return '';
  return s;
}

const CAP_PHRASE = '([A-Z][\\w&.\'-]*(?:\\s+[A-Z][\\w&.\'-]*){0,2})';
const ORG_RES = [
  new RegExp(`\\bworks?\\s+(?:at|for)\\s+(?:the\\s+)?${CAP_PHRASE}`),
  new RegExp(`\\b(?:employed by|joined|hired by)\\s+(?:the\\s+)?${CAP_PHRASE}`),
  new RegExp(`\\b(?:CEO|CTO|CFO|COO|founder|co-founder|president|professor|engineer|developer|designer|manager|director|analyst|scientist|star|player|coach|reporter|partner)\\s+(?:at|of)\\s+(?:the\\s+)?${CAP_PHRASE}`, 'i'),
  new RegExp(`\\b(?:at|for|from|of)\\s+(?:the\\s+)?${CAP_PHRASE}`),
  new RegExp(`\\b${CAP_PHRASE}\\s+(?:engineer|actor|mayor|dentist|pianist|president|reporter|analyst|designer|developer|manager|director|coach|player|star|employee)\\b`),
];
const LOC_RES = [
  new RegExp(`\\bmayor\\s+of\\s+(?:the\\s+)?${CAP_PHRASE}`, 'i'),
  new RegExp(`\\b(?:based|living|born|raised)\\s+in\\s+(?:the\\s+)?${CAP_PHRASE}`, 'i'),
  new RegExp(`\\blives?\\s+in\\s+(?:the\\s+)?${CAP_PHRASE}`, 'i'),
  new RegExp(`\\b(?:dentist|doctor|practice|office|firm|hospital|clinic|school)\\s+in\\s+(?:the\\s+)?${CAP_PHRASE}`, 'i'),
  new RegExp(`\\bin\\s+(?:the\\s+)?${CAP_PHRASE.replace('{0,2}', '{0,1}')}`),
];

function hostOf(u: string): string {
  try {
    return norm(new URL(u).hostname).replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Aggregator/social/encyclopedia hosts: never an entity's official domain. */
const GENERIC_HOSTS = new Set([
  'linkedin.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'threads.net',
  'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'imdb.com',
  'reddit.com', 'pinterest.com', 'quora.com', 'medium.com', 'substack.com',
  // People-search / profile aggregators: a namesake's page, never the person's own site.
  'humantic.ai', 'me.sh', 'rocketreach.co', 'zoominfo.com', 'crunchbase.com', 'apollo.io', 'signalhire.com', 'contactout.com', 'peoplelooker.com', 'spokeo.com',
]);

function isGenericHost(host: string): boolean {
  if (!host || !host.includes('.')) return true;
  return [...GENERIC_HOSTS].some((g) => host === g || host.endsWith(`.${g}`));
}

export function officialDomains(urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const h = hostOf(u);
    if (!h || isGenericHost(h) || out.includes(h)) continue;
    out.push(h);
  }
  return out;
}

interface RowSignals {
  hasName: boolean;
  roles: string[];
  roleCores: string[];
  orgs: string[];
  orgCores: string[];
  locs: string[];
  paren?: string;
  /** Every disambiguating token (roles + org words + loc words + paren words). */
  sig: Set<string>;
  domainClass: string;
}

function domainClassOf(url: string): string {
  const h = hostOf(url);
  if (!h) return 'other';
  if (h.includes('linkedin')) return 'linkedin';
  if (h.includes('wikipedia')) return 'wikipedia';
  if (h.includes('imdb')) return 'imdb';
  if (h.endsWith('.edu')) return 'edu';
  return 'other';
}

function extractSignals(row: EntityRow, name: string): RowSignals {
  const text = `${row.title ?? ''} ${row.snippet ?? ''} ${row.url ?? ''}`;
  const toks = new Set(tokens(text));
  const nameToks = tokens(name).filter((t) => t.length >= 2);
  // Full adjacent name in title/snippet only — never a lone token or a URL fragment ("blu-ray").
  const hasName = hasFullPersonName(name, row);

  const roles: string[] = [];
  const roleCores: string[] = [];
  const addRole = (matched: string) => {
    const c = canonRole(matched);
    if (!roleCores.includes(c.core)) {
      roleCores.push(c.core);
      roles.push(c.display);
    }
  };
  const flat = ` ${normText(text)} `;
  for (const r of ROLE2) if (flat.includes(` ${r} `)) addRole(r);
  for (const t of toks) if (ROLE1.has(t)) addRole(t);

  // Wikipedia-style disambiguation: "Ray Lee (actor)".
  let paren: string | undefined;
  const pm = /\(\s*([^()]{1,40})\s*\)/.exec(row.title ?? '');
  if (pm) {
    const p = low(pm[1].trim());
    if (p && /[a-z]/.test(p)) {
      paren = p;
      for (const t of p.split(/[^a-z]+/).filter(Boolean)) if (ROLE1.has(t)) addRole(t);
      if (ROLE2.some((r) => p.includes(r))) addRole(ROLE2.find((r) => p.includes(r))!);
    }
  }

  // Phrases come from the title and snippet separately so a capture can never
  // span the two ("in Portland" + "John Smith" must not become "Portland John").
  const segments = [row.title ?? '', row.snippet ?? ''];
  const locs: string[] = [];
  for (const seg of segments) {
    for (const re of LOC_RES) {
      const m = re.exec(seg);
      if (m) {
        const v = cleanCapture(m[m.length - 1] ?? '');
        if (v && !locs.some((l) => low(l) === low(v))) locs.push(v);
      }
    }
  }
  const locSet = new Set(locs.map(low));
  const orgs: string[] = [];
  for (const seg of segments) {
    for (const re of ORG_RES) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      while ((m = g.exec(seg))) {
        const v = cleanCapture((m[m.length - 1] ?? '').replace(/^(the|a|an)\s+/i, ''));
        if (v && v.length >= 2 && !locSet.has(low(v)) && !orgs.some((o) => low(o) === low(v))) orgs.push(v);
        if (m[0].length === 0) break;
      }
    }
  }

  const orgCores = [...new Set(orgs.flatMap(coreWords))];
  const locCores = [...new Set(locs.flatMap(coreWords))];
  const parenWords = paren ? paren.split(/[^a-z]+/).filter((t) => t.length >= 2) : [];
  const sig = new Set([...roleCores.flatMap((r) => r.split(' ')), ...orgCores, ...locCores, ...parenWords]);
  return { hasName, roles, roleCores, orgs, orgCores, locs, paren, sig, domainClass: domainClassOf(row.url) };
}

const slugOf = (...parts: (string | undefined)[]) =>
  norm(parts.filter(Boolean).join(' '))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Longer name forms in kept rows ("Barack Hussein Obama" for "Barack Obama"). */
function findAliases(name: string, rows: EntityRow[]): string[] {
  const nt = tokens(name);
  if (nt.length < 2) return [];
  const first = nt[0];
  const last = nt[nt.length - 1];
  const baseLen = nt.length;
  const floor = Math.max(1, Math.min(2, baseLen));
  const out: string[] = [];
  const re = new RegExp(`\\b(${first}(?:\\s+[A-Z][\\w.'-]*){1,3}\\s+${last})\\b`, 'g');
  for (const row of rows) {
    const text = `${row.title ?? ''} ${row.snippet ?? ''}`;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const cand = title(m[1]);
      const ct = tokens(cand);
      if (ct.length > baseLen && ct.length >= floor && !out.some((o) => low(o) === low(cand)) && low(cand) !== low(name)) {
        out.push(cand);
      }
    }
  }
  return out;
}

/** Strong clusters + weak (name-only) indices. Weak are attached after the choices decision. */
function clusterRows(rows: EntityRow[], name: string): { strong: number[][]; weak: number[] } {
  const sigs = rows.map((r) => extractSignals(r, name));
  const named = sigs.map((s, i) => (s.hasName ? i : -1)).filter((i) => i >= 0);
  if (!named.length) return { strong: [], weak: [] };
  const parent = new Map<number, number>(named.map((i) => [i, i]));
  const find = (x: number): number => {
    const p = parent.get(x)!;
    if (p !== x) parent.set(x, find(p));
    return parent.get(x)!;
  };
  const union = (a: number, b: number) => parent.set(find(a), find(b));

  const strong = named.filter((i) => sigs[i]!.sig.size > 0);
  const share = (a: number, b: number) => {
    const sa = sigs[a]!.sig;
    const sb = sigs[b]!.sig;
    for (const t of sa) if (sb.has(t)) return true;
    return false;
  };
  const disjoint = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
  for (let x = 0; x < strong.length; x++) {
    for (let y = x + 1; y < strong.length; y++) {
      const a = strong[x]!;
      const b = strong[y]!;
      const A = sigs[a]!;
      const B = sigs[b]!;
      if (!share(a, b)) continue;
      // Conflicting roles, locations or wiki disambiguations block a merge; orgs are noisy (employer vs office) and never block.
      if (disjoint(A.roleCores, B.roleCores)) continue;
      if (disjoint(A.locs.map(low), B.locs.map(low))) continue;
      if (A.paren && B.paren && A.paren !== B.paren) continue;
      union(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of strong) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const clusters = [...groups.values()];
  // Weak (name-only) rows are returned as a trailing marker cluster via attachWeak later —
  // absorbing them here inflated the first cluster and blocked live choices (Ray Lee / David Kim).
  for (const c of clusters) c.sort((a, b) => a - b);
  clusters.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  return { strong: clusters, weak: named.filter((i) => sigs[i]!.sig.size === 0) };
}

function attachWeak(strong: number[][], weak: number[]): number[][] {
  const clusters = strong.map((c) => [...c]);
  if (!weak.length) return clusters;
  if (clusters.length) {
    clusters.sort((a, b) => b.length - a.length);
    clusters[0]!.push(...weak);
  } else {
    clusters.push([...weak]);
  }
  for (const c of clusters) c.sort((a, b) => a - b);
  clusters.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
  return clusters;
}

/**
 * The disambiguating words of an en.wikipedia "(qualifier)" row ("John Smith (explorer)"): its
 * qualifier plus the role/org/location cores the page carries, minus the name itself.
 */
function qualifierWords(rows: EntityRow[], index: number, name: string): Set<string> {
  const own = tokens(name);
  return new Set([...extractSignals(rows[index]!, name).sig].filter((t) => t.length >= 4 && !own.includes(t)));
}

/**
 * EN4 part 11 (live Serper "Who is John Smith"): one person split into two choices. An en.wikipedia
 * "(qualifier)" row names ONE person ("John Smith (explorer)"), while pages about that same man
 * (nps.gov, the Jamestown museums) had clustered on their own, so the ask offered "Explorer" next to
 * "President of Jamestown". Before the strong clusters are ranked, merge a cluster B into the
 * cluster A holding that Wikipedia qualifier row when at least half of B's rows carry one of the
 * qualifier's own words (case-insensitive, whole word, in title+snippet). Two clusters that each
 * carry their own qualifier row are two different people and never merge.
 */
function mergeQualifierClusters(strong: number[][], rows: EntityRow[], name: string): number[][] {
  const clusters = strong.map((c) => [...c]);
  const qualifiers = clusters.map((cluster) => {
    for (const i of cluster) {
      const row = rows[i]!;
      if (!wikiNamesake(row, name)) continue;
      const words = qualifierWords(rows, i, name);
      if (words.size) return words;
    }
    return undefined;
  });
  for (let a = 0; a < clusters.length; a++) {
    const words = qualifiers[a];
    if (!words) continue;
    for (let b = 0; b < clusters.length; b++) {
      const cluster = clusters[b]!;
      // Two clusters that each carry their own en.wikipedia qualifier row are two different people.
      if (b === a || !cluster.length || qualifiers[b]) continue;
      const carries = cluster.filter((i) => [...words].some((w) => hasWholeWord(`${rows[i]!.title ?? ''} ${rows[i]!.snippet ?? ''}`, w))).length;
      if (carries * 2 < cluster.length) continue;
      clusters[a] = [...clusters[a]!, ...cluster].sort((x, y) => x - y);
      clusters[b] = [];
    }
  }
  return clusters.filter((c) => c.length).sort((a, b) => b.length - a.length || a[0]! - b[0]!);
}

function topOf(cluster: number[], rows: EntityRow[], name: string): { role?: string; org?: string; location?: string } {
  const sigs = cluster.map((i) => extractSignals(rows[i]!, name));
  const count = (get: (s: RowSignals) => string[]) => {
    const freq = new Map<string, { v: string; n: number }>();
    for (const s of sigs) {
      for (const v of get(s)) {
        const k = low(v);
        const e = freq.get(k) ?? { v, n: 0 };
        e.n += 1;
        freq.set(k, e);
      }
    }
    return [...freq.values()].sort((a, b) => b.n - a.n || a.v.length - b.v.length)[0]?.v;
  };
  return { role: count((s) => s.roles), org: count((s) => s.orgs), location: count((s) => s.locs) };
}

function buildEntity(name: string, cluster: number[], rows: EntityRow[]): Entity {
  const { role, org, location } = topOf(cluster, rows, name);
  const keptRows = cluster.map((i) => rows[i]!);
  const terms = [...new Set(keptRows.flatMap((r) => [...extractSignals(r, name).sig]))];
  return {
    id: slugOf(name, role, org) || slugOf(name),
    name,
    role,
    org,
    location,
    terms,
    domains: officialDomains(keptRows.map((r) => r.url)),
    aliases: findAliases(name, keptRows),
  };
}

/** Short natural "Role at Org" / "CEO of Max"; never mashed; ≤ ~40 chars; tokens deduped. */
function cleanPhrase(s: string, max = 28): string {
  const words = title(s).split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const k = low(w.replace(/\./g, ''));
    if (seen.has(k)) continue;
    // Drop role words that leaked into an org capture ("USATF CEO Max" → keep org head).
    if (ROLE1.has(low(w)) || ROLE2.some((r) => low(w) === r.split(' ')[0])) continue;
    seen.add(k);
    out.push(w);
    if (out.join(' ').length >= max) break;
  }
  let joined = out.join(' ');
  // Never leave a clipped abbreviation ("U.S" / "U.").
  if (/\b[A-Z]\.$/.test(joined) || /\bU\.S$/.test(joined)) {
    const parts = joined.split(/\s+/);
    parts.pop();
    joined = parts.join(' ');
  }
  return joined.length > max ? `${joined.slice(0, max - 1).trim()}…` : joined;
}

function describe(top: { role?: string; org?: string; location?: string; label?: string }, rows: EntityRow[], name: string): string {
  // Wikipedia disambiguation gloss is usually the cleanest one-liner.
  const wikiLabel = (top.label ?? '').trim().replace(/\s+/g, ' ');
  let raw = '';
  // A birth/death year phrase is a date, not a descriptor — treat the label as empty.
  if (wikiLabel && wikiLabel.length >= 3 && wikiLabel.length <= 40 && !isYearOnly(wikiLabel)) {
    // Reject mashed labels ("Coach at USATF CEO Max").
    if (!/\b(CEO|Founder|Coach|Player|Director|Author)\b.*\b(CEO|Founder|Coach|Player|Director|Author)\b/i.test(wikiLabel)) {
      raw = title(wikiLabel).slice(0, 40);
    }
  }
  if (!raw) {
    const role = top.role ? title(top.role) : '';
    let org = top.org ? cleanPhrase(cleanCapture(top.org)) : '';
    let loc = top.location ? cleanPhrase(cleanCapture(top.location), 20) : '';
    // A bare city captured as org → location ("Actor in Los Angeles").
    if (org && !loc && /^(Los Angeles|New York|London|Chicago|Paris|Tokyo|Kuala Lumpur|San Francisco|Austin|Boston|Seattle|Portland|Philadelphia)$/i.test(org)) {
      loc = org;
      org = '';
    }
    // Drop trailing clause after ". " ("Sweeney Todd. Other Broadway" → "Sweeney Todd"), but keep "U.S. Bank".
    if (org && /\.\s+/.test(org) && !/^U\.S\.\b/i.test(org)) org = org.split(/\.\s+/)[0]!.trim();
    org = org.replace(/[.,;:]+$/g, '').trim();
    loc = loc.replace(/[.,;:]+$/g, '').trim();
    // Creative roles: prefer "Actor in Los Angeles" over "Actor at Show-Name".
    if (role && org && loc && /^(actor|actress|director|writer|author|producer|professor)$/i.test(role)) {
      raw = `${role} in ${loc}`;
    } else if (role && org) raw = /^(ceo|cto|cfo|coo|founder|president|chairman)$/i.test(role) ? `${role} of ${org}` : `${role} at ${org}`;
    else if (role && loc) raw = `${role} in ${loc}`;
    else if (role) raw = role;
    else if (org) {
      raw = `Linked to ${org}`;
      if (raw.length > 40) raw = org;
    } else if (loc) {
      raw = `Based in ${loc}`;
      if (raw.length > 40) raw = loc;
    }
    // No role/org/location/label: never fall back to a host or domain class.
    else raw = '';
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const w of parts) {
    const k = low(w);
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(w);
  }
  const out = kept.join(' ');
  const short = out.length > 40 ? `${out.slice(0, 39).trim()}…` : out;
  // A site name in the descriptor describes the source, not the person.
  return hasSiteWord(short) ? '' : short;
}

/** EN4 part 8: descriptor words that name no person at all, so they always get a second look. */
const GENERIC_LABELS = new Set(['athlete', 'artist', 'person', 'musician', 'sportsperson']);

/** The specific role these rows (title + snippet) name, in SPECIFIC_ROLES order. */
function specificRole(rows: EntityRow[]): string | undefined {
  const text = rows.map((r) => `${title(r.title ?? '')} ${r.snippet ?? ''}`).join(' \n ');
  if (!text.trim()) return undefined;
  return SPECIFIC_ROLES.find(([re]) => re.test(text))?.[1];
}

/**
 * EN4 part 8: a generic descriptor ("Athlete", "Artist", "Musician") says nothing about which
 * person this is. The cluster's own rows usually name the sport or the art, so use that instead
 * (role, descriptor and the re-ask query all move together). Nothing else is touched.
 */
function specificLabel(
  top: { role?: string; org?: string; location?: string; label?: string },
  rows: EntityRow[],
  name: string,
): { role?: string; descriptor: string } {
  const descriptor = describe(top, rows, name);
  if (!GENERIC_LABELS.has(low(descriptor))) return { role: top.role, descriptor };
  const specific = specificRole(rows);
  if (!specific) return { role: top.role, descriptor };
  return { role: specific, descriptor: describe({ ...top, role: specific }, rows, name) };
}

/**
 * Searchable follow-up: "Ray Lee USATF coach" — name + org/role words, no "at/of".
 * A bare org/location that would join the name falls back to a lowercase connector,
 * so both the name and the words that pick this person survive ("Ray Lee of Arsenal").
 */
function choiceQuery(name: string, top: { role?: string; org?: string; location?: string }): string {
  const role = top.role ? top.role.split(/\s+/).filter(Boolean) : [];
  const org = top.org ? cleanPhrase(top.org, 24).split(/\s+/).filter(Boolean) : [];
  const loc = top.location ? cleanPhrase(top.location, 16).split(/\s+/).filter(Boolean) : [];
  // SPD-C1 keeps a pick a person ask only with at most 3 words beyond the name, so the role
  // (1-2 words) is kept whole and the org's leading words fill the rest; the trailing org
  // words that do not fit are dropped. The location fills the same room when there is no role.
  const tail = role.length ? [...org.slice(0, Math.max(0, 3 - role.length)), ...role] : loc.slice(0, 3);
  const query = title([name, ...tail].join(' '));
  // A pick that re-asks the bare name just brings the choices back, so it only stands when
  // there is no org/location to ask about.
  if (tail.length && personSubject(query) === name) return boundAsk(query);
  // personSubject keeps a 3-token Cap phrase as a name, so a lone org/location word joins it
  // ("Ray Lee Arsenal" → the person "Ray Lee Arsenal") or is dropped for it. A lowercase
  // connector stops the capitalised run and still asks for the words that pick this person
  // ("Ray Lee of Arsenal", "John Smith in Northamptonshire"); it costs one of the 3 words
  // beyond the name, so the org/location keeps at most 2.
  const budget = 2;
  if (org.length) {
    const withOrg = title(`${name} of ${org.slice(0, budget).join(' ')}`);
    if (personSubject(withOrg) === name) return boundAsk(withOrg);
  }
  if (loc.length) {
    const withLoc = title(`${name} in ${loc.slice(0, budget).join(' ')}`);
    if (personSubject(withLoc) === name) return boundAsk(withLoc);
  }
  // Nothing asks for the org/location without breaking the name: never a name no source carries.
  return title(name);
}

/** "John Smith (explorer)" → "Explorer" — the en.wikipedia head-title qualifier, title-cased. */
function wikiQualifier(rows: EntityRow[], name: string): string | undefined {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}\\s*\\(([^()]{1,40})\\)$`);
  for (const r of rows) {
    if (!/^https?:\/\/([a-z0-9-]+\.)*en\.wikipedia\.org\//i.test(r.url ?? '')) continue;
    const m = re.exec(title(r.title ?? ''));
    if (!m) continue;
    const q = (m[1] ?? '').trim();
    if (!q || /^disambiguation$/i.test(q) || q.length > 30 || hasSiteWord(q)) continue;
    return q.replace(/[A-Za-z][A-Za-z.'-]*/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  }
  return undefined;
}

function toChoice(name: string, cluster: number[], rows: EntityRow[]): EntityChoice {
  const top = topOf(cluster, rows, name);
  const rowsIn = cluster.map((i) => rows[i]!);
  const label = wikiQualifier(rowsIn, name);
  // EN4 part 8: a generic "Athlete"/"Artist" becomes the role the cluster's rows name.
  const { role, descriptor } = specificLabel({ ...top, label }, rowsIn, name);
  // A Wikipedia qualifier IS the identity ("John Smith (explorer)"): re-ask name + qualifier,
  // never the cluster's org/role words ("John Smith New England Author").
  const query = label ? title(`${name} ${label}`) : choiceQuery(name, { ...top, role });
  return {
    name,
    descriptor,
    query,
    id: slugOf(name, role, top.org, top.location) || slugOf(name),
    // The rows behind this choice: a tap on it re-asks these, so it never comes back empty.
    seeds: [...cluster],
  };
}

/** Wikipedia disambiguation page: title/url "(disambiguation)" or snippet "may refer to". */
export function isDisambiguationPage(row: EntityRow): boolean {
  const titleText = row.title ?? '';
  const url = row.url ?? '';
  const snip = row.snippet ?? '';
  if (/\(disambiguation\)/i.test(titleText) || /\(disambiguation\)/i.test(url)) return true;
  if (/\bmay (?:also )?refer to\b/i.test(titleText) || /\bmay (?:also )?refer to\b/i.test(snip)) return true;
  return false;
}

/** "/wiki/Ray_Lee" → "Ray Lee" for en.wikipedia.org rows; '' for any other host. */
function wikiTitleOf(row: EntityRow): string {
  if (hostOf(row.url) !== 'en.wikipedia.org') return '';
  try {
    return decodeURIComponent(new URL(row.url).pathname)
      .replace(/^\/wiki\//, '')
      .replace(/_/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

/** The row is the en.wikipedia.org article for this exact name (never a disambiguation page). */
function exactWikiArticle(row: EntityRow, name: string): boolean {
  if (isDisambiguationPage(row)) return false;
  const t = wikiTitleOf(row);
  return !!t && low(t) === low(name.trim());
}

const EN_WIKI_ARTICLE = /^https:\/\/en\.wikipedia\.org\/wiki\//i;
const enWikiArticleRow = (row: EntityRow) => EN_WIKI_ARTICLE.test(row.url ?? '');

/** SERP title without the engine's " - Wikipedia" tail. */
function plainTitle(row: EntityRow): string {
  return title((row.title ?? '').replace(/\s+-\s+Wikipedia\s*$/i, ''));
}

/** The token appears as a whole word, not inside a longer word ("Obama" not "ObamaCare"). */
function hasWholeWord(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9])${esc}([^A-Za-z0-9]|$)`, 'i').test(text);
}

/**
 * EN4: the Wikipedia article a one-token ask means ("Who is Obama" → "Barack Obama").
 * A list/disambiguated/one-word title names no single person, so it never qualifies.
 */
/** Distinct encyclopedia people whose names contain this one-token name. One person is not a choice. */
function wellKnownPeople(rows: EntityRow[], token: string): { title: string; index: number }[] {
  const found: { title: string; index: number }[] = [];
  const keys: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!enWikiArticleRow(row) || isDisambiguationPage(row)) continue;
    const raw = plainTitle(row);
    if (!raw || /\b(?:list of|disambiguation)\b/i.test(raw)) continue;
    const titleText = raw.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!hasWholeWord(titleText, token)) continue;
    const words = titleText.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    const key = titleText.toLowerCase();
    const samePerson = keys.some((have) => {
      const left = have.split(' ');
      const right = key.split(' ');
      const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
      return shorter.every((word) => longer.includes(word));
    });
    if (samePerson) continue;
    keys.push(key);
    found.push({ title: titleText, index: i });
  }
  return found;
}

const RELATIVE = /\b(?:wife|husband|spouse|mother|father|son|daughter|brother|sister|family|first lady|parent)\b/i;

/**
 * Two well-known people share this token when one uses it as a given name and another as a surname,
 * or when two surnames have different given names and neither page is about the other's family.
 * "Obama" stays one person: the other articles are his family. "North" in "Ada North" and "North Vega" does not.
 */
function differentPeople(rows: EntityRow[], token: string): { title: string; index: number }[] {
  const people = wellKnownPeople(rows, token);
  if (people.length < 2) return people;
  const role = (title: string) => {
    const words = title.toLowerCase().split(/\s+/);
    const at = words.indexOf(token.toLowerCase());
    if (at <= 0) return 'given';
    if (at === words.length - 1) return 'family';
    return 'middle';
  };
  const roles = new Set(people.map((person) => role(person.title)));
  const independent = people.filter((person, index) => index === 0 || !RELATIVE.test(`${rows[person.index]?.title ?? ''} ${rows[person.index]?.snippet ?? ''}`));
  if (roles.size >= 2) return independent;
  const givenSurnames = new Set(independent.filter((person) => role(person.title) === 'given').map((person) => person.title.split(/\s+/).at(-1)?.toLowerCase()).filter((word): word is string => !!word));
  if (givenSurnames.size >= 2) return independent.filter((person) => role(person.title) === 'given');
  const givens = new Set(independent.filter((person) => role(person.title) === 'family').map((person) => person.title.split(/\s+/)[0]?.toLowerCase()));
  return givens.size >= 2 ? independent : people.slice(0, 1);
}

function wikiArticleForToken(rows: EntityRow[], token: string): { title: string; index: number } | undefined {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!enWikiArticleRow(row) || isDisambiguationPage(row)) continue;
    const t = plainTitle(row);
    if (!t || t.includes('(')) continue;
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 3) continue;
    if (!hasWholeWord(t, token)) continue;
    return { title: t, index: i };
  }
  return undefined;
}

/** Title form "<name> (<qualifier>)" — a different, disambiguated person. */
function qualifiedTitle(t: string, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${esc}\\s*\\([^()]{1,60}\\)$`, 'i').test(t);
}

/** A different person with the same name: the SERP title is "John Smith (explorer)". */
const qualifiedNamesake = (row: EntityRow, name: string) => qualifiedTitle(title(row.title ?? ''), name);

/**
 * A different person who puts a token between the same first and last name
 * ("Michael B. Jordan"). A parenthetical of the exact name, or a "Sr." after it, is not this.
 */
export function middleInitialPerson(text: string, name: string): boolean {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${esc(parts[0]!)}\\s+[A-Z]\\.\\s+${esc(parts[parts.length - 1]!)}`, 'i').test(text);
}

/**
 * People the disambiguation list names with a middle initial ("Michael B. Jordan (actor)",
 * "Michael B. Jordan (born 1987), American actor"). The famous person is the first choice.
 */
function middleNameChoices(name: string, list: EntityRow, rows: readonly EntityRow[]): EntityChoice[] {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return [];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${esc(parts[0]!)}\\s+([A-Z])\\.\\s+${esc(parts[parts.length - 1]!)}\\s*\\(([^)]{0,60})\\)`, 'gi');
  const text = list.snippet ?? '';
  const others: EntityChoice[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(re)) {
    const initial = match[1] ?? '';
    const inside = (match[2] ?? '').trim();
    const after = text.slice((match.index ?? 0) + match[0].length);
    const gloss = (after.match(/^\s*,\s*((?:(?!\s[A-Z][a-z]+\s).){3,70})/)?.[1] ?? '').trim();
    const full = `${parts[0]} ${initial}. ${parts[parts.length - 1]}`;
    const key = full.toLowerCase();
    if (!initial || seen.has(key)) continue;
    const year = /^(?:born\b|c\.?\s*)?\d{3,4}/i.test(inside);
    const descriptor = (year ? gloss : gloss || inside).replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!descriptor || /disambiguation|may refer/i.test(descriptor)) continue;
    seen.add(key);
    others.push({
      name: full,
      descriptor,
      query: full,
      id: slugOf(full, descriptor) || slugOf(full),
      seeds: rows.map((row, i) => (`${row.title ?? ''} ${row.snippet ?? ''}`.toLowerCase().includes(key) ? i : -1)).filter((i) => i >= 0),
    });
  }
  const exact = rows.findIndex((row) => exactWikiArticle(row, name));
  const famous = exact >= 0 ? toChoice(name, [exact], rows as EntityRow[]) : undefined;
  const lead = famous && famous.descriptor ? famous : exact >= 0 ? { ...toChoice(name, [exact], rows as EntityRow[]), descriptor: famous?.descriptor || 'Best known' } : undefined;
  const choices = [lead, ...others].filter((choice): choice is EntityChoice => !!choice && offerChoice(choice));
  const uniq = new Set<string>();
  return choices.filter((choice) => {
    const key = choice.query.toLowerCase();
    if (uniq.has(key)) return false;
    uniq.add(key);
    return true;
  }).slice(0, 3);
}

/** "Michael B. Jordan" is a different person from "Michael Jordan": a token sits inside the name. */
function insertedName(row: EntityRow, name: string): boolean {
  const parts = name.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  const words = `${row.title ?? ''} ${wikiTitleOf(row)}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const first = words.indexOf(parts[0]!);
  if (first < 0) return false;
  const last = words.indexOf(parts[parts.length - 1]!, first + 1);
  return last > first && last - first > parts.length - 1;
}

function namesakeCluster(cluster: readonly number[], rows: readonly EntityRow[], name: string): boolean {
  if (cluster.some((i) => exactWikiArticle(rows[i]!, name))) return false;
  const pages = cluster.map((i) => rows[i]!).filter((row) => !isDisambiguationPage(row) && ((row.title ?? '').trim() || wikiTitleOf(row)));
  return pages.length > 0 && pages.every((row) => insertedName(row, name));
}

/** "Michael Jordan Stats": the name plus a column label, not a second person. */
function topicLabelCluster(cluster: readonly number[], rows: readonly EntityRow[], name: string): boolean {
  if (cluster.length !== 1) return false;
  const row = rows[cluster[0]!]!;
  if (exactWikiArticle(row, name) || isDisambiguationPage(row)) return false;
  const own = new Set(tokens(name));
  const extra = tokens(plainTitle(row)).filter((word) => !own.has(word));
  return extra.length > 0 && extra.every((word) => TOPIC_WORD.test(word));
}

/** The Wikipedia article title itself is disambiguated ("John Smith (explorer)"). */
const wikiNamesake = (row: EntityRow, name: string) => qualifiedTitle(wikiTitleOf(row), name);

/** Any en.wikipedia.org page about the name: the article, a list/family page or a namesake. */
function wikiNamePage(row: EntityRow, name: string): boolean {
  if (isDisambiguationPage(row)) return false;
  if (hostOf(row.url) !== 'en.wikipedia.org') return false;
  return low(title(row.title ?? '')).includes(low(name.trim()));
}

/**
 * Cluster weight: the exact Wikipedia article for the name is the strongest signal (2),
 * any other en.wikipedia.org page about the name is next (1.5), everything else counts once.
 * A namesake article ("David Kim (pianist)") is a DIFFERENT person: it never boosts a cluster.
 */
function rowWeight(row: EntityRow, name: string): number {
  if (exactWikiArticle(row, name)) return 2;
  if (wikiNamePage(row, name) && !wikiNamesake(row, name)) return 1.5;
  return 1;
}

/**
 * Seed choice descriptors from a disambiguation page's snippet/title entries
 * ("Ray Lee (coach)", "Ray Lee, American CEO", …).
 */
export function disambiguationEntries(row: EntityRow, name: string): { role?: string; org?: string; location?: string; label: string }[] {
  const text = `${row.title ?? ''}. ${row.snippet ?? ''}`;
  const found: ({ role?: string; org?: string; location?: string; label: string } & { at: number })[] = [];
  const seen = new Set<string>();
  const push = (at: number, label: string, role?: string, org?: string, location?: string) => {
    const k = low(label);
    if (!k || seen.has(k) || k === low(name)) return;
    // Wiki chrome is a page, not a person ("may refer to", "List of", "look up in Wiktionary").
    if (/wiktionary|wikipedia|all pages|see also|may refer to|topics referred|surname|given name|disambiguation|look up|list of/i.test(label)) return;
    // A bare birth/death year ("born 1979") is not a person's descriptor.
    if (isYearOnly(label)) return;
    seen.add(k);
    found.push({ label: title(label).slice(0, 40), role, org, location, at });
  };
  // A two-token name may carry a middle initial in both forms ("David J. Kim").
  const namePat = (() => {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const toks = name.split(/\s+/).filter(Boolean).map(esc);
    return toks.length === 2 ? `${toks[0]}(?:\\s+[A-Z]\\.)?\\s+${toks[1]}` : toks.join('\\s+');
  })();
  // "Name (role)" / "Name (role, org)"
  const paren = new RegExp(`${namePat}\\s*\\(([^)]{2,40})\\)`, 'gi');
  for (const m of text.matchAll(paren)) {
    const inside = title(m[1] ?? '');
    if (/^disambiguation$/i.test(inside)) continue;
    const parts = inside.split(/,|\/|;/).map((s) => s.trim()).filter(Boolean);
    let role: string | undefined;
    let org: string | undefined;
    for (const p of parts) {
      const pl = low(p);
      if (!role && (ROLE1.has(pl) || ROLE2.some((r) => pl.includes(r)))) role = canonRole(pl).display;
      else if (!role && parts.length === 1 && /^[a-z][a-z-]{2,24}$/.test(pl) && /(ist|er|or|ian|ant|eur|man|woman)$/.test(pl)) {
        role = canonRole(pl).display;
      } else if (!org && !ROLE1.has(pl)) org = p;
    }
    if (org) org = cleanCapture(org) || undefined;
    // Prefer clean wiki gloss as label when we have role (or short inside).
    push(m.index!, role && !org ? role : inside, role, org);
  }
  // Run-on snippets list the next namesake: stop before the first name repeats.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const firstTok = name.split(/\s+/)[0] ?? '';
  const firstStop = firstTok ? new RegExp(`\\s${esc(firstTok[0]!.toUpperCase() + firstTok.slice(1))}\\s`) : null;
  // "Name, role at Org" / "Name – role"
  const dash = new RegExp(`${namePat}\\s*[,–—-]\\s*([^.;\\n]{3,50})`, 'gi');
  for (const m of text.matchAll(dash)) {
    let rest = title(m[1] ?? '');
    if (firstStop) {
      const stop = firstStop.exec(rest);
      if (stop && stop.index > 0) rest = title(rest.slice(0, stop.index));
    }
    if (/\bmay refer to\b/i.test(rest)) continue;
    const at = /\b(.+?)\s+(?:at|of|for)\s+(.+)$/i.exec(rest);
    if (at) {
      const rPart = title(at[1]!);
      const oPart = cleanCapture(title(at[2]!)) || undefined;
      // Drop leading nationality adjectives from role ("American Businessman" → Businessman).
      const rToks = rPart.split(/\s+/);
      const rCore = rToks.filter((w) => !/^(american|british|english|canadian|australian|french|german|chinese|japanese|korean|indian)$/i.test(w));
      const roleGuess = rCore.find((w) => ROLE1.has(low(w)));
      push(m.index!, roleGuess ? `${canonRole(roleGuess).display}${oPart ? ' of ' + cleanPhrase(oPart, 30) : ''}`.slice(0, 40) : rest.slice(0, 40),
        roleGuess ? canonRole(roleGuess).display : undefined, oPart);
    } else {
      const toks = rest.split(/\s+/);
      const roleTok = toks.find((w) => ROLE1.has(low(w)) || ROLE2.some((r) => low(w).includes(r.split(' ')[0]!)));
      push(m.index!, roleTok ? canonRole(roleTok).display : rest.slice(0, 40), roleTok ? canonRole(roleTok).display : undefined, undefined);
    }
  }
  // Source order: the snippet lists the most relevant namesake first, so a match further
  // down ("David J. Kim, CEO and founder of C2 Education Centers") stays among the first 3.
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, 6)
    .map((e) => ({ label: e.label, role: e.role, org: e.org, location: e.location }));
}

/** Full names in a row whose given name matches the asked name ("Tim" → "Tim Blue", "Timothy Lee"). */
function fullNamesMatching(row: EntityRow, first: string): string[] {
  const forms = firstNameForms(first.toLowerCase());
  const alt = forms.map((form) => {
    const body = form.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `${form[0]!.toUpperCase()}${body}|${form[0]!.toLowerCase()}${body}`;
  }).join('|');
  const re = new RegExp(`\\b(?:${alt})\\s+([A-Z][a-zA-Z'’-]{1,})\\b`, 'g');
  const text = `${row.title ?? ''} ${row.snippet ?? ''}`;
  const out: string[] = [];
  for (const match of text.matchAll(re)) {
    const surname = match[1]!;
    const lowSurname = surname.toLowerCase();
    if (COMMON.has(lowSurname) || ROLE1.has(lowSurname) || DESCRIPTOR_WORDS.has(lowSurname) || ROLE_TAIL.has(lowSurname)) continue;
    if (looksLikeOrgToken(surname) || ORG_TAIL.test(surname) || GENERIC_ORG.test(surname) || SPORTS_LEAGUE.test(surname)) continue;
    const given = match[0].split(/\s+/)[0]!;
    const full = `${given[0]!.toUpperCase()}${given.slice(1)} ${surname}`;
    if (!out.some((name) => name.toLowerCase() === full.toLowerCase())) out.push(full);
  }
  return out;
}

const NAME_PAIR = /\b([A-Z][a-zA-Z'’-]{2,})\s+([A-Z][a-zA-Z'’-]{2,})\b/g;

/** First Last names a page actually prints. A company mark or a role word is not a person. */
function peopleOnPage(row: EntityRow): string[] {
  const text = `${row.title ?? ''} ${row.snippet ?? ''}`;
  const out: string[] = [];
  for (const match of text.matchAll(NAME_PAIR)) {
    const given = match[1]!;
    const surname = match[2]!;
    const lowGiven = given.toLowerCase();
    const lowSurname = surname.toLowerCase();
    if (COMMON.has(lowGiven) || COMMON.has(lowSurname)) continue;
    if (ROLE1.has(lowGiven) || ROLE1.has(lowSurname) || DESCRIPTOR_WORDS.has(lowSurname) || ROLE_TAIL.has(lowSurname)) continue;
    if (looksLikeOrgToken(given) || looksLikeOrgToken(surname) || ORG_TAIL.test(given) || ORG_TAIL.test(surname)) continue;
    if (GENERIC_ORG.test(surname) || GENERIC_ORG.test(given) || SPORTS_LEAGUE.test(surname)) continue;
    const full = `${given} ${surname}`;
    if (!out.some((name) => name.toLowerCase() === full.toLowerCase())) out.push(full);
  }
  return out;
}

/**
 * Pages that name this person, including a page that also names someone else.
 * A page that never prints the name stays out.
 */
function widenKept(name: string, exclusive: number[], rows: EntityRow[], place: string[]): number[] {
  const kept = new Set(exclusive);
  for (let i = 0; i < rows.length; i++) {
    if (kept.has(i) || !hasFullPersonName(name, rows[i]!)) continue;
    if (place.length && !namesPlace(rows[i]!, place) && !titleNames(name, rows[i]!.title ?? '')) continue;
    kept.add(i);
  }
  return [...kept].sort((a, b) => a - b);
}

function singleNamed(name: string, exclusive: number[], rows: EntityRow[], place: string[]): EntityDecision {
  const keptRows = widenKept(name, exclusive, rows, place);
  const kept = new Set(keptRows);
  return {
    kind: 'single',
    entity: buildEntity(name, exclusive, rows),
    kept: keptRows,
    dropped: rows.map((_, i) => i).filter((i) => !kept.has(i)),
  };
}

function choiceKey(choice: EntityChoice): string {
  return `${choice.name} ${choice.descriptor}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function dedupeChoices(choices: EntityChoice[]): EntityChoice[] {
  const seen = new Set<string>();
  const out: EntityChoice[] = [];
  for (const choice of choices) {
    const key = choiceKey(choice);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
  }
  return out;
}

const PLACE_ONLY = /^(?:based in|located in|lives in|from|in|at)\b/i;
/** Words of a descriptor that say what someone does, not where: left over, a descriptor names the workplace. */
const ROLE_WORD = new Set(['founder', 'co', 'cofounder', 'ceo', 'cto', 'coo', 'cfo', 'chief', 'officer', 'engineer', 'developer', 'author', 'writer', 'creator', 'maintainer', 'director', 'manager', 'head', 'lead', 'senior', 'staff', 'principal', 'partner', 'president', 'vice', 'chair', 'professor', 'researcher', 'scientist', 'analyst', 'consultant', 'advisor', 'investor', 'the', 'and', 'for', 'web', 'inc', 'llc', 'ltd', 'company', 'former', 'ex']);

const SHARED_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'his', 'her', 'has', 'have', 'was', 'are', 'who', 'after', 'about', 'their', 'news', 'stats', 'latest', 'more', 'info', 'page', 'profile', 'wikipedia', 'born', 'also', 'into', 'over', 'when', 'what', 'year', 'years', 'time', 'first', 'former', 'named', 'team', 'member']);
const shareWords = (text: string, name: string) => {
  const own = new Set(low(name).split(/\s+/));
  return new Set(low(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !own.has(word) && !SHARED_STOP.has(word) && !/^\d+$/.test(word)));
};

/**
 * "Joel Embiid" alone, with Wikipedia's article for that exact name among the sources and no namesake or
 * disambiguation page: the choices are one notable person seen through different pages ("Player in Friday's",
 * "Linked to All-NBA Team"), as long as every other choice's pages share at least two of the article's own
 * words ("center", "NBA"). A namesake who shares none of them still gets the picker.
 */
function oneNotablePerson(choices: EntityChoice[], rows: EntityRow[]): boolean {
  const name = choices[0]!.name;
  if (rows.some((row) => isDisambiguationPage(row) || wikiNamesake(row, name))) return false;
  const holder = choices.find((choice) => (choice.seeds ?? []).some((i) => rows[i] && exactWikiArticle(rows[i]!, name)));
  if (!holder) return false;
  const article = (holder.seeds ?? []).map((i) => rows[i]).find((row) => row && exactWikiArticle(row, name))!;
  const known = shareWords(`${article.title ?? ''} ${article.snippet ?? ''}`, name);
  const wordsOf = (choice: EntityChoice) => new Set((choice.seeds ?? []).flatMap((i) => [...shareWords(`${rows[i]?.title ?? ''} ${rows[i]?.snippet ?? ''}`, name)]));
  // A choice joins once its pages share two words with the article or with pages already joined to it
  // (Basketball Reference's "stats" and "points" reach the article through ESPN and NBA.com).
  let left = choices.filter((choice) => choice !== holder);
  for (let joined = true; joined && left.length;) {
    joined = false;
    for (const choice of left) {
      const seen = wordsOf(choice);
      if ([...seen].filter((word) => known.has(word)).length < 2) continue;
      for (const word of seen) known.add(word);
      left = left.filter((other) => other !== choice);
      joined = true;
    }
  }
  return !left.length;
}

/**
 * Two choices with the same full name are one person, including a role plus a place.
 * Different full names, or two careers under one shared name, stay a picker.
 */
function onePerson(choices: EntityChoice[], rows: EntityRow[]): boolean {
  if (choices.length < 2) return true;
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const name = key(choices[0]!.name);
  if (!name || choices.some((choice) => key(choice.name) !== name)) return false;
  if (name.split(' ').length >= 2) {
    const careers = choices.map((choice) => key(choice.descriptor)).filter((descriptor) => descriptor && !PLACE_ONLY.test(descriptor));
    if (new Set(careers).size <= 1) return true;
    // "Founder of Django Web" and "Engineer at Django" name one workplace: two roles there are one person's career.
    const workplaces = careers.map((career) => new Set(career.split(' ').filter((word) => word.length >= 3 && !ROLE_WORD.has(word))));
    if (workplaces.every((words) => words.size) && workplaces.every((words, i) => i === 0 || [...words].some((word) => workplaces[0]!.has(word)))) return true;
    if (oneNotablePerson(choices, rows)) return true;
  }
  return new Set(choices.map((choice) => key(choice.descriptor))).size < 2;
}

/** A picker only when the choices name different people. One person is one card. */
function personDecision(choices: EntityChoice[], rows: EntityRow[]): EntityDecision {
  const people = dedupeChoices(choices);
  if (people.length >= 2 && !onePerson(people, rows)) return { kind: 'choices', choices: people };
  const name = people[0]?.name || '';
  const fromSeeds = [...new Set(people.flatMap((choice) => choice.seeds ?? []))].filter((i) => i >= 0 && i < rows.length);
  const named = fromSeeds.length ? fromSeeds : rows.map((_, i) => i).filter((i) => name && hasFullPersonName(name, rows[i]!));
  const cluster = named.length ? named : rows.map((_, i) => i);
  const kept = new Set(cluster);
  return {
    kind: 'single',
    entity: buildEntity(name, cluster, rows),
    kept: cluster,
    dropped: rows.map((_, i) => i).filter((i) => !kept.has(i)),
  };
}

/** The model, or a second pass, offered these choices. True when they are one person. */
export function samePersonChoices(choices: EntityChoice[], rows: EntityRow[]): boolean {
  return onePerson(dedupeChoices(choices), rows);
}

/**
 * People the sources name at this workplace when the asked given name is not among them.
 * Two or more is a picker. Fewer is not a card about someone else.
 */
function rosterDecision(rows: EntityRow[], place: string[], placeText: string): EntityDecision | undefined {
  const buckets = new Map<string, { name: string; rows: number[] }>();
  for (let i = 0; i < rows.length; i++) {
    if (place.length && !namesPlace(rows[i]!, place)) continue;
    for (const person of peopleOnPage(rows[i]!)) {
      const key = person.toLowerCase();
      const found = buckets.get(key) ?? { name: person, rows: [] };
      if (!found.rows.includes(i)) found.rows.push(i);
      buckets.set(key, found);
    }
  }
  const groups = [...buckets.values()].sort((a, b) => b.rows.length - a.rows.length || a.rows[0]! - b.rows[0]!);
  const choices = groups.slice(0, 4).map((group) => {
    const choice = toChoice(group.name, group.rows, rows);
    return choice.descriptor ? choice : { ...choice, descriptor: placeText };
  }).filter(offerChoice).slice(0, 3);
  if (choices.length >= 2) return personDecision(choices, rows);
  return undefined;
}

/**
 * A given name plus a workplace still names people. Rows that carry different full names
 * are different people: ask which one, and never keep both on one card.
 * One full name is that person only. A page that also names someone else still counts
 * when it names this person. Rows that never name them stay off the card.
 */
function peopleNamedLike(first: string, rows: EntityRow[], place: string[]): EntityDecision | undefined {
  const buckets = new Map<string, { name: string; rows: number[] }>();
  for (let i = 0; i < rows.length; i++) {
    const names = fullNamesMatching(rows[i]!, first);
    const keys = [...new Set(names.map((name) => name.toLowerCase()))];
    if (keys.length !== 1) continue;
    const key = keys[0]!;
    const found = buckets.get(key) ?? { name: names[0]!, rows: [] };
    found.rows.push(i);
    buckets.set(key, found);
  }
  const all = [...buckets.values()].sort((a, b) => b.rows.length - a.rows.length || a.rows[0]! - b.rows[0]!);
  // The workplace in the ask picks the people: namesakes whose pages never name it are not offered.
  const placed = place.length ? all.filter((group) => group.rows.some((i) => namesPlace(rows[i]!, place))) : [];
  const groups = placed.length ? placed : all;
  if (!groups.length) return undefined;
  if (groups.length >= 2) {
    const choices = groups.map((group) => toChoice(group.name, group.rows, rows)).filter(offerChoice).slice(0, 3);
    if (choices.length >= 2) return personDecision(choices, rows);
    if (choices.length === 1) {
      const only = groups.find((group) => group.name === choices[0]!.name) ?? groups[0]!;
      return singleNamed(only.name, only.rows, rows, place);
    }
  }
  const only = groups[0]!;
  return singleNamed(only.name, only.rows, rows, place);
}

export function resolveEntity(
  query: string,
  rows: EntityRow[],
  opts?: { pattern?: string; prior?: Entity },
): EntityDecision {
  if (!isPersonAsk(query, opts?.pattern) || nameIsTopic(query, rows)) return { kind: 'skip' };
  const name = personSubject(query);
  if (!name || !rows.length) return { kind: 'skip' };
  // A first name and a workplace ("who is Tim from Blueflame") is not one person yet.
  // Two full names in the sources are a choice; one full name keeps only that person's rows.
  if (!opts?.prior && !/\s/.test(name) && givenWithPlace(query)) {
    const place = placeWords(query, name);
    const named = peopleNamedLike(name, rows, place);
    if (named) return named;
    // The sources name other people, or do not name this one: ask which person.
    // Falling through would design a company card and retitle the question.
    const roster = rosterDecision(rows, place, place.join(' '));
    if (roster) return roster;
    return { kind: 'skip' };
  }
  // "Who is Northwind Tim" is that same ask with the workplace first. A page that prints
  // those words as a person's name stays on the full-name path below.
  const swapped = !opts?.prior ? workplaceFirst(query) : undefined;
  if (swapped && !gluedNameIsPerson(name, rows)) {
    const named = peopleNamedLike(swapped.given, rows, swapped.place);
    if (named) return named;
    const roster = rosterDecision(rows, swapped.place, swapped.placeText);
    if (roster) return roster;
    return { kind: 'skip' };
  }
  // A one-token famous ask ("Who is Obama"): one Wikipedia article for the token, plus other
  // Wikipedia pages about it, is one dominant identity — resolve that person instead of skipping.
  // The article title has 2+ words, so the follow-up ask can never come back here.
  // Two well-known people whose names contain the token ("Ada North" and "North Vega") still ask which one.
  if (!/\s/.test(name) && !opts?.prior) {
    const people = differentPeople(rows, name);
    if (people.length >= 2) {
      const choices = people.slice(0, 3).map((person) => {
        const choice = toChoice(person.title, [person.index], rows);
        const snippet = (rows[person.index]?.snippet ?? '').split('\n')[0]?.replace(/\s+/g, ' ').trim() ?? '';
        const descriptor = choice.descriptor || snippet.slice(0, 90);
        return { ...choice, name: person.title, descriptor, query: `Who is ${person.title}` };
      }).filter(offerChoice);
      if (choices.length >= 2) return personDecision(choices, rows);
    }
    const hit = wikiArticleForToken(rows, name);
    if (hit) {
      const support = rows.filter((r, i) => i !== hit.index && enWikiArticleRow(r) && hasWholeWord(plainTitle(r), name)).length;
      if (support >= 2 && /\s/.test(personSubject(`Who is ${hit.title}`))) {
        return resolveEntity(`Who is ${hit.title}`, rows, opts);
      }
    }
  }
  // A pick ("David Kim C2 Education Centers CEO") or a descriptor ask already names the person:
  // a disambiguation page lists OTHER people, so it is never eligible and never seeds choices.
  const pickAsk = contextTerms(query, name).length > 0 || !!opts?.prior;
  // Drop adult/spam + non-full-name / missing-context hits before clustering.
  const eligible = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => {
      if (isBlockedHost(row.url)) return false;
      // Game wikis / fandom never seed person choices (live: "Player at San Andreas State").
      if (!opts?.prior && isFictionHost(row.url)) return false;
      // Picks/descriptor asks: the "may refer to" page is about namesakes, never the picked person.
      if (pickAsk && isDisambiguationPage(row)) return false;
      // Picked-choice follow-up: prior already chose the person — keep full-name hits even when
      // the new query's org/role context is missing from a page (else → no_sources).
      if (opts?.prior) return hasFullPersonName(opts.prior.name, row) || hasFullPersonName(name, row);
      return personSourceOk(query, row, name);
    });
  if (!eligible.length) return { kind: 'skip' };
  const filtered = eligible.map((e) => e.row);
  const indexMap = eligible.map((e) => e.i);
  const { strong: strongRaw, weak: weakRaw } = clusterRows(filtered, name);
  const strong = strongRaw.map((c) => c.map((j) => indexMap[j]!));
  const weak = weakRaw.map((j) => indexMap[j]!);
  // Wikipedia disambiguation pages are a strong ambiguity signal even with few cluster peers.
  const disambig = eligible.filter((e) => isDisambiguationPage(e.row)).map((e) => e.i);
  if (!strong.length && !weak.length && !disambig.length) return { kind: 'skip' };

  // A pick ("David Kim C2 Education Centers CEO") already named the person, and eligibility wanted
  // the full name plus the distinguishing org/role word, so every eligible row is about that one
  // person. One card, never choices, and never split across clusters that word it differently
  // (live: the C2 rows were cut down to the Wikipedia page + one news page).
  if (pickAsk && !opts?.prior) {
    const kept = eligible.map((e) => e.i);
    const keptSet = new Set(kept);
    return {
      kind: 'single',
      entity: buildEntity(name, kept, rows),
      kept,
      dropped: rows.map((_, i) => i).filter((i) => !keptSet.has(i)),
    };
  }

  // A thread entity locks the choice: prefer clusters that match it, never ask again.
  if (opts?.prior) {
    const withWeak = attachWeak(strong.length ? strong : (weak.length ? [weak] : []), strong.length ? weak : []);
    const locked = withWeak.filter((c) => c.some((i) => matchesEntity(opts.prior!, rows[i]!)));
    if (locked.length) {
      locked.sort((a, b) => b.length - a.length || a[0]! - b[0]!);
      const win = locked[0]!;
      const kept = new Set(win);
      return {
        kind: 'single',
        entity: buildEntity(opts.prior.name, win, rows),
        kept: [...win],
        dropped: rows.map((_, i) => i).filter((i) => !kept.has(i)),
      };
    }
    // Prior set but no cluster matched: keep name-matched rows (don't no_sources).
    const nameHits = rows.map((r, i) => (hasFullPersonName(opts.prior!.name, r) ? i : -1)).filter((i) => i >= 0);
    if (nameHits.length) {
      const kept = new Set(nameHits);
      return {
        kind: 'single',
        entity: { ...opts.prior, domains: opts.prior.domains ?? officialDomains(nameHits.map((i) => rows[i]!.url)) },
        kept: nameHits,
        dropped: rows.map((_, i) => i).filter((i) => !kept.has(i)),
      };
    }
  }

  // A disambiguation page that names someone with a middle initial ("Michael B. Jordan")
  // is a second person. A bare parenthetical of the exact name is not.
  // The list page itself often fails the biography name check, because the list also
  // contains a longer name ("Michael Jordan Bonema"), so it is read from every row.
  const listed = rows.find((row) => isDisambiguationPage(row));
  const listedText = `${listed?.title ?? ''} ${listed?.snippet ?? ''}`;
  const anotherPerson = !!listed && middleInitialPerson(listedText, name);
  if (!pickAsk && !opts?.prior && listed && anotherPerson) {
    const named = middleNameChoices(name, listed, rows);
    if (named.length >= 2) return personDecision(named, rows);
  }

  // Famous name: the exact Wikipedia article plus other en.wikipedia.org pages about the same
  // name is ONE dominant identity — never split it into choices (live: Obama, Taylor Swift).
  // A second person named on the disambiguation page still gets a picker.
  if (!opts?.prior) {
    const exactHit = eligible.find((e) => exactWikiArticle(e.row, name));
    if (exactHit) {
      const exact = exactHit.i;
      // A namesake article ("John Smith (explorer)") proves ambiguity, not fame.
      const support = rows.filter((r, i) => i !== exact && wikiNamePage(r, name) && !qualifiedNamesake(r, name)).length;
      // One other encyclopedia page about this name is the same person. A second person is a
      // qualifier article, a disambiguation list, or a middle initial, and those stay a picker.
      const secondPerson = anotherPerson || rows.some((row) => isDisambiguationPage(row) || qualifiedNamesake(row, name));
      if (support >= 1 && !secondPerson) {
        const win = [...new Set([...(strong.find((c) => c.includes(exact)) ?? [exact]), ...weak])];
        // Another, disambiguated person is a different person: never credited to this one.
        const kept = eligible.map((e) => e.i).filter((i) => !qualifiedNamesake(rows[i]!, name));
        const keptSet = new Set(kept);
        return {
          kind: 'single',
          entity: buildEntity(name, win, rows),
          kept,
          dropped: rows.map((_, i) => i).filter((i) => !keptSet.has(i)),
        };
      }
    }
  }

  // A disambiguation page lists people who share a name. An exact article stays one person
  // unless that page also names someone with a middle initial, a different person.
  const exactArticle = eligible.some((e) => exactWikiArticle(e.row, name));
  if ((!exactArticle || anotherPerson) && !pickAsk && disambig.length) {
    const entries = disambiguationEntries(rows[disambig[0]!]!, name);
    if (entries.length >= 2) {
      const page = rows[disambig[0]!]!;
      const choices: EntityChoice[] = entries
        .map((e) => {
          const top = { role: e.role, org: e.org, location: e.location, label: e.label };
          const { role, descriptor } = specificLabel(top, [page], name);
          const query = choiceQuery(name, { ...top, role });
          return {
            name,
            descriptor,
            query,
            id: slugOf(name, role, e.org, e.location) || slugOf(name, e.label),
            // EN4 part 8: the rows that prove this entry (a namesake page lists other people).
            seeds: rows
              .map((r, i) => i)
              .filter((i) => !isDisambiguationPage(rows[i]!) && personSourceOk(query, rows[i]!, name)),
          };
        })
        // A choice with no descriptor says nothing about the person — never offer it.
        .filter(offerChoice)
        .slice(0, 3);
      // Prefer real clusters when they already give ≥2 choices.
      const clustered = strong.filter((c) => c.length >= 1).map((c) => toChoice(name, c, rows)).filter(offerChoice).slice(0, 3);
      const merged = clustered.length >= 2 ? clustered : choices;
      if (merged.length >= 2) return personDecision(merged, rows);
    }
  }

  // Compare strong clusters only (weak inflated the winner live and blocked choices).
  // Bare common names (no org/role in the query): allow singleton clusters as choices so a
  // LinkedIn CEO and an IMDb director each surface (live Ray Lee / David Kim). They are
  // ranked by weight (rowWeight): the exact Wikipedia article and other en.wikipedia.org
  // pages about the name outrank one aggregator hit, so a dominant identity is never offered
  // as one of two choices.
  const bare = contextTerms(query, name).length === 0;
  // A bare ask ranks its strong clusters; a cluster about the same person as the Wikipedia
  // "(qualifier)" cluster joins it first, so one man is never offered as two choices.
  const merged = bare ? mergeQualifierClusters(strong, rows, name) : strong;
  // An exact Wikipedia article is one famous person: every page about them counts, so a
  // single namesake cannot force a picker. Without that article, a pile of news about one
  // person must not hide someone else — only the two strongest pages score.
  const famous = rows.some((row) => exactWikiArticle(row, name));
  const evidence = (cluster: number[]) => {
    const weights = cluster.map((i) => rowWeight(rows[i]!, name)).sort((a, b) => b - a);
    return (famous ? weights : weights.slice(0, 2)).reduce((sum, weight) => sum + weight, 0);
  };
  const ranked = merged
    .map((c) => ({ cluster: c, score: evidence(c) }))
    .sort((a, b) => b.score - a.score || b.cluster.length - a.cluster.length || a.cluster[0]! - b.cluster[0]!);

  // A page about "Michael B. Jordan" does not make "Michael Jordan" ambiguous.
  const compared = famous ? ranked.filter((r) => !namesakeCluster(r.cluster, rows, name)) : ranked;
  const identity = compared.filter((r) => !topicLabelCluster(r.cluster, rows, name));
  const rivals = identity.length ? identity : compared;
  if (rivals.length >= 2) {
    if (bare) {
      const top = rivals[0]!.score;
      // Only offer a split when the runner-up is a real competitor (≥ half the top score).
      if (rivals[1]!.score >= 0.5 * top) {
        const choices = rivals
          .filter((r) => r.score >= 0.5 * top)
          .slice(0, 3)
          .map((r) => toChoice(name, r.cluster, rows))
          .filter(offerChoice);
        if (choices.length >= 2) return personDecision(choices, rows);
      }
    } else {
      // Asks with context terms keep the size rule.
      const [first, second] = [strong[0]!, strong[1]!];
      if (first.length >= 2 && second.length >= 2 && second.length >= 0.4 * first.length) {
        const choices = strong.filter((c) => c.length >= 2).map((c) => toChoice(name, c, rows)).filter(offerChoice).slice(0, 3);
        if (choices.length >= 2) return personDecision(choices, rows);
      }
    }
  }

  // A bare name whose sources describe different careers is several people. Ask which one
  // before any of those careers share a card.
  if (bare && !opts?.prior) {
    const careers = careerChoices(name, rows);
    if (careers) return personDecision(careers, rows);
  }

  // Single: the top-ranked cluster for a bare ask (else the biggest), weak rows attached to it.
  const lead = famous ? ranked.find((r) => r.cluster.some((i) => exactWikiArticle(rows[i]!, name))) ?? rivals[0] : rivals[0];
  const pool = bare && lead ? [lead.cluster] : merged;
  const clusters = attachWeak(pool.length ? pool : (weak.length ? [weak] : []), pool.length ? weak : []);
  if (!clusters.length) return { kind: 'skip' };
  const win = clusters[0]!;
  const kept = new Set(win);
  return {
    kind: 'single',
    entity: buildEntity(name, win, rows),
    kept: [...win],
    dropped: rows.map((_, i) => i).filter((i) => !kept.has(i)),
  };
}

const SHARED_NAME = /\b(?:multiple|several|many|different) people\b|\bshare(?:s|d)? (?:this|the same) name\b|\b(?:people|persons) (?:named|called|with (?:this|the) name)\b/i;

/**
 * The sources name more than one person: a page says so, or the pages give them
 * different careers and no single encyclopedia article is the person.
 */
export function mixedIdentities(name: string, rows: EntityRow[]): boolean {
  if (!name || rows.length < 2) return false;
  const text = (row: EntityRow) => `${row.title ?? ''} ${row.snippet ?? ''}`;
  if (rows.some((row) => SHARED_NAME.test(text(row)))) return true;
  if (rows.some((row) => exactWikiArticle(row, name))) return false;
  const cores = new Set<string>();
  for (const row of rows) {
    if (isDisambiguationPage(row)) continue;
    const sig = extractSignals(row, name);
    if (!sig.hasName) continue;
    for (const core of sig.roleCores) cores.add(core);
  }
  return cores.size >= 2;
}

/** One choice per career when the same bare name belongs to more than one person. */
function careerChoices(name: string, rows: EntityRow[]): EntityChoice[] | undefined {
  if (!mixedIdentities(name, rows)) return undefined;
  const groups = new Map<string, number[]>();
  rows.forEach((row, i) => {
    if (isDisambiguationPage(row)) return;
    const sig = extractSignals(row, name);
    if (!sig.hasName || !sig.roleCores.length) return;
    const core = sig.roleCores[0]!;
    const list = groups.get(core) ?? [];
    list.push(i);
    groups.set(core, list);
  });
  if (groups.size < 2) return undefined;
  const choices = [...groups.values()]
    .sort((a, b) => b.length - a.length || a[0]! - b[0]!)
    .slice(0, 3)
    .map((cluster) => toChoice(name, cluster, rows))
    .filter(offerChoice);
  return choices.length >= 2 ? choices : undefined;
}

/** The ask's words after the person name ("Ray Lee BlueFlame AI" → "BlueFlame AI"). */
function queryTail(query: string, name: string): string {
  if (!name) return '';
  const words = title(query.replace(/\?+\s*$/, '')).split(' ').filter(Boolean);
  const head = name.split(' ')[0]!.toLowerCase();
  const at = words.findIndex((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '') === head);
  if (at < 0) return '';
  return title(words.slice(at + name.split(' ').length).join(' '));
}

/**
 * EN4 part 8: the sources behind a Which-one? pick. The tapped choice is found again in a fresh
 * disambiguation of the turn's own rows, and every row that proves that person (its org/role on
 * the page, never a namesake page, blocked or fiction host) joins it — so a pick never comes
 * back with nothing to show.
 */
export function pickSeeds(query: string, rows: EntityRow[]): { seeds: number[]; label: string } {
  const name = personSubject(query);
  const tail = queryTail(query, name);
  if (!name || !rows.length) return { seeds: [], label: tail };
  let seeds: number[] = [];
  let label = '';
  const decision = resolveEntity(`Who is ${name}`, rows, { pattern: 'profile' });
  if (decision.kind === 'choices') {
    const asked = normText(query);
    const slug = slugOf(query);
    const hit = decision.choices.find((c) => normText(c.query) === asked || c.id === slug);
    if (hit) {
      seeds = [...(hit.seeds ?? [])];
      label = hit.descriptor;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (seeds.includes(i)) continue;
    if (isBlockedHost(r.url) || isFictionHost(r.url)) continue;
    if (isDisambiguationPage(r)) continue;
    if (!personSourceOk(query, r, name)) continue;
    seeds.push(i);
  }
  // Original SERP order, deduped.
  return { seeds: [...new Set(seeds)].sort((a, b) => a - b), label: label || tail };
}

/** Words that ask who someone is, which a profile card already answers. */
const PROFILE_WORDS = new Set(['bio', 'biography', 'profile', 'wiki', 'wikipedia', 'background', 'person', 'info', 'information']);

/**
 * What the ask wants to know about the person beyond who they are ("jaylen brown injuries" →
 * "injuries"); '' for a plain who-is ask. With `caps` off, capitalised words are the person's
 * org/role ("Ray Lee BlueFlame AI"), not a topic.
 */
export function askTopic(query: string, name: string, caps = false): string {
  const nameSet = new Set(tokens(name));
  const raw = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '');
  const out: string[] = [];
  for (const w of raw.split(/\s+/).map(cleanWord).filter(Boolean)) {
    const t = w.toLowerCase().replace(/[’']s$/, '');
    if (nameSet.has(t) || COMMON.has(t) || PROFILE_WORDS.has(t) || /^(how|what|when|where|why|which)$/.test(t)) continue;
    if (!caps && /^[A-Z0-9]/.test(w)) continue;
    if (FILLER_TERM.has(t) || ROLE1.has(t) || DESCRIPTOR_WORDS.has(t) || ROLE_TAIL.has(t) || ORG_TAIL.test(t) || GENERIC_ORG.test(t) || SPORTS_LEAGUE.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.join(' ');
}

const QUESTION_TITLE = /^(?:who|what|which|where|when|why|how)\b/i;

/**
 * A one-person card is titled with that person's name.
 * A question ("Who is Tim from Blueflame") is not a title. An ask about something of theirs
 * ("Jensen Huang net worth") keeps that topic when the title already names them.
 */
export function personCardTitle(question: string, proposed: string, name: string | undefined): string {
  const person = name?.trim();
  if (!person) return proposed;
  const topic = askTopic(question, person);
  const questionTitle = /\?\s*$/.test(proposed.trim()) || QUESTION_TITLE.test(proposed.trim());
  if (!topic) return person;
  if (questionTitle || !namesPerson(proposed, person)) return `${person} ${topic}`.replace(/\s+/g, ' ').trim();
  return proposed;
}

/** Questions asked earlier in the thread, newest first, from the client's conversation digest. */
export function askedQuestions(context?: string): string[] {
  if (!context) return [];
  const focus = [...context.matchAll(/\(Q: (.+?)\):/g)].map((m) => m[1]!);
  const earlier = [...context.matchAll(/^- Q: (.+?) → /gm)].map((m) => m[1]!).reverse();
  const topic = [...context.matchAll(/^Topic: (.+)$/gm)].map((m) => m[1]!);
  return [...new Set([...focus, ...earlier, ...topic].map((q) => q.trim()).filter(Boolean))];
}

/**
 * The topic a Which-one? pick inherits from the ask that offered it: the newest earlier ask that
 * names the picked person ("jaylen brown injuries" + pick "Jaylen Brown Boston Celtics" →
 * "injuries"). Words the pick already carries are dropped; '' when that ask was a plain who-is.
 */
export function pickTopic(pick: string, asks: string[]): string {
  const name = personSubject(pick);
  // "Name, Capital One" already says who they meant. The earlier company's words stay behind.
  if (!name || commaDetailQuery(pick)) return '';
  // "AJ Dybantsa preseason highlights" already says what to look up. The earlier ask's topic
  // ("stats") is a different question, and inheriting it is what replaced the highlights tap.
  if (askTopic(pick, name)) return '';
  const nameToks = tokens(name);
  const have = new Set(tokens(pick));
  for (const ask of asks) {
    if (!ask || normText(ask) === normText(pick)) continue;
    const toks = new Set(tokens(ask));
    if (!nameToks.every((t) => toks.has(t))) continue;
    return askTopic(ask, name, true).split(' ').filter((w) => w && !have.has(w) && !FILLER_TERM.has(w)).join(' ');
  }
  return '';
}

/**
 * The search for a pick that inherits a topic: the name, the words that tell this person apart
 * (lowercase, so the name stays the person), then the topic ("Jaylen Brown boston celtics injuries").
 */
export function pickTopicQuery(pick: string, topic: string): string {
  const name = personSubject(pick);
  const detail = distinguishingTerms(pick, name);
  const extra = topic.split(' ').filter((w) => w && !FILLER_TERM.has(w) && !detail.includes(w));
  return [name, ...detail, ...extra].filter(Boolean).join(' ').slice(0, 160);
}

/** A people-search page ("LinkedIn professionals named Ricky Cheuk") is not a person to pick. */
const PEOPLE_DIRECTORY = /\b(professionals|people|profiles|users|persons|accounts|members)\s+named\b|\bpeople search\b/i;

function offerChoice(c: EntityChoice): boolean {
  return c.descriptor !== '' && !PEOPLE_DIRECTORY.test(`${c.descriptor} ${c.query}`);
}

/** True when this result is about the chosen entity (name + a matching signal, or name only). */
export function matchesEntity(entity: Entity, row: EntityRow): boolean {
  if (!hasFullPersonName(entity.name, row)) return false;
  const sig = extractSignals(row, entity.name);
  if (sig.sig.size === 0) return true;
  const terms = new Set(entity.terms.map(low));
  for (const t of sig.sig) if (terms.has(low(t))) return true;
  return false;
}

/** Context line appended for design/rewrites so the thread keeps the chosen person. */
export function entityContextLine(entity: Entity): string {
  return `Chosen person: ${entity.name}${entity.role ? ` — ${entity.role}` : ''}${entity.org ? ` @ ${entity.org}` : ''}${entity.location ? ` (${entity.location})` : ''}`;
}

/** Parses a `Chosen person:` line back into an Entity (thread prior). */
export function priorEntity(context?: string): Entity | undefined {
  const m = /^Chosen person:\s*([^\n]+)/m.exec(context ?? '');
  if (!m) return undefined;
  const rest = m[1].trim();
  if (!rest) return undefined;
  const loc = /\(([^()]*)\)\s*$/.exec(rest);
  const location = loc?.[1]?.trim() || undefined;
  const head = loc ? rest.slice(0, loc.index).trim() : rest;
  const [beforeAt, afterAt] = head.split(/\s+@\s+/);
  const org = afterAt?.trim() || undefined;
  const [namePart, rolePart] = (beforeAt ?? '').split(/\s+[—–-]\s+/);
  const name = namePart?.trim();
  if (!name) return undefined;
  const role = rolePart?.trim() || undefined;
  const terms = [...new Set(tokens(`${role ?? ''} ${org ?? ''} ${location ?? ''}`))];
  return { id: slugOf(name, role, org) || slugOf(name), name, role, org, location, terms };
}

/**
 * EN4 encyclopedia knowledge panel helpers (server/stream.ts): the panel is a Wikipedia
 * summary fetched for the literal query, so it can belong to a namesake of the person the
 * SERP is about. Its text/photo must only ride along with the row it came from.
 */

/** Same URL after lowercasing the host and dropping a trailing slash. */
function sameUrl(a: string, b: string): boolean {
  const one = (u: string) => {
    const s = (u ?? '').trim().replace(/\/+$/, '');
    try {
      const url = new URL(s);
      url.hostname = url.hostname.toLowerCase();
      return url.toString().replace(/\/+$/, '');
    } catch {
      return s.toLowerCase();
    }
  };
  return one(a) === one(b);
}

/**
 * The knowledge panel as a search row, when it is an en.wikipedia.org summary no SERP row
 * already carries (the SERP row list decides which person the card is about).
 */
export function knowledgeRow(
  knowledge: { title: string; extract: string; url: string; description?: string } | undefined,
  rows: EntityRow[],
): EntityRow | null {
  const url = knowledge?.url ?? '';
  if (!knowledge || !url || !EN_WIKI_ARTICLE.test(url)) return null;
  if (rows.some((r) => sameUrl(r.url, url))) return null;
  const row = {
    title: knowledge.title,
    url,
    snippet: [knowledge.description, knowledge.extract].filter(Boolean).join(' — '),
    domain: 'en.wikipedia.org',
    engines: ['wikipedia'],
  };
  return row;
}

/** True when the knowledge panel is the article of one of the kept rows (never a namesake's). */
export function knowledgeForKept(knowledge: { url: string } | undefined, keptRows: EntityRow[]): boolean {
  const url = knowledge?.url ?? '';
  if (!knowledge || !url) return false;
  return keptRows.some((r) => sameUrl(r.url, url));
}

/**
 * T443 image-gate plug-in: returns `hintFor` so the existing gate matches the
 * chosen person/org. A hint never loosens the gate — unrelated labels get undefined.
 */
export function entityHintFor(entity: Entity, query = ''): (label: string) => EntityHint | undefined {
  const nameToks = tokens(entity.name);
  const key = nameToks.length ? nameToks.slice().sort((a, b) => b.length - a.length)[0]! : '';
  const surname = nameToks[nameToks.length - 1] ?? '';
  // An org parsed as the person's own name ("Ray Lee") is no org.
  const orgToks = entity.org ? tokens(entity.org).filter((t) => !nameToks.includes(t)) : [];
  const org = orgToks.length ? entity.org : undefined;
  // t451: only an ask that names the org itself ("Raycon CEO") makes the photo carry that org word.
  const askToks = tokens(query);
  const strict = orgToks.some((t) => t.length >= 3 && !['inc', 'llc', 'ltd', 'corp', 'the', 'and', 'company'].includes(t) && askToks.includes(t));
  // EN3: a picked choice / person+descriptor ask ("David Kim C2 Founder") makes the photo carry the org (else the
  // descriptor) word or come from the entity's domains; otherwise no photo (live risk: violinist photo on the C2 card).
  const askCtx = query ? contextTerms(query, entity.name) : [];
  const nonRole = askCtx.filter((t) => !ROLE1.has(t));
  const needCtx = askCtx.length ? [...new Set([...(org ? [org] : []), ...(org || nonRole.length ? nonRole : askCtx)])] : [];
  return (label: string) => {
    const lt = tokens(label);
    if (!lt.length) return undefined;
    // Org tile: the org's own domains may supply its logo; no person context needed.
    if (orgToks.length > 0 && orgToks.some((t) => t.length >= 3 && lt.includes(t))) {
      return { name: entity.name, aliases: entity.aliases, domains: entity.domains };
    }
    if (!nameLike(label)) return undefined;
    if ((surname && lt.includes(surname)) || (key && lt.includes(key))) {
      // Person: their photo must also name the chosen org (or come from its domains), never a namesake's.
      if (needCtx.length) return { name: entity.name, aliases: entity.aliases, domains: entity.domains, context: needCtx, strict: true, requireContext: true };
      // The card settled on this person. A portrait has to name their company or role, not only the shared name.
      const resolved = org ? [org] : entity.role ? [entity.role] : [];
      if (resolved.length) return { name: entity.name, aliases: entity.aliases, domains: entity.domains, context: resolved, ...(strict ? { strict: true } : {}), requireContext: true };
      return { name: entity.name, aliases: entity.aliases, domains: entity.domains };
    }
    return undefined;
  };
}

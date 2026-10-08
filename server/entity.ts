import { nameLike, tokens, type EntityHint } from './imageGate';
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
}

export type EntityDecision =
  | { kind: 'single'; entity: Entity; kept: number[]; dropped: number[] }
  | { kind: 'choices'; choices: EntityChoice[] }
  | { kind: 'skip' };

export interface EntityRow {
  title: string;
  url: string;
  snippet?: string;
}

/** Words that prove a short query is NOT a person name. */
const COMMON = new Set([
  'the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'at', 'to', 'from', 'with', 'about',
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'whom', 'whose',
  'is', 'are', 'was', 'were', 'be', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'best', 'top', 'fastest', 'tallest', 'cheapest', 'newest', 'latest', 'most', 'least', 'first',
  'tell', 'show', 'find', 'give', 'list', 'compare', 'vs', 'versus', 'it', 'this', 'that',
]);

const WHO_IS = /^(who\s+is|who\s+was)\b\s*/i;
const ABOUT = /^(tell\s+me\s+about|profile\s+of|biography\s+of|bio\s+of)\s+/i;
/** "How is Nique Clifford…" / "What is …" — strip so Cap runs start at the name. */
const LEAD_Q = /^(who|what|when|where|why|how)\s+(is|are|was|were|did|does|do)\b\s*/i;

const cleanWord = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');

/** Org/product-ish Cap tokens that end a person+org query ("Ray Lee BlueFlame AI"). */
const ORG_TAIL = /^(ai|ml|io|inc|llc|ltd|corp|co|labs?|technologies|technology|group|studios?|systems?|partners?|associates?)$/i;
const SPORTS_LEAGUE = /^(nba|nfl|mlb|nhl|ncaa|wnba|mls|pga|ufc|wwe)$/i;
/** Ends a Cap name run: CamelCase orgs, Inc/AI tails, or ALL-CAPS acronyms (USATF). */
const looksLikeOrgToken = (w: string) =>
  ORG_TAIL.test(w) ||
  /[a-z][A-Z]/.test(w) ||
  (/^[A-Z]{3,}$/.test(w) && !/^(JR|SR|II|III|IV)$/.test(w));

/** The person the query is about, or '' when there is none. */
export function personSubject(query: string): string {
  const raw = query.trim();
  const hadWho = WHO_IS.test(raw) || ABOUT.test(raw);
  let s = raw.replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '').trim();
  if (!s) return '';
  const words = s.split(/\s+/).map(cleanWord).filter(Boolean);
  if (!words.length) return '';
  const run: string[] = [];
  for (const w of words) {
    // Skip leading Cap interrogatives / common words ("How is…").
    if (!run.length && (COMMON.has(w.toLowerCase()) || /^(how|what|when|where|why|which)$/i.test(w))) continue;
    if (/^[A-Z]/.test(w)) {
      run.push(w);
      if (run.length === 6) break;
    } else break;
  }
  if (run.length) {
    // "Ray Lee BlueFlame AI" / "Ray Lee Raycon Founder" → person "Ray Lee";
    // keep "Barack Hussein Obama" (exactly 3 name tokens, no org/role tail).
    let cut = run.length;
    for (let i = 2; i < run.length; i++) {
      const w = run[i]!;
      if (looksLikeOrgToken(w) || /^(founder|co-founder|coach|player|writer|singer|actor|ceo|cto|cfo|coo|director|engineer|dentist|pianist|mayor|president|author)$/i.test(w)) {
        cut = i;
        break;
      }
    }
    // Choice-query shape "Name Name Org Role" (≥4 Cap tokens): never treat Org as a middle name.
    if (run.length >= 4 && cut > 2) cut = 2;
    return run.slice(0, Math.min(cut, 3)).join(' ');
  }
  // Lowercase person asks only after who/about: "who is barack obama" (not "open source database" or "zxqv").
  if (hadWho && words.length <= 4 && words.every((w) => /^[a-z0-9][a-z0-9.'-]*$/i.test(w) && !COMMON.has(w.toLowerCase()))) {
    return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  }
  return '';
}

/** Strong org/role context beyond the person name (BlueFlame, AI) — not sports acronyms or filler. */
export function contextTerms(query: string, name = personSubject(query)): string[] {
  if (!name) return [];
  const nameSet = new Set(tokens(name));
  const raw = query.trim().replace(/\?+\s*$/, '').replace(WHO_IS, '').replace(ABOUT, '').replace(LEAD_Q, '');
  const words = raw.split(/\s+/).map(cleanWord).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    const t = tokens(w)[0];
    if (!t || nameSet.has(t) || COMMON.has(t)) continue;
    // CamelCase orgs (BlueFlame) or short org tails (AI, Inc) — not NBA/NFL alone.
    // Sports leagues (NBA) are season context, not identity — requiring them dropped the
    // Nique Clifford Wikipedia bio from a preseason ask.
    if (SPORTS_LEAGUE.test(w)) continue;
    // Cap tokens after the person name count as context (Raycon, USATF, Stripe) — not only CamelCase/ALLCAPS.
    const capCtx = /^[A-Z]/.test(w) && w.length >= 3 && !/^(Who|What|When|Where|Why|How)$/i.test(w);
    if (looksLikeOrgToken(w) || ORG_TAIL.test(w) || capCtx) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Multi-word person name must appear as an adjacent phrase in title/snippet
 * (not URL — "blu-ray" / "lee-a-ray" false positives). A single name token is never enough.
 */
export function hasFullPersonName(name: string, row: EntityRow): boolean {
  const nameToks = tokens(name).filter((t) => t.length >= 2);
  if (nameToks.length < 2) return false;
  const segments = [row.title ?? '', row.snippet ?? ''].filter((s) => s.trim());
  if (!segments.length) return false;
  const escRe = /[.*+?^${}()|[\]\\]/g;
  const esc = nameToks.map((t) => t.replace(escRe, '\\$&')).join('\\s+');
  const re = new RegExp(`\\b${esc}\\b`, 'i');
  const mid =
    nameToks.length === 2
      ? new RegExp(
          `\\b${nameToks[0]!.replace(escRe, '\\$&')}\\s+[A-Za-z]\\.?\\s+${nameToks[1]!.replace(escRe, '\\$&')}\\b`,
          'i',
        )
      : null;
  // Match on title/snippet separately so "Ray Lee" + "Ray Lee, …" does not look like "Ray Lee Ray".
  if (!segments.some((s) => re.test(s) || (mid && mid.test(s)))) return false;
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
      if (!nxt || AFTER_OK.has(nxt)) continue;
      if (!ORG_TAIL.test(m[1]!) && !/^(Inc|LLC|Ltd|Corp|Co|AI|ML)$/i.test(m[1]!)) return false;
    }
    // Only a repeated first name ("Ray Ray Lee") is a longer-name prefix — not "Description Ray Lee".
    for (const m of seg.matchAll(prefix)) {
      if ((m[1] ?? '').toLowerCase() === nameToks[0]) return false;
    }
  }
  return true;
}

/** Source is about this person ask: full name + (>=1 context token when the query gives one). */
export function personSourceOk(query: string, row: EntityRow, name = personSubject(query)): boolean {
  if (!name || !hasFullPersonName(name, row)) return false;
  const ctx = contextTerms(query, name);
  if (!ctx.length) return true;
  // A specific org word (BlueFlame) outranks tails (AI, Inc): "Humantic AI … Ray Lee, VP at Salient" must not pass on "ai".
  const specific = ctx.filter((t) => !ORG_TAIL.test(t));
  const need = specific.length ? specific : ctx;
  const body = new Set(tokens(`${row.title ?? ''} ${row.snippet ?? ''} ${row.url ?? ''}`));
  return need.some((t) => body.has(t) || (t.length >= 5 && [...body].some((w) => w.includes(t))));
}

export function isPersonAsk(query: string, pattern?: string): boolean {
  const subject = personSubject(query);
  if (pattern === 'profile') return subject !== '';
  if (WHO_IS.test(query.trim())) return subject !== '';
  return subject !== '' && nameLike(subject);
}

/** Single-word roles (lowercase) plus a few two-word ones. */
const ROLE2 = ['software engineer', 'software developer', 'concert pianist', 'general dentist', 'prime minister', 'chief executive', 'medical doctor'];
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

/** Maps a matched role token to its canonical display + core. */
function canonRole(matched: string): { display: string; core: string } {
  const low = matched.toLowerCase();
  const core = low === 'mayoral' ? 'mayor' : low === 'presidential' ? 'president' : low;
  const display = /^(ceo|cto|cfo|coo)$/i.test(core) ? core.toUpperCase()
    : core.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
  return { display, core };
}

const title = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
const low = (s: string) => s.toLowerCase();

const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const normText = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Generic words that carry no disambiguating signal inside org/location phrases. */
const GENERIC = new Set(['the', 'of', 'and', 'for', 'at', 'in', 'a', 'an', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'group', 'official']);
const coreWords = (s: string) => normText(s).split(' ').filter((t) => t.length >= 2 && !GENERIC.has(t));

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
        const v = title(m[m.length - 1] ?? '');
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
        const v = title((m[m.length - 1] ?? '').replace(/^(the|a|an)\s+/i, ''));
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

const CLASS_LABEL: Record<string, string> = {
  linkedin: 'LinkedIn profile',
  wikipedia: 'Wikipedia article',
  imdb: 'IMDb page',
  edu: 'University page',
};

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
  if (wikiLabel && wikiLabel.length >= 3 && wikiLabel.length <= 40) {
    // Reject mashed labels ("Coach at USATF CEO Max").
    if (!/\b(CEO|Founder|Coach|Player|Director|Author)\b.*\b(CEO|Founder|Coach|Player|Director|Author)\b/i.test(wikiLabel)) {
      return title(wikiLabel).slice(0, 40);
    }
  }
  const role = top.role ? title(top.role) : '';
  let org = top.org ? cleanPhrase(top.org) : '';
  let loc = top.location ? cleanPhrase(top.location, 20) : '';
  // A bare city captured as org → location ("Actor in Los Angeles").
  if (org && !loc && /^(Los Angeles|New York|London|Chicago|Paris|Tokyo|Kuala Lumpur|San Francisco|Austin|Boston|Seattle|Portland|Philadelphia)$/i.test(org)) {
    loc = org;
    org = '';
  }
  let raw = '';
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
  } else {
    const cls = extractSignals(rows[0]!, name).domainClass;
    raw = CLASS_LABEL[cls] ?? hostOf(rows[0]!.url);
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
  return out.length > 40 ? `${out.slice(0, 39).trim()}…` : out;
}

/** Searchable follow-up: "Ray Lee USATF coach" — name + org/role words, no "at/of". */
function choiceQuery(name: string, top: { role?: string; org?: string; location?: string }): string {
  const bits = [name];
  if (top.org) bits.push(cleanPhrase(top.org, 24));
  if (top.role) bits.push(top.role);
  else if (top.location) bits.push(cleanPhrase(top.location, 16));
  return title(bits.filter(Boolean).join(' ')).slice(0, 120);
}

function toChoice(name: string, cluster: number[], rows: EntityRow[]): EntityChoice {
  const top = topOf(cluster, rows, name);
  const descriptor = describe(top, cluster.map((i) => rows[i]!), name);
  return { name, descriptor, query: choiceQuery(name, top), id: slugOf(name, top.role, top.org, top.location) || slugOf(name) };
}

/** Wikipedia disambiguation page: title/url "(disambiguation)" or snippet "may refer to". */
export function isDisambiguationPage(row: EntityRow): boolean {
  const titleText = row.title ?? '';
  const url = row.url ?? '';
  const snip = row.snippet ?? '';
  if (/\(disambiguation\)/i.test(titleText) || /\(disambiguation\)/i.test(url)) return true;
  if (/\bmay refer to\b/i.test(titleText) || /\bmay refer to\b/i.test(snip)) return true;
  return false;
}

/**
 * Seed choice descriptors from a disambiguation page's snippet/title entries
 * ("Ray Lee (coach)", "Ray Lee, American CEO", …).
 */
export function disambiguationEntries(row: EntityRow, name: string): { role?: string; org?: string; location?: string; label: string }[] {
  const text = `${row.title ?? ''}. ${row.snippet ?? ''}`;
  const out: { role?: string; org?: string; location?: string; label: string }[] = [];
  const seen = new Set<string>();
  const push = (label: string, role?: string, org?: string, location?: string) => {
    const k = low(label);
    if (!k || seen.has(k) || k === low(name)) return;
    seen.add(k);
    out.push({ label: title(label).slice(0, 40), role, org, location });
  };
  // "Name (role)" / "Name (role, org)"
  const paren = new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\(([^)]{2,40})\\)`, 'gi');
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
    // Prefer clean wiki gloss as label when we have role (or short inside).
    push(role && !org ? role : inside, role, org);
  }
  // "Name, role at Org" / "Name – role"
  const dash = new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*[,–—-]\\s*([^.;\\n]{3,50})`, 'gi');
  for (const m of text.matchAll(dash)) {
    const rest = title(m[1] ?? '');
    if (/\bmay refer to\b/i.test(rest)) continue;
    const at = /\b(.+?)\s+(?:at|of|for)\s+(.+)$/i.exec(rest);
    if (at) {
      const rPart = title(at[1]!);
      const oPart = title(at[2]!);
      // Drop leading nationality adjectives from role ("American Businessman" → Businessman).
      const rToks = rPart.split(/\s+/);
      const rCore = rToks.filter((w) => !/^(american|british|english|canadian|australian|french|german|chinese|japanese|korean|indian)$/i.test(w));
      const roleGuess = rCore.find((w) => ROLE1.has(low(w)));
      push(roleGuess ? `${canonRole(roleGuess).display}${oPart ? ' of ' + cleanPhrase(oPart, 18) : ''}`.slice(0, 40) : rest.slice(0, 40),
        roleGuess ? canonRole(roleGuess).display : undefined, oPart);
    } else {
      const toks = rest.split(/\s+/);
      const roleTok = toks.find((w) => ROLE1.has(low(w)) || ROLE2.some((r) => low(w).includes(r.split(' ')[0]!)));
      push(roleTok ? canonRole(roleTok).display : rest.slice(0, 40), roleTok ? canonRole(roleTok).display : undefined, undefined);
    }
  }
  return out.slice(0, 6);
}

export function resolveEntity(
  query: string,
  rows: EntityRow[],
  opts?: { pattern?: string; prior?: Entity },
): EntityDecision {
  if (!isPersonAsk(query, opts?.pattern)) return { kind: 'skip' };
  const name = personSubject(query);
  if (!name || !rows.length) return { kind: 'skip' };
  // Drop adult/spam + non-full-name / missing-context hits before clustering.
  const eligible = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => {
      if (isBlockedHost(row.url)) return false;
      // Game wikis / fandom never seed person choices (live: "Player at San Andreas State").
      if (!opts?.prior && isFictionHost(row.url)) return false;
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

  // Seed choices from a disambiguation page when clustering is thin.
  if (disambig.length) {
    const entries = disambiguationEntries(rows[disambig[0]!]!, name);
    if (entries.length >= 2) {
      const choices: EntityChoice[] = entries.slice(0, 4).map((e) => ({
        name,
        descriptor: describe({ role: e.role, org: e.org, location: e.location, label: e.label }, [rows[disambig[0]!]!], name) || e.label.slice(0, 40),
        query: choiceQuery(name, { role: e.role, org: e.org, location: e.location }),
        id: slugOf(name, e.role, e.org, e.location) || slugOf(name, e.label),
      }));
      // Prefer real clusters when they already give ≥2 choices.
      const clustered = strong.filter((c) => c.length >= 1).slice(0, 4).map((c) => toChoice(name, c, rows));
      const merged = clustered.length >= 2 ? clustered : choices;
      if (merged.length >= 2) return { kind: 'choices', choices: merged };
    }
  }

  // Compare strong clusters only (weak inflated the winner live and blocked choices).
  // Bare common names (no org/role in the query): allow singleton clusters as choices so a
  // LinkedIn CEO and an IMDb director each surface (live Ray Lee / David Kim). Famous names
  // with context, or a dominant cluster vs a singleton, still stay single (Obama dog article).
  if (strong.length >= 2) {
    const [first, second] = [strong[0]!, strong[1]!];
    const bare = contextTerms(query, name).length === 0;
    const minSize = bare ? 1 : 2;
    if (second.length >= minSize && first.length >= minSize && (bare || second.length >= 0.4 * first.length)) {
      const choices = strong.filter((c) => c.length >= minSize).slice(0, 4).map((c) => toChoice(name, c, rows));
      if (choices.length >= 2) return { kind: 'choices', choices };
    }
  }

  const clusters = attachWeak(strong.length ? strong : (weak.length ? [weak] : []), strong.length ? weak : []);
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
      return { name: entity.name, aliases: entity.aliases, domains: entity.domains, ...(org ? { context: [org], ...(strict ? { strict: true } : {}) } : {}) };
    }
    return undefined;
  };
}

import { nameLike, tokens, type EntityHint } from './imageGate';
import { isBlockedHost } from './spamHosts';

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
const looksLikeOrgToken = (w: string) => ORG_TAIL.test(w) || /[a-z][A-Z]/.test(w);

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
    // "Ray Lee BlueFlame AI" → person "Ray Lee"; keep "Barack Hussein Obama" (no org-like token).
    let cut = run.length;
    for (let i = 2; i < run.length; i++) {
      if (looksLikeOrgToken(run[i]!)) {
        cut = i;
        break;
      }
    }
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
    if (looksLikeOrgToken(w) || ORG_TAIL.test(w)) {
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
  const body = normText(`${row.title ?? ''} ${row.snippet ?? ''}`);
  if (!body) return false;
  const phrase = nameToks.join(' ');
  if (body.includes(phrase)) return true;
  // Allow one middle initial between the first and last name tokens: "ray j lee".
  if (nameToks.length === 2) {
    const [a, b] = nameToks;
    const mid = new RegExp(`\\b${a}\\s+[a-z]\\.?\\s+${b}\\b`);
    if (mid.test(body)) return true;
  }
  return false;
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
  'novelist', 'scholar', 'dean', 'principal', 'quarterback', 'pitcher', 'chairman', 'spokesperson',
  'nurse', 'librarian', 'pastor', 'rabbi', 'monk', 'chief', 'king', 'queen', 'prince', 'princess',
]);

/** Maps a matched role token to its canonical display + core. */
function canonRole(matched: string): { display: string; core: string } {
  const low = matched.toLowerCase();
  const core = low === 'mayoral' ? 'mayor' : low === 'presidential' ? 'president' : low;
  const display = core.split(' ').map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
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

/** Clusters of row indices (into the original rows array) that share one identity. */
function clusterRows(rows: EntityRow[], name: string): number[][] {
  const sigs = rows.map((r) => extractSignals(r, name));
  const named = sigs.map((s, i) => (s.hasName ? i : -1)).filter((i) => i >= 0);
  if (!named.length) return [];
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
  // Weak (name-only) rows absorb into the largest strong cluster.
  const weak = named.filter((i) => sigs[i]!.sig.size === 0);
  if (weak.length) {
    if (clusters.length) {
      clusters.sort((a, b) => b.length - a.length);
      clusters[0]!.push(...weak);
    } else {
      clusters.push([...weak]);
    }
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

function describe(top: { role?: string; org?: string; location?: string }, rows: EntityRow[], name: string): string {
  if (top.role && top.org) return `${top.role} at ${top.org}`;
  if (top.role && top.location) return `${top.role} of ${top.location}`;
  if (top.role) return top.role;
  if (top.org) return top.org;
  if (top.location) return top.location;
  const cls = extractSignals(rows[0]!, name).domainClass;
  return CLASS_LABEL[cls] ?? hostOf(rows[0]!.url);
}

function toChoice(name: string, cluster: number[], rows: EntityRow[]): EntityChoice {
  const top = topOf(cluster, rows, name);
  const descriptor = describe(top, cluster.map((i) => rows[i]!), name);
  const query = title([name, top.role, top.org, top.location && !top.org ? top.location : ''].filter(Boolean).join(' '));
  return { name, descriptor, query, id: slugOf(name, top.role, top.org, top.location) || slugOf(name) };
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
    .filter(({ row }) => !isBlockedHost(row.url) && personSourceOk(query, row, name));
  if (!eligible.length) return { kind: 'skip' };
  const filtered = eligible.map((e) => e.row);
  const indexMap = eligible.map((e) => e.i);
  const clustersRaw = clusterRows(filtered, name);
  const clusters = clustersRaw.map((c) => c.map((j) => indexMap[j]!));
  if (!clusters.length) return { kind: 'skip' };

  // A thread entity locks the choice: prefer clusters that match it, never ask again.
  if (opts?.prior) {
    const locked = clusters.filter((c) => c.some((i) => matchesEntity(opts.prior!, rows[i]!)));
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
  }

  if (clusters.length >= 2) {
    const [first, second] = [clusters[0]!, clusters[1]!];
    if (second.length >= 2 && second.length >= 0.6 * first.length && first.length >= 2) {
      const choices = clusters.filter((c) => c.length >= 2).slice(0, 4).map((c) => toChoice(name, c, rows));
      if (choices.length >= 2) return { kind: 'choices', choices };
    }
  }
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
export function entityHintFor(entity: Entity): (label: string) => EntityHint | undefined {
  const nameToks = tokens(entity.name);
  const key = nameToks.length ? nameToks.slice().sort((a, b) => b.length - a.length)[0]! : '';
  const surname = nameToks[nameToks.length - 1] ?? '';
  // An org parsed as the person's own name ("Ray Lee") is no org.
  const orgToks = entity.org ? tokens(entity.org).filter((t) => !nameToks.includes(t)) : [];
  const org = orgToks.length ? entity.org : undefined;
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
      return { name: entity.name, aliases: entity.aliases, domains: entity.domains, ...(org ? { context: [org] } : {}) };
    }
    return undefined;
  };
}

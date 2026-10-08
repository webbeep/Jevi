/**
 * Drops off-topic hits after they are merged and before the answer model sees them.
 * No network and no model call: names, other capitalised tokens, uncommon words, and numbers
 * from the question are matched against the title, snippet, and URL.
 *
 * A hit that contains a multi-word name from the question is kept.
 * A year or season the question names (2026, 2025-26) drops a hit whose title or snippet
 * only names a clearly different year (1995), unless the name is there and the title itself
 * does not carry the conflicting year.
 * If nothing passes, the best remaining hits are kept only when they clear a low floor and, for a
 * question carrying three or more key terms, repeat at least two of them.
 * Otherwise the list is empty so the no-fresh-sources path can run.
 * Hits that merely score low stay when they are most of the list: many real titles never repeat the question.
 */

const MAIN = 0.3;
const FLOOR = 0.2;

/** Question words and task words. They are not what the hit has to be about. */
const TASK = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'and', 'or', 'but', 'if', 'as',
  'is', 'are', 'was', 'were', 'be', 'am', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'have', 'has', 'had', 'it', 'its', 'this', 'that', 'my', 'your', 'our', 'me', 'you', 'i', 'we', 'they', 'them',
  'who', 'what', 'when', 'where', 'why', 'how', 'which', 'about', 'into', 'over', 'than', 'then', 'not', 'no',
  'so', 'just', 'very', 'now', 'vs', 'versus', 'per', 'much', 'find', 'give', 'show', 'list', 'tell', 'quote',
  'please', 'recommend', 'summarize', 'summarise', 'fact', 'check', 'fact-check', 'official', 'source', 'primary',
  'real', 'original', 'current', 'exact', 'need', 'using', 'use', 'make', 'get', 'look', 'looking', 'says', 'said',
  'page', 'pages', 'changed', 'since', 'version', 'supported', 'author', 'authors', 'publication', 'year', 'years',
  'paper', 'papers', 'book', 'books', 'review', 'reviews', 'best', 'good', 'buy', 'cost', 'price', 'prices',
  'compare', 'introduced', 'venue', 'also', 'too', 'really', 'let', 'lets', 'up', 'id', 'ids',
]);

const TOKEN = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;

import { isBlockedHost } from './spamHosts';
import { contextTerms, hasFullPersonName, isPersonAsk, personSubject } from './entity';

export interface GateHit {
  title: string;
  url: string;
  snippet?: string;
}

interface Profile {
  phrases: string[][];
  singles: string[];
  weights: [string, number][];
  total: number;
  years: number[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

function isTask(word: string): boolean {
  const low = word.toLowerCase();
  if (TASK.has(low) || TASK.has(norm(word))) return true;
  const parts = low.split(/[^a-z0-9]+/).filter(Boolean);
  return parts.length > 1 && parts.every((p) => TASK.has(p));
}

function isCap(word: string): boolean {
  if (!/[A-Za-z]/.test(word) || word.length < 2 || isTask(word)) return false;
  if (/^[A-Z]{2,}[0-9]*$/.test(word)) return true;
  if (/^[A-Z]/.test(word)) return true;
  return /[a-z]/.test(word) && /[A-Z]/.test(word);
}

function yearsOf(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/\b((?:19|20)\d{2})\s*[-–/]\s*(\d{2}|\d{4})\b/g)) {
    const start = Number(m[1]);
    let end = m[2].length === 4 ? Number(m[2]) : Math.floor(start / 100) * 100 + Number(m[2]);
    if (m[2].length === 2 && end < start) end += 100;
    out.add(start);
    out.add(end);
  }
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add(Number(m[0]));
  return [...out];
}

function conflicts(question: number[], found: number[]): boolean {
  if (!question.length || !found.length) return false;
  return !found.some((y) => question.some((q) => Math.abs(q - y) <= 1));
}

function termsOf(query: string): Profile {
  const words = query.match(TOKEN) ?? [];
  const caps: { i: number; token: string }[] = [];
  words.forEach((word, i) => {
    if (!isCap(word)) return;
    const token = norm(word);
    if (token) caps.push({ i, token });
  });
  const phrases: string[][] = [];
  const singles: string[] = [];
  for (let k = 0; k < caps.length;) {
    let j = k;
    while (j + 1 < caps.length && caps[j + 1].i === caps[j].i + 1) j++;
    const run = caps.slice(k, j + 1).map((c) => c.token);
    if (run.length >= 2) phrases.push(run);
    else singles.push(run[0]);
    k = j + 1;
  }
  const weight = new Map<string, number>();
  const bump = (token: string, w: number) => {
    if (!token || TASK.has(token)) return;
    weight.set(token, Math.max(weight.get(token) ?? 0, w));
  };
  for (const phrase of phrases) for (const token of phrase) bump(token, 3);
  for (const token of singles) bump(token, 2);
  for (const word of words) {
    const token = norm(word);
    if (!token || TASK.has(token) || isCap(word)) continue;
    if (/^(?:19|20)\d{2}$/.test(token) || /^\d+\.\d+$/.test(token) || /^\d{2,}$/.test(token)) bump(token, 2);
    else if (token.length >= 4) bump(token, 1);
  }
  const years = yearsOf(query);
  for (const year of years) bump(String(year), 2);
  const weights = [...weight.entries()];
  return { phrases, singles, weights, total: weights.reduce((sum, [, w]) => sum + w, 0), years };
}

/** Light suffix fold so "printing" meets "print" and "printers". */
function forms(token: string): string[] {
  const out = [token];
  if (token.length >= 7 && token.endsWith('ers')) out.push(token.slice(0, -3));
  if (token.length >= 7 && token.endsWith('ing')) out.push(token.slice(0, -3));
  if (token.length >= 6 && token.endsWith('ed')) out.push(token.slice(0, -2));
  if (token.length >= 5 && token.endsWith('s') && !token.endsWith('ss')) out.push(token.slice(0, -1));
  return out;
}

function hasTerm(hay: string, token: string): boolean {
  const want = new Set(forms(token));
  for (const word of hay.split(' ')) {
    if (!word) continue;
    if (want.has(word)) return true;
    for (const form of forms(word)) if (want.has(form)) return true;
  }
  return false;
}

/** A question carrying several key terms needs two of them in one hit: one word alone is noise. */
function sharesTerms(profile: Profile, hits: number): boolean {
  return profile.weights.length < 3 || hits >= 2;
}

function judge(profile: Profile, row: GateHit): { pass: boolean; hard: boolean; score: number; hits: number } {
  const title = norm(row.title);
  const hay = `${title} ${norm(row.snippet ?? '')} ${norm(row.url)}`;
  const has = (token: string) => hasTerm(hay, token);
  const fullName = profile.phrases.some((phrase) => phrase.every(has));
  const nameTouch = profile.phrases.some((phrase) => phrase.some((token) => token.length >= 4 && has(token)));
  let matched = 0;
  let hits = 0;
  for (const [token, w] of profile.weights) {
    if (!has(token)) continue;
    matched += w;
    hits += 1;
  }
  const score = profile.total ? matched / profile.total : 1;
  const lone = profile.phrases.length === 0 && profile.singles.some(has) && sharesTerms(profile, hits);
  const bodyYears = yearsOf(`${row.title} ${row.snippet ?? ''}`);
  const hard = conflicts(profile.years, bodyYears) && !(fullName && !conflicts(profile.years, yearsOf(row.title)));
  return { pass: !hard && (fullName || nameTouch || lone || score >= MAIN), hard, score, hits };
}

export function gateResults<T extends GateHit>(query: string, rows: readonly T[]): { kept: T[]; dropped: number } {
  if (!rows.length) return { kept: [], dropped: 0 };
  // Adult/spam hosts never survive (sources or images use the same check).
  const clean = rows.filter((row) => !isBlockedHost(row.url));
  const spamDropped = rows.length - clean.length;
  // Multi-word person ask: require the full adjacent name in title/snippet, plus a context
  // token (org/role) when the query names one. A single-token match is never enough.
  let pool = clean;
  let personDropped = 0;
  if (isPersonAsk(query)) {
    const name = personSubject(query);
    const nameToks = name ? name.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2) : [];
    // Multi-word person names only: a single token is never enough to force the person gate.
    if (name && nameToks.length >= 2) {
      const ctx = contextTerms(query, name);
      const withCtx = clean.filter((row) => hasFullPersonName(name, row) && (
        ctx.length === 0 ||
        ctx.some((t) => hasTerm(norm(`${row.title} ${row.snippet ?? ''} ${row.url}`), t))
      ));
      // Picked-choice follow-up (e.g. "Ray Lee USATF coach"): if context is too strict
      // and every hit is dropped, keep full-name matches rather than no_sources.
      const ok = withCtx.length ? withCtx : clean.filter((row) => hasFullPersonName(name, row));
      personDropped = clean.length - ok.length;
      pool = ok;
    }
  }
  if (!pool.length) return { kept: [], dropped: rows.length };
  const profile = termsOf(query);
  const judged = pool.map((row) => judge(profile, row));
  const passing = judged.filter((j) => j.pass).length;
  let kept: T[];
  if (passing > 0) {
    const soft = judged.filter((j) => !j.pass && !j.hard).length;
    const dropSoft = soft * 2 < pool.length;
    kept = pool.filter((_, i) => {
      const j = judged[i];
      if (j.hard) return false;
      if (j.pass) return true;
      return !dropSoft;
    });
  } else {
    kept = pool.filter((_, i) => !judged[i].hard && judged[i].score >= FLOOR && sharesTerms(profile, judged[i].hits));
  }
  return { kept, dropped: rows.length - kept.length };
}

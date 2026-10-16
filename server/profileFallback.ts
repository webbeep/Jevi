import type { CardNode } from '../shared/card';
import type { ImageResult, SearchResult } from '../shared/types';
import { type EntityHint, accepts, personPortrait, tokens, withHint } from './imageGate';

export interface ProfilePerson {
  name: string;
  role?: string;
  org?: string;
}

interface Fact {
  value: string;
  source: number;
  sub?: string;
}

interface Facts {
  role?: Fact;
  company?: Fact;
  education?: Fact;
  prior?: Fact;
  location?: Fact;
  line?: { text: string; source: number };
}

const FIRST_PERSON = /(^|[^\w’'])(I|I'm|I’m|I've|I’ve|my|me|we|our)(?=[^\w’']|$)/;
const ORG_WORD = String.raw`[A-Z0-9][\w&'’-]*(?:\.[\w&'’-]+)*`;
const ORG_WORDS = String.raw`${ORG_WORD}(?:\s+(?:${ORG_WORD}|of|and|&|for|the)){0,5}`;
const ROLE_AT = new RegExp(String.raw`\b((?:Senior |Lead |Staff |Principal |Chief |Head of |Co-?founder|Founder|Director|Manager|VP|Vice President|President|CEO|CTO|CFO|COO|Partner|Engineer|Software|Product|Data|Research|Machine Learning|Associate|Analyst|Designer|Developer|Scientist|Consultant|Professor|Intern)[\w &/,-]{0,40}?)\s+(?:at|@)\s+(${ORG_WORDS})`);
const LABELED = (label: string) => new RegExp(String.raw`\b${label}:\s*([^·|…\n]+?)(?=\s*(?:·|\||…|\.\.\.|$|\s[A-Z][a-z]+:))`);
const PRIOR = new RegExp(String.raw`\b(?:previously|formerly|former|prior(?: to that)?|before that)\b,?\s+(?:(?:worked|was)\s+)?(?:at\s+)?(${ORG_WORDS})`, 'i');

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s,;:·.–-]+$/, '').trim();
const same = (a?: string, b?: string) => !!a && !!b && tokens(a).join(' ') === tokens(b).join(' ');

/** The row is about this person: it carries their surname and their first name (or an initial on a profile site). */
function aboutPerson(row: SearchResult, name: string): boolean {
  const words = tokens(`${row.title ?? ''} ${row.snippet ?? ''} ${row.url}`);
  const own = tokens(name);
  const surname = own[own.length - 1];
  return !!surname && words.includes(surname);
}

/** Facts the snippets state about one person: a LinkedIn-style headline, labeled fields and a clean third-person line. */
export function personFacts(person: ProfilePerson, rows: SearchResult[]): Facts {
  const out: Facts = {};
  rows.forEach((row, i) => {
    if (!aboutPerson(row, person.name)) return;
    const n = i + 1;
    const text = `${row.title ?? ''} · ${row.snippet ?? ''}`;
    const roleAt = ROLE_AT.exec(row.snippet ?? '') ?? ROLE_AT.exec(row.title ?? '');
    if (roleAt && !out.role) out.role = { value: tidy(roleAt[1]!), sub: tidy(roleAt[2]!), source: n };
    const experience = LABELED('Experience').exec(text);
    if (experience && !out.company) out.company = { value: tidy(experience[1]!), source: n };
    const education = LABELED('Education').exec(text);
    if (education && !out.education) out.education = { value: tidy(education[1]!), source: n };
    const location = LABELED('Location').exec(text);
    if (location && !out.location) out.location = { value: tidy(location[1]!), source: n };
    const prior = PRIOR.exec(row.snippet ?? '');
    if (prior && !out.prior) out.prior = { value: tidy(prior[1]!), source: n };
    if (!out.line) {
      const sentence = (row.snippet ?? '').split(/(?<=[.!?])\s+/).find((s) => /[.!?]$/.test(s.trim()) && !FIRST_PERSON.test(s) && tokens(s).includes(tokens(person.name).pop() ?? '') && s.length >= 40);
      if (sentence) out.line = { text: tidy(sentence.replace(/\[\d+\]/g, '')), source: n };
    }
  });
  if (!out.role && person.role) out.role = { value: person.role, source: 0 };
  if (!out.company && person.org && !same(person.org, out.role?.sub)) out.company = { value: person.org, source: 0 };
  if (!out.company && out.role?.sub) out.company = { value: out.role.sub, source: out.role.source };
  if (out.role?.sub && same(out.role.sub, out.company?.value)) out.role = { ...out.role, sub: undefined };
  if (out.prior && (same(out.prior.value, out.company?.value) || same(out.prior.value, out.role?.sub))) out.prior = undefined;
  return out;
}

const cite = (source: number) => (source > 0 ? ` [${source}]` : '');
const article = (role: string) => (/^[aeiou]/i.test(role) ? 'an' : 'a');

/** A short third-person summary built from the facts, never a first-person snippet. */
function summary(name: string, f: Facts): string {
  const first = name.split(' ')[0]!;
  const parts: string[] = [];
  const role = f.role?.value;
  const roleOrg = f.role?.sub;
  if (role && roleOrg) parts.push(`${name} is ${article(role)} ${role} at ${roleOrg}${cite(f.role!.source)}.`);
  else if (role && f.company) parts.push(`${name} is ${article(role)} ${role} at ${f.company.value}${cite(f.role!.source)}.`);
  else if (role) parts.push(`${name} is ${article(role)} ${role}${cite(f.role!.source)}.`);
  else if (f.company) parts.push(`${name} works at ${f.company.value}${cite(f.company.source)}.`);
  if (f.company && roleOrg) parts.push(`${first}’s experience includes ${f.company.value}${cite(f.company.source)}.`);
  if (f.prior) parts.push(`${first} was previously at ${f.prior.value}${cite(f.prior.source)}.`);
  if (f.education) parts.push(`${first} studied at ${f.education.value}${cite(f.education.source)}.`);
  if (f.line && parts.length < 3) parts.push(`${f.line.text}${/[.!?]$/.test(f.line.text) ? '' : '.'}${cite(f.line.source)}`);
  return parts.join(' ');
}

/**
 * The standard profile for one chosen person, built from snippets when the designer produced nothing:
 * photo or initials, name, role line, facts, Role / Company / Education / Prior role tiles, and a
 * third-person summary. Only a picture that passes that person's photo gate is used.
 */
export function profileFallback(person: ProfilePerson, rows: SearchResult[], images: ImageResult[], hintFor?: (entity: string) => EntityHint | undefined): CardNode[] {
  const f = personFacts(person, rows);
  const target = withHint({ kind: 'named', entity: person.name }, { hintFor });
  const imageRef = images.findIndex((img) => accepts(target, img));
  const portrait = imageRef >= 0 ? undefined : personPortrait(person.name, [
    ...rows.map((row) => ({ title: row.title, url: row.url, image: row.image })),
    ...images.map((img) => ({ title: img.title, url: img.url, image: img.thumb })),
  ]);
  const roleLine = [f.role?.value, f.company?.value ?? f.role?.sub].filter(Boolean).join(' · ');
  const facts = [
    f.role && { label: 'Role', value: f.role.value },
    f.company && { label: 'Company', value: f.company.value },
    f.education && { label: 'Education', value: f.education.value },
    f.location && { label: 'Location', value: f.location.value },
  ].filter((x): x is { label: string; value: string } => !!x);
  const tile = (label: string, icon: string, fact?: Fact): CardNode | undefined => fact && ({ type: 'tile', label, value: fact.value, icon, ...(fact.sub ? { sub: fact.sub } : {}), ...(fact.source > 0 ? { source: fact.source } : {}) });
  const tiles = [
    tile('Role', 'briefcase', f.role),
    tile('Company', 'building-2', f.company),
    tile('Education', 'graduation-cap', f.education),
    tile('Prior role', 'history', f.prior),
  ].filter((x): x is CardNode => !!x);
  const body: CardNode[] = [{ type: 'profile', name: person.name, ...(roleLine ? { subtitle: roleLine } : {}), ...(portrait ? { imageSrc: portrait.src } : imageRef >= 0 ? { imageRef } : {}), ...(facts.length ? { facts } : {}) }];
  if (tiles.length >= 2) body.push({ type: 'grid', cols: 2, children: tiles });
  const text = summary(person.name, f);
  if (text) body.push({ type: 'text', text, size: 'md' });
  const refs = [...new Set([f.role, f.company, f.education, f.prior, f.line].map((x) => x?.source ?? 0).filter((n) => n > 0))].slice(0, 4);
  if (refs.length) body.push({ type: 'citations', refs });
  return body;
}

import type { ImageResult } from '../shared/types';

/**
 * T443 image relevance gate: a wrong picture is worse than none.
 * - Role, title, location, date and other attribute tiles never get a photo (icon instead).
 * - School, company and org tiles only get a picture from the entity's own site (host names it) or a
 *   knowledge-graph/pooled picture whose title and host name it.
 * - Named things and people need every significant name token in the picture's title, alt, page URL or file URL.
 */
export type PicKind = 'none' | 'org' | 'named';
export interface PicTarget {
  kind: PicKind;
  entity: string;
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'in', 'at', 'on', 'to', 'de', 'la', 'le', 'du', 'von', 'van', 'inc', 'llc', 'ltd', 'co', 'corp', 'company', 'group', 'official', 'jr', 'sr', 'ii', 'iii', 'vs']);
const ORG_GENERIC = new Set(['university', 'college', 'school', 'institute', 'academy', 'ai', 'labs', 'lab', 'team', 'club', 'foundation', 'technologies', 'technology', 'systems', 'union', 'society', 'association', 'hq', 'studio', 'studios']);

const ATTR = /^(role|title|job|job title|position|occupation|profession|current role|location|city|country|based in|based|hometown|home|born|birth ?date|birthday|date|dates|age|founded|year|years|since|height|weight|salary|pay|net worth|status|degree|major|field|focus|nationality|citizenship|experience|skills?|expertise|industry|level|seniority|tenure|languages?|email|phone|website|contact|followers|record|stats?|joined|class|graduated|graduation|specialty|speciality|seat|term|party)$/i;
const ORG = /^(company|employer|works? at|current company|workplace|education|school|university|college|alma mater|studied at|organi[sz]ation|org|team|club|studio|label|record label|publisher|brand|firm|agency|startup|institution|employer now|previously|former company)$/i;

/** "Lendeborg", "Steph Curry", "Nike Pegasus 41": 1–5 words starting with a capital or digit. */
export const nameLike = (s: string) => /^(?:[A-Z0-9][\w.'’&+-]*)(?:\s+[A-Za-z0-9][\w.'’&+-]*){0,4}$/.test(s.trim()) && /[A-Z]/.test(s);

export const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const tokens = (s: string) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);

/** Significant name tokens, longest first (numbers only when nothing else is left). */
function nameTokens(entity: string): string[] {
  const all = tokens(entity).filter((t) => !STOP.has(t));
  const words = all.filter((t) => !/^\d+$/.test(t));
  return (words.length ? words : all).slice(0, 4);
}

/** The token an org picture must carry ("cooper" for The Cooper Union, "blueflame" for BlueFlame AI). */
export function mainToken(entity: string): string | undefined {
  const t = nameTokens(entity);
  const specific = t.filter((x) => !ORG_GENERIC.has(x));
  return [...(specific.length ? specific : t)].sort((a, b) => b.length - a.length)[0];
}

const hostOf = (u: string) => {
  try {
    return norm(new URL(u).hostname).replace(/^www\./, '');
  } catch {
    return '';
  }
};

function hay(img: Pick<ImageResult, 'title' | 'url' | 'thumb'> & { source?: string; credit?: string }): string[] {
  return tokens(`${img.title ?? ''} ${img.url ?? ''} ${img.thumb ?? ''} ${img.source ?? ''}`);
}

/** Token present as a word, or (5+ letters) inside a compound word such as a domain ("blueflameai"). */
const hit = (token: string, words: string[]) => words.includes(token) || (token.length >= 5 && words.some((w) => w.includes(token)));

/** Does this host belong to the entity (cooper.edu for The Cooper Union)? */
export function hostNames(entity: string, url: string): boolean {
  const main = mainToken(entity);
  if (!main) return false;
  return hit(main, tokens(hostOf(url).replace(/\./g, ' ')));
}

/** What a tile, stat or row may show, from its label/value/imageQuery. */
export function targetFor(label: string, value?: string, imageQuery?: string): PicTarget {
  const l = label.trim().replace(/[:：]$/, '');
  if (ATTR.test(l)) return { kind: 'none', entity: '' };
  if (ORG.test(l)) return value && value.trim() ? { kind: 'org', entity: value.trim() } : { kind: 'none', entity: '' };
  if (nameLike(l)) return { kind: 'named', entity: l };
  if (imageQuery && nameLike(imageQuery)) return { kind: 'named', entity: imageQuery };
  return { kind: 'none', entity: '' };
}

/** The gate. */
export function accepts(target: PicTarget, img: Pick<ImageResult, 'title' | 'url' | 'thumb'> & { source?: string }): boolean {
  if (target.kind === 'none' || !target.entity || !/^https:\/\//i.test(img.thumb)) return false;
  if (target.kind === 'org') {
    const main = mainToken(target.entity);
    if (!main) return false;
    // Official site or its CDN names the org; a knowledge/pool picture must name it in title AND host.
    return hostNames(target.entity, img.url) || hostNames(target.entity, img.thumb);
  }
  const need = nameTokens(target.entity);
  if (!need.length) return false;
  const words = hay(img);
  return need.slice(0, 3).every((t) => hit(t, words));
}

/** Looser check for galleries and card-level pictures: the subject's main token appears in the picture's title or URLs. */
export function mentions(entity: string, img: Pick<ImageResult, 'title' | 'url' | 'thumb'> & { source?: string }): boolean {
  const main = mainToken(entity);
  return !!main && /^https:\/\//i.test(img.thumb) && hit(main, hay(img));
}

/** The entity's own page text (title + snippet) names it: lets that page's og:image through. */
export function pageNames(target: PicTarget, page: { title?: string; snippet?: string; url: string }): boolean {
  if (target.kind === 'org') return hostNames(target.entity, page.url);
  if (target.kind !== 'named') return false;
  const words = tokens(`${page.title ?? ''} ${page.snippet ?? ''} ${page.url}`);
  return nameTokens(target.entity).slice(0, 3).every((t) => hit(t, words));
}

/** Card-level pictures (T436 boost, gallery/image refs): at least one of the subject's significant words (4+ letters) is in the picture. */
export function mentionsAny(subject: string, img: Pick<ImageResult, 'title' | 'url' | 'thumb'> & { source?: string }): boolean {
  if (!/^https:\/\//i.test(img.thumb)) return false;
  const words = hay(img);
  return nameTokens(subject).concat(tokens(subject).filter((t) => t.length >= 4 && !STOP.has(t))).some((t) => t.length >= 3 && hit(t, words));
}

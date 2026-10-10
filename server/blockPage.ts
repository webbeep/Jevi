/**
 * What a site serves a bot it refuses: an IP ban, a CAPTCHA, a robots.txt notice, a "checking your
 * browser" wall. Read as page text it becomes the answer ("Your IP address … has been blocked").
 * Only the opening is checked, and only on short pages, so an article about robots.txt still reads.
 */
const BLOCK = /\byour ip(?: address)?\b.{0,60}\b(?:has been|is|was) (?:blocked|banned)|\b(?:automated|unusual) (?:fetches|requests|queries|traffic)\b|\bviolation of robots\.txt\b|\bverify (?:that )?you are (?:a )?human\b|\bare you a robot\b|\bcaptcha\b|\benable (?:javascript and )?cookies to continue\b|\bchecking (?:if the site connection is secure|your browser)\b|\battention required!? \| cloudflare\b|\bjust a moment\.\.\.|\baccess (?:to this page has been )?denied\b|\brequest (?:was )?blocked\b|\b403 forbidden\b/i;

export function isBlockPage(text: string): boolean {
  return text.length < 4000 && BLOCK.test(text.slice(0, 800));
}

/** Hosts that ban automated reads outright (robots.txt): their search snippet is all we use. */
const NO_READ = /(^|\.)(eprint\.iacr\.org|scholar\.google\.[a-z.]+|openreview\.net)$/i;

/** Hosts that answered with a block page, for the life of this worker: asking again only renews the ban. */
const banned = new Set<string>();

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const readable = (url: string) => {
  const host = hostOf(url);
  return !!host && !NO_READ.test(host) && !banned.has(host);
};

export const rememberBlocked = (url: string) => {
  const host = hostOf(url);
  if (host) banned.add(host);
};

const BIBTEX = /@?\b(?:misc|article|inproceedings|incollection|book|techreport|phdthesis|unpublished)\s*\{\s*[^,\s]+,\s*/i;
const field = (text: string, name: string) => text.match(new RegExp(`\\b${name}\\s*=\\s*[{"]([^}"]+)`, 'i'))?.[1]?.replace(/\s+/g, ' ').trim();

/** A citation pasted as BibTeX ("misc{cryptoeprint:2026/2326, author = {…}, title = {…}") reads as "“Title” by authors". */
export function tidyBibtex(text: string): string {
  const at = text.search(BIBTEX);
  if (at < 0) return text;
  const entry = text.slice(at);
  const title = field(entry, 'title');
  const author = field(entry, 'author')?.replace(/\s+and\s+/g, ', ').replace(/, ([^,]+)$/, ' and $1');
  if (!title) return text.slice(0, at).trim();
  return `${text.slice(0, at)}“${title}”${author ? ` by ${author}` : ''}.`.trim();
}

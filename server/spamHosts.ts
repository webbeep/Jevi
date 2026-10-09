/**
 * Adult/spam hosts always dropped from sources and images (QA GATE-2cce9c0).
 * Deterministic, zero network.
 */

const HOST_RE =
  /(^|\.)(multporn|pornhub|xvideos|xnxx|xhamster|onlyfans|chaturbate|spankbang|redtube|youporn|tube8|porn360|xnxxes|hqporner|eporner|gotporn|porn\.com|xxx|nsfw|adultvideo|sexvid)(\.|$)/i;

/** Adult words inside a host name ("pornozavr.net"); never "sex", which is in essex and sussex. */
const ADULT_IN_HOST = /porn|xxx|hentai|xvideo|camgirl/i;
/** Path/query tokens that mark an adult dump even on an unknown host. */
const PATH_RE = /\/(porn|xxx|nsfw|adult|sex|hentai|nude|naked)(\/|$)/i;

export function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

/** True when this URL must never appear as a source or picture. */
/**
 * Firebase `*.web.app` host with a random-looking subdomain (Lead: newlibraryjgza.web.app
 * on a serper-off probe). Named product hosts like `docs.web.app` are kept.
 */
export function isSpamWebApp(host: string): boolean {
  if (!host.endsWith('.web.app')) return false;
  const sub = host.slice(0, -'.web.app'.length);
  if (!sub || sub.includes('.')) return false; // multi-label (docs.foo.web.app) left alone
  // Lead serper-off spam: newlibraryjgza.web.app — long single label, no hyphen.
  if (!sub.includes('-') && sub.length >= 12) return true;
  // Shorter gibberish with digits (x7k9m2qp1ab).
  if (!sub.includes('-') && sub.length >= 8 && /\d/.test(sub)) return true;
  return false;
}

/** Game wikis / fandom / fiction dumps — fine as search hits, never choice seeds (GTA "San Andreas"). */
const FICTION_HOST =
  /(^|\.)(fandom\.com|wikia\.com|gamepedia\.com|giantbomb\.com|ign\.com\/wikis|nopixel|roblox|minecraft\.fandom|gta\.?wiki|wikipedia\.org\/wiki\/List_of)($|\/)/i;

export function isFictionHost(url: string): boolean {
  if (!url) return false;
  const host = hostOfUrl(url);
  if (host && /(?:^|\.)(fandom\.com|wikia\.com|gamepedia\.com|giantbomb\.com|nopixel\.wiki)$/i.test(host)) return true;
  if (/\bfandom\.com\b/i.test(url) || /\bwikia\.com\b/i.test(url)) return true;
  // Path markers for role-play / game character pages.
  if (/\/(?:wiki\/)?(?:Ray_Lee\/|characters?\/|npc\/)/i.test(url) && /fandom|nopixel|gta|roblox/i.test(url)) return true;
  return false;
}

export function isBlockedHost(url: string): boolean {
  if (!url) return false;
  const host = hostOfUrl(url);
  if (host && (HOST_RE.test(host) || ADULT_IN_HOST.test(host) || isSpamWebApp(host))) return true;
  try {
    const u = new URL(url);
    if (PATH_RE.test(u.pathname)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function dropBlocked<T extends { url: string }>(rows: readonly T[]): { kept: T[]; dropped: number } {
  const kept = rows.filter((r) => !isBlockedHost(r.url));
  return { kept, dropped: rows.length - kept.length };
}

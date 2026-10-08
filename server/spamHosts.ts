/**
 * Adult/spam hosts always dropped from sources and images (QA GATE-2cce9c0).
 * Deterministic, zero network.
 */

const HOST_RE =
  /(^|\.)(multporn|pornhub|xvideos|xnxx|xhamster|onlyfans|chaturbate|spankbang|redtube|youporn|tube8|porn360|xnxxes|hqporner|eporner|gotporn|porn\.com|xxx|nsfw|adultvideo|sexvid)(\.|$)/i;

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
export function isBlockedHost(url: string): boolean {
  if (!url) return false;
  const host = hostOfUrl(url);
  if (host && HOST_RE.test(host)) return true;
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

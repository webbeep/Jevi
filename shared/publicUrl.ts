/** The public host. Facebook replaces a shared link with og:url, so this is the only one. */
export const PUBLIC_ORIGIN = 'https://zo.fyi';

/**
 * A link someone can send. Path, query and hash stay; the host is always the public app,
 * so a share does not canonicalize to another domain.
 */
export function publicShareUrl(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return `${PUBLIC_ORIGIN}/`;
  }
  const next = new URL(`${url.pathname}${url.search}${url.hash}`, `${PUBLIC_ORIGIN}/`);
  if (next.pathname === '/' && !next.search && !next.hash) return `${PUBLIC_ORIGIN}/`;
  return next.toString();
}

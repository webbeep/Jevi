/**
 * One canonical host and no indexed search pages: www.zo.fyi moves to zo.fyi for good, and a shared search
 * ("/?q=…") is a thin copy of the homepage, so crawlers are told not to index it. Everything else passes through.
 */
export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === 'www.zo.fyi') {
    url.hostname = 'zo.fyi';
    return Response.redirect(url.toString(), 301);
  }
  const response = await next();
  if (url.pathname === '/' && url.searchParams.has('q')) {
    const marked = new Response(response.body, response);
    marked.headers.set('X-Robots-Tag', 'noindex');
    return marked;
  }
  return response;
};

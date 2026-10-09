import { suggestTypeahead } from '../../server/typeahead';
import { Env, json } from '../../server/util';

/** Prefix completions. Always 200 — an empty list means the client should fall back. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  const data = await suggestTypeahead(q, env);
  // Empty (timeout/provider error) results must not stick in the browser cache.
  return json(data, 200, { 'cache-control': data.suggestions.length ? 'public, max-age=3600' : 'no-store' });
};

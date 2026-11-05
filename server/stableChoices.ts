import type { CardNode } from '../shared/card';
import { normalizeAnswerQuery } from '../shared/answerKey';

/** How long a question keeps the choices it was first offered. */
const KEEP_S = 7 * 24 * 3600;

const keyFor = (query: string) => new Request(`https://choices.zo.internal/v1?q=${encodeURIComponent(normalizeAnswerQuery(query))}`);

function store(): Cache | null {
  return typeof caches !== 'undefined' && caches.default ? caches.default : null;
}

/**
 * The choices a question was offered before ("View as: Full process · Veto override · …"). The same question offers
 * the same choices, even when the rest of the card is written again.
 */
export async function keptChoices(query: string): Promise<CardNode | undefined> {
  const cache = store();
  if (!cache) return undefined;
  try {
    const hit = await cache.match(keyFor(query));
    if (!hit) return undefined;
    const node = (await hit.json()) as CardNode;
    return node?.type === 'choices' && node.options.length >= 2 ? node : undefined;
  } catch {
    return undefined;
  }
}

export function keepChoices(query: string, node: CardNode, waitUntil?: (promise: Promise<unknown>) => void): void {
  const cache = store();
  if (!cache || node.type !== 'choices' || node.options.length < 2) return;
  const put = cache
    .put(keyFor(query), new Response(JSON.stringify(node), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${KEEP_S}` } }))
    .catch(() => undefined);
  if (waitUntil) waitUntil(put);
}

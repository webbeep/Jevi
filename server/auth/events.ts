import type { Env } from '../util.ts';
import { json } from '../util.ts';
import { readCookie, verifyDevice } from './device.ts';
import { d1, sessionSecret } from './env.ts';
import { currentUser } from './session.ts';

export const EVENT_NAMES = [
  'landing_view',
  'first_ask',
  'gate_hit',
  'signin_start',
  'signin_ok',
  'value_prompt_click',
  'soft_prompt_dismiss',
  'onetap_shown',
  'onetap_ok',
  'try_free_clicked',
  'value_prompt_shown',
  'soft_prompt_shown',
  'search_submitted',
  'card_interacted',
  'followup_sent',
  'source_opened',
  'affiliate_clicked',
  'save_click',
  'unsave_click',
  'signout',
  'sync_toggle',
  'signin_error',
] as const;

/** Bodies larger than this are dropped with 204 and never written. */
export const EVENT_MAX_BYTES = 1024;

const drop = () => new Response(null, { status: 204 });

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const PII = /^(email|e-mail|ip|token|credential|password|secret|cookie|authorization|avatar|phone|google_sub|sub)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanProps);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && EMAIL.test(value)) return undefined;
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PII.test(k)) continue;
    const next = cleanProps(v);
    if (next !== undefined) out[k] = next;
  }
  return out;
}

export async function recordEvent(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get('content-length') || '');
  if (Number.isFinite(declared) && declared > EVENT_MAX_BYTES) return drop();
  const raw = await request.text();
  if (byteLength(raw) > EVENT_MAX_BYTES) return drop();
  let body: { name?: unknown; props?: unknown };
  try {
    body = JSON.parse(raw) as { name?: unknown; props?: unknown };
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') return drop();
  const name = typeof body.name === 'string' ? body.name : '';
  if (!EVENT_NAMES.includes(name as (typeof EVENT_NAMES)[number])) return drop();
  if (body.props !== undefined && (typeof body.props !== 'object' || body.props === null || Array.isArray(body.props))) {
    return json({ error: 'Invalid props' }, 400);
  }
  const db = d1(env);
  if (!db) return new Response(null, { status: 204 });
  const user = await currentUser(request, env);
  let subject: string | null = user && !user.anonymous ? `u:${user.id}` : null;
  if (!subject) {
    const secret = sessionSecret(env);
    const raw = readCookie(request.headers.get('cookie'), 'zo_dev');
    const id = secret && raw ? await verifyDevice(raw, secret) : null;
    subject = id ? `d:${id}` : null;
  }
  const props = body.props ? JSON.stringify(cleanProps(body.props)) : null;
  await db
    .prepare(`INSERT INTO events (id, name, props_json, created_at, subject_key) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(crypto.randomUUID(), name, props, new Date().toISOString(), subject)
    .run();
  return new Response(null, { status: 204 });
}

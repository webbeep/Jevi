import { d1 } from './auth/env';
import type { Env } from './util';
import { packHistorySources, type HistorySource } from '../shared/historyCard';
import { isFollowupSlug, publicAnswerFromFrames, shareCardFromFrames, type PublicAnswer, type ShareCard } from '../shared/publicPage';
import type { AnswerCard } from '../shared/card';

export interface StoredAnswer extends PublicAnswer {
  share?: ShareCard;
}

const CARD_MAX = 180_000;

function encodeShare(share: ShareCard): string | null {
  const packed = (card: ShareCard) => JSON.stringify({ v: 1, card: card.card, results: card.results, followups: card.followups });
  const full = packed(share);
  if (full.length <= CARD_MAX) return full;
  const slim = packed({ ...share, results: share.results.slice(0, 8), followups: share.followups.slice(0, 6) });
  if (slim.length <= CARD_MAX) return slim;
  const cardOnly = packed({ ...share, results: [], followups: [] });
  return cardOnly.length <= CARD_MAX ? cardOnly : null;
}

function parseShare(raw: string | null | undefined): ShareCard | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const row = parsed as { v?: unknown; card?: AnswerCard; results?: unknown; followups?: unknown };
  if (row.v !== 1 || !row.card || typeof row.card.title !== 'string' || !Array.isArray(row.card.body) || row.card.body.length === 0) return undefined;
  const results: HistorySource[] = packHistorySources(Array.isArray(row.results) ? row.results as { title?: string; url?: string }[] : []);
  const followups = Array.isArray(row.followups) ? row.followups.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
  return { card: row.card, results, followups };
}

export async function savePublicAnswer(env: Env, query: string, frames: readonly string[], slug?: string): Promise<void> {
  const db = d1(env);
  const page = publicAnswerFromFrames(query, frames, slug);
  if (!db || !page) return;
  const share = shareCardFromFrames(query, frames);
  const cardJson = share ? encodeShare(share) : null;
  const at = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO public_answers (slug, query, title, description, body, card_json, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(slug) DO UPDATE SET
           query = excluded.query,
           title = excluded.title,
           description = excluded.description,
           body = excluded.body,
           card_json = COALESCE(excluded.card_json, public_answers.card_json),
           updated_at = excluded.updated_at`,
      )
      .bind(page.slug, page.query, page.title, page.description, page.body, cardJson, at)
      .run();
  } catch {
    await db
      .prepare(
        `INSERT INTO public_answers (slug, query, title, description, body, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(slug) DO UPDATE SET query = excluded.query, title = excluded.title, description = excluded.description, body = excluded.body, updated_at = excluded.updated_at`,
      )
      .bind(page.slug, page.query, page.title, page.description, page.body, at)
      .run();
  }
}

export async function loadPublicAnswer(env: Env, slug: string): Promise<StoredAnswer | undefined> {
  const db = d1(env);
  if (!db || !/^[a-z0-9-]{4,80}$/.test(slug)) return undefined;
  type Row = PublicAnswer & { card_json?: string | null };
  const withCard = 'SELECT slug, query, title, description, body, card_json FROM public_answers WHERE slug = ?1';
  const plain = 'SELECT slug, query, title, description, body FROM public_answers WHERE slug = ?1';
  let row: Row | null;
  try {
    row = await db.prepare(withCard).bind(slug).first<Row>();
  } catch {
    row = await db.prepare(plain).bind(slug).first<Row>();
  }
  if (!row) return undefined;
  const share = parseShare(row.card_json);
  return { slug: row.slug, query: row.query, title: row.title, description: row.description, body: row.body, ...(share ? { share } : {}) };
}

export async function listPublicAnswers(env: Env, limit = 50): Promise<{ slug: string; title: string }[]> {
  const db = d1(env);
  if (!db) return [];
  // Shared follow-ups are pages for one conversation, not answers to list.
  const out = await db.prepare('SELECT slug, title FROM public_answers ORDER BY updated_at DESC LIMIT ?1').bind(limit * 3).all<{ slug: string; title: string }>();
  return (out.results ?? []).filter((row) => !isFollowupSlug(row.slug)).slice(0, limit);
}

import { d1 } from './auth/env';
import type { Env } from './util';
import { publicAnswerFromFrames, type PublicAnswer } from '../shared/publicPage';

export async function savePublicAnswer(env: Env, query: string, frames: readonly string[]): Promise<void> {
  const db = d1(env);
  const page = publicAnswerFromFrames(query, frames);
  if (!db || !page) return;
  await db
    .prepare(
      `INSERT INTO public_answers (slug, query, title, description, body, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(slug) DO UPDATE SET query = excluded.query, title = excluded.title, description = excluded.description, body = excluded.body, updated_at = excluded.updated_at`,
    )
    .bind(page.slug, page.query, page.title, page.description, page.body, new Date().toISOString())
    .run();
}

export async function loadPublicAnswer(env: Env, slug: string): Promise<PublicAnswer | undefined> {
  const db = d1(env);
  if (!db || !/^[a-z0-9-]{4,80}$/.test(slug)) return undefined;
  const row = await db.prepare('SELECT slug, query, title, description, body FROM public_answers WHERE slug = ?1').bind(slug).first<PublicAnswer>();
  return row ?? undefined;
}

export async function listPublicAnswers(env: Env, limit = 50): Promise<{ slug: string; title: string }[]> {
  const db = d1(env);
  if (!db) return [];
  const out = await db.prepare('SELECT slug, title FROM public_answers ORDER BY updated_at DESC LIMIT ?1').bind(limit).all<{ slug: string; title: string }>();
  return out.results ?? [];
}

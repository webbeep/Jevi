import type { Disambiguation } from './card';

type Option = Disambiguation['options'][number];

/** Raw field names, in one place: change here when Backend confirms the shape. */
const F = { list: 'choices', prompt: 'prompt', options: 'options', name: 'name', descriptor: 'descriptor', query: 'query' } as const;

/** A trimmed string of at most `max` characters, or undefined when there isn't one. */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  return s ? s.slice(0, max) : undefined;
}

/** One option, dropped when it has no usable name (extra fields like `id` are ignored). */
function option(value: unknown): Option | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const name = text(raw[F.name], 80);
  if (!name) return undefined;
  const descriptor = text(raw[F.descriptor], 120);
  const query = text(raw[F.query], 200);
  return { name, ...(descriptor ? { descriptor } : {}), ...(query ? { query } : {}) };
}

/** Validates a `{ prompt, options }` pair; undefined when it can't be shown. */
function disambiguation(prompt: unknown, list: unknown): Disambiguation | undefined {
  if (!Array.isArray(list)) return undefined;
  const options = list.map(option).filter((o): o is Option => !!o).slice(0, 6);
  if (options.length < 2) return undefined;
  const ask = text(prompt, 80);
  return ask ? { prompt: ask, options } : { options };
}

/** The parts of one payload that may carry choices. */
function of(payload: unknown): { prompt?: unknown; options?: unknown } | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const raw = payload as Record<string, unknown>;
  // The draft `entity-choices` event sends {choices:[{name,descriptor,query,id},…]}: a bare options list, no prompt.
  if (Array.isArray(raw[F.list])) return { options: raw[F.list] };
  if (raw[F.list] && typeof raw[F.list] === 'object') {
    const inner = raw[F.list] as Record<string, unknown>;
    return { prompt: inner[F.prompt], options: inner[F.options] };
  }
  return Array.isArray(raw[F.options]) ? { prompt: raw[F.prompt], options: raw[F.options] } : undefined;
}

/**
 * First valid disambiguation among the given payloads (done event, card); undefined when none.
 * Max 6 options, trimmed strings.
 */
export function readChoices(...payloads: unknown[]): Disambiguation | undefined {
  for (const payload of payloads) {
    const parts = of(payload);
    const found = parts && disambiguation(parts.prompt, parts.options);
    if (found) return found;
  }
  return undefined;
}

/** The follow-up text for a picked option: its query, else "name (descriptor)", else name. */
export function choiceQuery(o: Option): string {
  const query = o.query?.trim();
  if (query) return query;
  const descriptor = o.descriptor?.trim();
  return descriptor ? `${o.name} (${descriptor})` : o.name;
}

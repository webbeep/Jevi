import type { AnswerCard, CardNode, Tone } from '../shared/card';

const TONES: Tone[] = ['default', 'muted', 'primary', 'positive', 'negative', 'warning'];
const MAX_DEPTH = 5;
const MAX_ITEMS = 12;

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 400): string | undefined => {
  if (typeof v === 'number') return String(v);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
};
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.-]/g, '')) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const tone = (v: unknown): Tone | undefined => (TONES.includes(v as Tone) ? (v as Tone) : undefined);
const oneOf = <const T extends string | number>(v: unknown, options: readonly T[]): T | undefined => (options.includes(v as T) ? (v as T) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
const strings = (v: unknown, max = 200): string[] => arr(v).map((x) => str(x, max)).filter((x): x is string => !!x);
const icon = (v: unknown): string | undefined => {
  const s = str(v, 40)?.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return s || undefined;
};

export function sanitizeNodes(raw: unknown, imageCount: number, depth = 0): CardNode[] {
  if (depth > MAX_DEPTH) return [];
  return arr(raw).map((n) => sanitizeNode(n, imageCount, depth)).filter((n): n is CardNode => !!n);
}

function sanitizeNode(raw: unknown, imageCount: number, depth: number): CardNode | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const n = raw as Raw;
  const kids = () => sanitizeNodes(n.children, imageCount, depth + 1);
  const ref = (v: unknown) => {
    const i = num(v);
    return i !== undefined && i >= 0 && i < imageCount ? Math.floor(i) : undefined;
  };
  const type = n.type as CardNode['type'];

  switch (type) {
    case 'stack': {
      const children = kids();
      return children.length ? { type, children, direction: oneOf(n.direction, ['row', 'col'] as const), gap: oneOf(n.gap, ['sm', 'md', 'lg'] as const), align: oneOf(n.align, ['start', 'center', 'end', 'between'] as const), wrap: n.wrap === true } : undefined;
    }
    case 'grid': {
      const children = kids();
      const cols = oneOf(num(n.cols), [2, 3, 4] as const) ?? 2;
      return children.length ? { type, cols, children, gap: oneOf(n.gap, ['sm', 'md', 'lg'] as const) } : undefined;
    }
    case 'section': {
      const children = kids();
      return children.length ? { type, children, title: str(n.title, 80), icon: icon(n.icon), tone: tone(n.tone) } : undefined;
    }
    case 'scroller': {
      const children = kids();
      return children.length ? { type, children } : undefined;
    }
    case 'tabs': {
      const tabs = arr(n.tabs)
        .map((t) => ({ label: str((t as Raw)?.label, 40) ?? '', children: sanitizeNodes((t as Raw)?.children, imageCount, depth + 1) }))
        .filter((t) => t.label && t.children.length);
      return tabs.length ? { type, tabs } : undefined;
    }
    case 'divider':
      return { type };
    case 'hero': {
      const value = str(n.value, 120);
      return value ? { type, value, unit: str(n.unit, 20), label: str(n.label, 80), caption: str(n.caption, 200), icon: icon(n.icon), tone: tone(n.tone) } : undefined;
    }
    case 'heading': {
      const text = str(n.text, 160);
      return text ? { type, text, eyebrow: str(n.eyebrow, 60), level: oneOf(num(n.level), [1, 2, 3] as const) } : undefined;
    }
    case 'text': {
      const text = str(n.text, 1200);
      return text ? { type, text, tone: tone(n.tone), size: oneOf(n.size, ['sm', 'md', 'lg'] as const) } : undefined;
    }
    case 'stat': {
      const label = str(n.label, 60);
      const value = str(n.value, 40);
      return label && value ? { type, label, value, unit: str(n.unit, 20), icon: icon(n.icon), delta: str(n.delta, 30), trend: oneOf(n.trend, ['up', 'down', 'flat'] as const) } : undefined;
    }
    case 'tile': {
      const label = str(n.label, 60);
      return label ? { type, label, value: str(n.value, 40), sub: str(n.sub, 80), icon: icon(n.icon), imageRef: ref(n.imageRef), imageQuery: str(n.imageQuery, 80), active: n.active === true } : undefined;
    }
    case 'keyvalue': {
      const items = arr(n.items).map((i) => ({ label: str((i as Raw)?.label, 60) ?? '', value: str((i as Raw)?.value, 160) ?? '', icon: icon((i as Raw)?.icon) })).filter((i) => i.label && i.value);
      return items.length ? { type, items } : undefined;
    }
    case 'list': {
      const items = arr(n.items)
        .map((i) => (typeof i === 'string' ? { text: i } : { text: str((i as Raw)?.text, 300) ?? '', icon: icon((i as Raw)?.icon), meta: str((i as Raw)?.meta, 60), imageRef: ref((i as Raw)?.imageRef), imageQuery: str((i as Raw)?.imageQuery, 80) }))
        .filter((i) => i.text);
      return items.length ? { type, items, style: oneOf(n.style, ['bullet', 'check', 'number', 'icon', 'media'] as const) } : undefined;
    }
    case 'chart': {
      const data = arr(n.data)
        .map((d) => ({ label: str((d as Raw)?.label, 24) ?? '', value: num((d as Raw)?.value) }))
        .filter((d): d is { label: string; value: number } => !!d.label && d.value !== undefined);
      return data.length >= 2 ? { type, data, kind: oneOf(n.kind, ['bar', 'hbar', 'line', 'area', 'pie'] as const) ?? 'bar', title: str(n.title, 80), unit: str(n.unit, 20) } : undefined;
    }
    case 'progress': {
      const label = str(n.label, 80);
      const value = num(n.value);
      return label && value !== undefined ? { type, label, value: Math.max(0, Math.min(100, value)), caption: str(n.caption, 80) } : undefined;
    }
    case 'rating': {
      const value = num(n.value);
      return value !== undefined ? { type, value, max: num(n.max) ?? 5, label: str(n.label, 60) } : undefined;
    }
    case 'table': {
      const columns = strings(n.columns, 40);
      const rows = arr(n.rows).map((r) => strings(r, 120)).filter((r) => r.length);
      return columns.length && rows.length ? { type, columns, rows, highlight: num(n.highlight) } : undefined;
    }
    case 'timeline': {
      const items = arr(n.items).map((i) => ({ when: str((i as Raw)?.when, 30) ?? '', title: str((i as Raw)?.title, 120) ?? '', text: str((i as Raw)?.text, 240) })).filter((i) => i.when && i.title);
      return items.length ? { type, items } : undefined;
    }
    case 'steps': {
      const items = arr(n.items).map((i) => (typeof i === 'string' ? { title: i } : { title: str((i as Raw)?.title, 120) ?? '', detail: str((i as Raw)?.detail, 300) })).filter((i) => i.title);
      return items.length ? { type, items } : undefined;
    }
    case 'proscons': {
      const pros = strings(n.pros);
      const cons = strings(n.cons);
      return pros.length || cons.length ? { type, pros, cons } : undefined;
    }
    case 'badges': {
      const items = strings(n.items, 40);
      return items.length ? { type, items } : undefined;
    }
    case 'quote': {
      const text = str(n.text, 400);
      return text ? { type, text, source: str(n.source, 80) } : undefined;
    }
    case 'callout': {
      const text = str(n.text, 400);
      return text ? { type, text, title: str(n.title, 80), tone: tone(n.tone), icon: icon(n.icon) } : undefined;
    }
    case 'image': {
      const r = ref(n.ref);
      const query = str(n.query, 80);
      return r !== undefined || query ? { type, ref: r, query: r === undefined ? query : undefined, caption: str(n.caption, 120), aspect: oneOf(n.aspect, ['wide', 'square', 'tall'] as const) } : undefined;
    }
    case 'gallery': {
      const refs = arr(n.refs).map(ref).filter((r): r is number => r !== undefined);
      const query = str(n.query, 80);
      return refs.length || query ? { type, refs, query: refs.length ? undefined : query } : undefined;
    }
    case 'profile': {
      const name = str(n.name, 100);
      const facts = arr(n.facts).map((f) => ({ label: str((f as Raw)?.label, 40) ?? '', value: str((f as Raw)?.value, 120) ?? '' })).filter((f) => f.label && f.value);
      return name ? { type, name, subtitle: str(n.subtitle, 120), imageRef: ref(n.imageRef), imageQuery: str(n.imageQuery, 80), facts } : undefined;
    }
    case 'actions': {
      const items = arr(n.items)
        .map((i) => ({ label: str((i as Raw)?.label, 40) ?? '', query: str((i as Raw)?.query, 200) ?? '', icon: icon((i as Raw)?.icon), kind: oneOf((i as Raw)?.kind, ['search', 'ask', 'refine'] as const) }))
        .filter((i) => i.label && i.query);
      return items.length ? { type, items } : undefined;
    }
    case 'choices': {
      const options = arr(n.options)
        .map((o) => ({ label: str((o as Raw)?.label, 40) ?? '', prompt: str((o as Raw)?.prompt, 200) ?? '', selected: (o as Raw)?.selected === true }))
        .filter((o) => o.label && o.prompt);
      return options.length >= 2 ? { type, options, label: str(n.label, 60) } : undefined;
    }
    case 'slider': {
      const label = str(n.label, 60);
      const prompt = str(n.prompt, 200);
      const min = num(n.min);
      const max = num(n.max);
      if (!label || !prompt?.includes('{value}') || min === undefined || max === undefined || max <= min) return undefined;
      const value = Math.min(max, Math.max(min, num(n.value) ?? min));
      return { type, label, prompt, min, max, value, step: num(n.step), unit: str(n.unit, 16) };
    }
    case 'scaler': {
      const label = str(n.label, 60);
      const base = num(n.base);
      const min = num(n.min);
      const max = num(n.max);
      const items = arr(n.items)
        .map((i) => ({ name: str((i as Raw)?.name, 80) ?? '', amount: num((i as Raw)?.amount), unit: str((i as Raw)?.unit, 20) }))
        .filter((i): i is { name: string; amount: number; unit: string | undefined } => !!i.name && i.amount !== undefined && i.amount > 0);
      if (!label || !base || base <= 0 || min === undefined || max === undefined || max <= min || !items.length) return undefined;
      const value = num(n.value);
      return { type, label, base, value: value === undefined ? undefined : Math.min(max, Math.max(min, value)), min, max, step: num(n.step), unit: str(n.unit, 20), items };
    }
    case 'accordion': {
      const items = arr(n.items).map((i) => ({ title: str((i as Raw)?.title, 120) ?? '', text: str((i as Raw)?.text, 800) ?? '' })).filter((i) => i.title && i.text);
      return items.length ? { type, items } : undefined;
    }
    case 'reveal': {
      const items = arr(n.items).map((i) => ({ front: str((i as Raw)?.front, 200) ?? '', back: str((i as Raw)?.back, 400) ?? '' })).filter((i) => i.front && i.back);
      return items.length ? { type, items } : undefined;
    }
    case 'citations': {
      const refs = arr(n.refs).map(num).filter((r): r is number => r !== undefined && r >= 1).slice(0, 8);
      return refs.length ? { type, refs } : undefined;
    }
    case 'slot':
      return undefined;
    default: {
      // Model output may contain types outside the grammar; they are dropped at runtime.
      const exhaustive: never = type;
      void exhaustive;
      return undefined;
    }
  }
}

export function sanitizeCard(raw: unknown, imageCount: number, fallbackTitle: string): AnswerCard {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  return {
    title: str(c.title, 120) ?? fallbackTitle,
    subtitle: str(c.subtitle, 160),
    icon: icon(c.icon),
    accent: tone(c.accent),
    body: sanitizeNodes(c.body, imageCount),
  };
}

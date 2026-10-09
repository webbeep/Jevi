import type { AnswerCard, CardNode } from './card';
import { priceText } from './ticker';

/** Plain text of a card for copying: title, subtitle, then every block; no markdown, no [n] markers, no URLs. */
export function cardPlainText(card: AnswerCard, results: { title: string }[] = []): string {
  const blocks: { text: string; verbatim?: boolean }[] = [];
  const walk = (n: CardNode) => {
    switch (n.type) {
      case 'hero':
        blocks.push({ text: `${n.label ? `${n.label}: ` : ''}${n.value}${n.unit ? ` ${n.unit}` : ''}${n.caption ? `\n${n.caption}` : ''}` });
        break;
      case 'heading':
      case 'text':
        blocks.push({ text: n.text });
        break;
      case 'stat':
        blocks.push({ text: `${n.label}: ${n.value}${n.unit ? ` ${n.unit}` : ''}${n.delta ? ` (${n.delta})` : ''}` });
        break;
      case 'tile':
        blocks.push({ text: `${n.label}${n.value ? `: ${n.value}` : ''}${n.sub ? ` — ${n.sub}` : ''}` });
        break;
      case 'keyvalue':
        blocks.push({ text: n.items.map((i) => `${i.label}: ${i.value}`).join('\n') });
        break;
      case 'list':
        blocks.push({ text: n.items.map((i, at) => `${n.style === 'number' ? `${at + 1}. ` : '- '}${i.text}${i.meta ? ` (${i.meta})` : ''}`).join('\n') });
        break;
      case 'links':
        blocks.push({ text: n.items.map((i) => `- ${i.label ?? results[i.source - 1]?.title ?? ''}`).filter((l) => l !== '- ').join('\n') });
        break;
      case 'video':
        if (n.caption) blocks.push({ text: n.caption });
        break;
      case 'chart':
        blocks.push({ text: [n.title, ...n.data.map((d) => `${d.label}: ${d.value}${n.unit ? ` ${n.unit}` : ''}`)].filter(Boolean).join('\n') });
        break;
      case 'progress':
        blocks.push({ text: `${n.label}: ${Math.round(n.value)}%${n.caption ? `\n${n.caption}` : ''}` });
        break;
      case 'rating':
        blocks.push({ text: `${n.label ? `${n.label}: ` : ''}${n.value}/${n.max ?? 5}` });
        break;
      case 'table':
        blocks.push({ text: [n.columns.some((c) => c.trim()) ? n.columns.filter((c) => c.trim()).join(' | ') : '', ...n.rows.map((r) => r.join(' | '))].filter(Boolean).join('\n') });
        break;
      case 'timeline':
        blocks.push({ text: n.items.map((i) => `${i.when} — ${i.title}${i.text ? `: ${i.text}` : ''}`).join('\n') });
        break;
      case 'steps':
        blocks.push({ text: n.items.map((i, at) => `${at + 1}. ${i.title}${i.detail ? ` — ${i.detail}` : ''}`).join('\n') });
        break;
      case 'proscons':
        blocks.push({ text: [n.pros.length ? `Pros:\n${n.pros.map((p) => `- ${p}`).join('\n')}` : '', n.cons.length ? `Cons:\n${n.cons.map((c) => `- ${c}`).join('\n')}` : ''].filter(Boolean).join('\n') });
        break;
      case 'badges':
        blocks.push({ text: n.items.join(', ') });
        break;
      case 'quote':
        blocks.push({ text: `"${n.text}"${n.source ? ` — ${n.source}` : ''}` });
        break;
      case 'callout':
        blocks.push({ text: `${n.title ? `${n.title}\n` : ''}${n.text}` });
        break;
      case 'draft':
        blocks.push({ text: `${n.label ? `${n.label}\n` : ''}${n.text}` });
        break;
      case 'code':
        blocks.push({ text: n.code, verbatim: true });
        break;
      case 'image':
        if (n.caption) blocks.push({ text: n.caption });
        break;
      case 'profile':
        blocks.push({ text: [`${n.name}${n.subtitle ? ` — ${n.subtitle}` : ''}`, ...(n.facts ?? []).map((f) => `${f.label}: ${f.value}`)].join('\n') });
        break;
      case 'choices':
        blocks.push({ text: `${n.label ? `${n.label}: ` : ''}${n.options.map((o) => o.label).join(' / ')}` });
        break;
      case 'slider':
        blocks.push({ text: `${n.label}: ${n.value}${n.unit ? ` ${n.unit}` : ''}` });
        break;
      case 'scaler':
        blocks.push({ text: `${n.label}: ${n.value ?? n.base}${n.unit ? ` ${n.unit}` : ''}` });
        break;
      case 'pricing':
        blocks.push({ text: [n.label, ...n.plans.map((p) => `${p.name}${p.note ? ` — ${p.note}` : ''}`)].filter(Boolean).join('\n') });
        break;
      case 'accordion':
        blocks.push({ text: n.items.map((i) => `${i.title}: ${i.text}`).join('\n') });
        break;
      case 'ticker':
        blocks.push({ text: `${n.name} (${n.symbol}): ${priceText(n.series.price)} ${n.kind === 'fx' ? '' : n.currency}`.trim() });
        break;
      case 'reveal':
        blocks.push({ text: n.items.map((i) => `${i.front}: ${i.back}`).join('\n') });
        break;
      case 'section':
        if (n.title) blocks.push({ text: n.title });
        n.children.forEach(walk);
        break;
      case 'tabs':
        n.tabs.forEach((t) => {
          blocks.push({ text: t.label });
          t.children.forEach(walk);
        });
        break;
      case 'gallery':
      case 'actions':
      case 'citations':
      case 'slot':
      case 'divider':
        break;
      default:
        if ('children' in n) n.children.forEach(walk);
    }
  };
  card.body.forEach(walk);
  const clean = (s: string) =>
    s
      .replace(/\s*\[\d+\]/g, '')
      .replace(/\*\*/g, '')
      .replace(/[ \t]+/g, ' ')
      .split('\n')
      .map((l) => l.trim())
      .join('\n');
  const body = blocks
    .filter((b) => b.text)
    .map((b) => (b.verbatim ? b.text : clean(b.text)))
    .filter((t) => t)
    .join('\n\n');
  return `${[card.title, card.subtitle].filter(Boolean).join('\n')}\n\n${body}`.replace(/\n{3,}/g, '\n\n').trim();
}

import type { AnswerCard, CardNode } from './card';

/** A compact summary of a card — title, headline values and key statements — for conversation context. */
export function cardDigest(card: AnswerCard, max = 420): string {
  const facts: string[] = [];
  const walk = (n: CardNode) => {
    if (facts.join('; ').length > max) return;
    switch (n.type) {
      case 'hero':
        facts.push(`${n.label ? `${n.label}: ` : ''}${n.value}${n.unit ?? ''}`);
        break;
      case 'stat':
        facts.push(`${n.label}: ${n.value}${n.unit ?? ''}`);
        break;
      case 'tile':
        if (n.value) facts.push(`${n.label}: ${n.value}`);
        break;
      case 'keyvalue':
        n.items.slice(0, 3).forEach((i) => facts.push(`${i.label}: ${i.value}`));
        break;
      case 'profile':
        facts.push(n.name + (n.subtitle ? ` (${n.subtitle})` : ''));
        break;
      case 'table':
        facts.push(`compares ${n.columns.filter(Boolean).join(' vs ')}`);
        break;
      case 'callout':
        facts.push(n.title ?? n.text.split(/(?<=[.!?])\s/)[0]);
        break;
      case 'text':
        facts.push(n.text.split(/(?<=[.!?])\s/)[0]);
        break;
      case 'steps':
        facts.push(`steps: ${n.items.slice(0, 4).map((i) => i.title).join(' → ')}`);
        break;
      case 'list':
        facts.push(n.items.slice(0, 4).map((i) => i.text).join(', '));
        break;
      case 'choices': {
        const picked = n.options.find((o) => o.selected);
        if (picked) facts.push(`${n.label ?? 'option'}: ${picked.label}`);
        break;
      }
      case 'slider':
      case 'scaler':
        facts.push(`${n.label}: ${n.value ?? (n.type === 'scaler' ? n.base : '')}${n.unit ? ` ${n.unit}` : ''}`);
        break;
      case 'draft':
        facts.push(`${n.label ?? 'draft'}: "${n.text.slice(0, Math.max(200, max / 2))}"`);
        break;
      case 'code':
        facts.push(`${n.lang ?? ''} code: ${n.code.slice(0, Math.max(160, max / 3))}`);
        break;
      case 'tabs':
        n.tabs.forEach((t) => t.children.forEach(walk));
        break;
      default:
        if ('children' in n) n.children.forEach(walk);
    }
  };
  card.body.forEach(walk);
  const text = `${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}${facts.length ? `. ${facts.join('; ')}` : ''}`.replace(/\[\d+\]/g, '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

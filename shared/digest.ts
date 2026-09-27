import type { AnswerCard, CardNode } from './card';

/** A one-to-two line summary of a card: its title and headline values, for conversation context. */
export function cardDigest(card: AnswerCard, max = 280): string {
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
        if (n.title) facts.push(n.title);
        break;
      default:
        if ('children' in n) n.children.forEach(walk);
    }
  };
  card.body.forEach(walk);
  const text = `${card.title}${card.subtitle ? ` — ${card.subtitle}` : ''}${facts.length ? `. ${facts.join('; ')}` : ''}`.replace(/\[\d+\]/g, '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

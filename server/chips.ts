import type { CardNode } from '../shared/card';

type Actions = Extract<CardNode, { type: 'actions' }>;
type Choices = Extract<CardNode, { type: 'choices' }>;

const FILLER = new Set(['the', 'and', 'for', 'his', 'her', 'their', 'its', 'with', 'about', 'more', 'show', 'see', 'view', 'open', 'all', 'from', 'this', 'that', 'what', 'how', 'who']);

const stem = (w: string) => w.replace(/(ies|es|s)$/, '');

/** A chip label's meaningful words, without the subject's own name (every chip about Ricky says Ricky). */
function words(label: string, subject: ReadonlySet<string>): Set<string> {
  return new Set(
    label.toLowerCase().split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !FILLER.has(w) && !subject.has(w))
      .map(stem),
  );
}

type Callout = Extract<CardNode, { type: 'callout' }>;

function calloutsIn(nodes: readonly CardNode[]): Callout[] {
  return nodes.flatMap((n): Callout[] => {
    if (n.type === 'callout') return [n];
    if (n.type === 'tabs') return n.tabs.flatMap((t) => calloutsIn(t.children));
    return 'children' in n && Array.isArray(n.children) ? calloutsIn(n.children) : [];
  });
}

const textWords = (text: string) => new Set(text.toLowerCase().replace(/\[\d+\]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 4).map(stem));

/**
 * A callout that says what one already on the card says. Regions are written in parallel, so a
 * "no recent news" finding otherwise opens the card, then returns in every region below it.
 */
export function repeatsCallout(node: CardNode, shown: readonly CardNode[]): boolean {
  if (node.type !== 'callout') return false;
  const own = textWords(`${node.title ?? ''} ${node.text}`);
  if (own.size < 3) return false;
  return calloutsIn(shown).some((c) => {
    const other = textWords(`${c.title ?? ''} ${c.text}`);
    const shared = [...own].filter((w) => other.has(w)).length;
    return shared / Math.min(own.size, other.size) >= 0.5;
  });
}

/** Every choices control in these nodes, including ones nested in layout nodes. */
export function choicesIn(nodes: readonly CardNode[]): Choices[] {
  return nodes.flatMap((n): Choices[] => {
    if (n.type === 'choices') return [n];
    if (n.type === 'tabs') return n.tabs.flatMap((t) => choicesIn(t.children));
    return 'children' in n && Array.isArray(n.children) ? choicesIn(n.children) : [];
  });
}

export function subjectWords(...texts: (string | undefined)[]): Set<string> {
  return new Set(texts.flatMap((t) => (t ?? '').toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3));
}

/** Two chips say the same thing when half the words of the shorter one appear in the other. */
function sameChip(a: Set<string>, b: Set<string>): boolean {
  if (!a.size || !b.size) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  const shared = [...small].filter((w) => big.has(w)).length;
  return shared * 2 >= small.size;
}

/**
 * The actions that offer something the choices control does not already offer
 * ("Rugby highlights" next to a "Rugby career" option is the same tap twice), and that don't repeat each other.
 * Undefined when nothing new is left.
 */
export function distinctActions(actions: Actions, choices: Choices[], subject: ReadonlySet<string>): Actions | undefined {
  const taken = choices.flatMap((c) => c.options.map((o) => words(o.label, subject)));
  const items = actions.items.filter((item) => {
    const own = words(item.label, subject);
    if (taken.some((t) => sameChip(own, t))) return false;
    taken.push(own);
    return true;
  });
  if (!items.length) return undefined;
  return items.length === actions.items.length ? actions : { ...actions, items };
}

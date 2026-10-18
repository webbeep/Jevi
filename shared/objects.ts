import type { CardNode } from './card';

const STOP = new Set(['the', 'and', 'with', 'for', 'vs', 'versus', 'from']);

function parts(name: string): string[] {
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 2 && !STOP.has(word));
}

/** The same object across turns. A different number is a different object. "Contax T2" is not "Contax T3". */
export function sameObject(a: string, b: string): boolean {
  const left = parts(a);
  const right = parts(b);
  if (!left.length || !right.length) return false;
  const marks = (list: string[]) => list.filter((word) => /\d/.test(word));
  const leftMarks = marks(left);
  const rightMarks = marks(right);
  if ((leftMarks.length > 0) !== (rightMarks.length > 0)) return false;
  if (leftMarks.length && !leftMarks.some((mark) => rightMarks.includes(mark))) return false;
  const words = (list: string[]) => list.filter((word) => !/\d/.test(word) && word.length >= 4);
  const leftWords = words(left);
  const rightWords = words(right);
  if (!leftWords.length || !rightWords.length) return leftMarks.length > 0 && leftMarks.some((mark) => rightMarks.includes(mark));
  const [shorter, longer] = leftWords.length <= rightWords.length ? [leftWords, rightWords] : [rightWords, leftWords];
  return shorter.every((word) => longer.includes(word));
}

export interface ThreadObject {
  id: string;
  name: string;
  facts: string[];
}

function take(objects: ThreadObject[], name: string): ThreadObject {
  const found = objects.find((item) => sameObject(item.name, name));
  if (found) return found;
  const next = { id: `o${objects.length + 1}`, name: name.trim(), facts: [] };
  objects.push(next);
  return next;
}

function note(object: ThreadObject, fact: string) {
  const text = fact.replace(/\s+/g, ' ').trim();
  if (!text || object.facts.includes(text) || object.facts.length >= 8) return;
  object.facts.push(text);
}

function walk(node: CardNode, objects: ThreadObject[]) {
  if (node.type === 'tile' && node.label.trim()) {
    const object = take(objects, node.label);
    if (node.value) note(object, node.value);
    if (node.sub) note(object, node.sub);
    if (node.imageSrc) note(object, `photo ${node.imageSrc}`);
  }
  if (node.type === 'table' && node.columns.length >= 2) {
    const width = Math.max(node.columns.length, ...node.rows.map((row) => row.length));
    const columns = [...Array(Math.max(0, width - node.columns.length)).fill(''), ...node.columns];
    columns.forEach((name, column) => {
      if (column === 0 || !String(name).trim()) return;
      const object = take(objects, String(name));
      for (const row of node.rows) {
        const factor = (row[0] ?? '').trim();
        const value = (row[column] ?? '').trim();
        if (factor && value) note(object, `${factor}: ${value}`);
      }
    });
  }
  if (node.type === 'profile' && node.name.trim()) note(take(objects, node.name), node.subtitle ?? node.name);
  if (node.type === 'tabs') node.tabs.forEach((tab) => tab.children.forEach((child) => walk(child, objects)));
  if ('children' in node && Array.isArray(node.children)) node.children.forEach((child) => walk(child, objects));
}

/** Stable ids in first-seen order. Later cards update an id instead of minting a second one for the same object. */
export function threadObjects(cards: readonly { body: readonly CardNode[] }[]): ThreadObject[] {
  const objects: ThreadObject[] = [];
  for (const card of cards) card.body.forEach((node) => walk(node, objects));
  return objects.filter((object) => object.facts.length > 0);
}

/** Model context: each object is named before its own facts. */
export function objectContext(cards: readonly { body: readonly CardNode[] }[]): string {
  const objects = threadObjects(cards);
  if (objects.length < 2) return '';
  return [
    'Objects already in this thread. Each id is stable. Identify the object before using a fact. A follow-up about these objects updates those ids. A follow-up that names a different object, or adds one, creates a new id. Do not copy one id\'s price, photo, spec, or citation onto another id.',
    ...objects.map((object) => `${object.id} ${object.name} — ${object.facts.join('; ')}`),
  ].join('\n');
}

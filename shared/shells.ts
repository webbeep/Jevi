import type { CardNode } from './card';
import { GAP_MARK } from './gap';

/** Nothing left but citation markers, dashes and punctuation ("[8]", " · ", "—"). */
function hollow(text: string | undefined): boolean {
  return !text || !text.replace(/\[\d+\]/g, '').replace(/[\s·•|,.;:()\-–—″"°%$€£¥]+/g, '');
}

const blankCell = (cell: string) => cell !== GAP_MARK && hollow(cell);

/** A value that says there is no value ("Unavailable", "None yet", "N/A"). */
const NON_ANSWER = /^(?:unavailable|not available|none(?: yet)?|n\/?a|tbd|tba|unknown|not (?:yet )?(?:stated|reported|listed|announced|found)|no data|pending)\.?$/i;
const saysNothing = (value: string | undefined) => hollow(value) || NON_ANSWER.test(value!.replace(/\[\d+\]/g, '').trim());

/**
 * What a component still says after its unsupported figures were removed. A table row with no values left,
 * a key with no value, a sentence that is only "[8]" and a subtitle that is only " · " are dropped, and a
 * single missing table cell reads "—". Undefined when nothing is left to show.
 */
export function withoutShells(node: CardNode): CardNode | undefined {
  switch (node.type) {
    case 'stack':
    case 'grid':
    case 'section':
    case 'scroller': {
      const children = node.children.map(withoutShells).filter((child): child is CardNode => !!child);
      if (children.length === node.children.length && children.every((child, i) => child === node.children[i])) return node;
      return children.length ? { ...node, children } : undefined;
    }
    case 'text':
    case 'callout':
      return hollow(node.text) ? undefined : node;
    case 'keyvalue': {
      const items = node.items.filter((item) => !saysNothing(item.value));
      if (items.length === node.items.length) return node;
      return items.length ? { ...node, items } : undefined;
    }
    case 'table': {
      const rows = node.rows
        .filter((row) => row.length < 2 || row.slice(1).some((cell) => !blankCell(cell)))
        .map((row) => (row.slice(1).some(blankCell) ? [row[0]!, ...row.slice(1).map((cell) => (blankCell(cell) ? '—' : cell))] : row));
      if (rows.length === node.rows.length && rows.every((row, i) => row === node.rows[i])) return node;
      return rows.length ? { ...node, rows } : undefined;
    }
    case 'tile':
      // A tile whose figure is "Unavailable" fills a row with nothing; a tile with no value at all is a name and stays.
      if (node.value !== undefined && node.value.trim() && NON_ANSWER.test(node.value.replace(/\[\d+\]/g, '').trim())) return undefined;
      return node.sub !== undefined && hollow(node.sub) ? { ...node, sub: undefined } : node;
    default:
      return node;
  }
}

import { acceptDiagram, diagramIntent, diagramNeedsRetry, diagramsEnabled, type DiagramCard } from '../shared/diagram';
import { llmJson } from './llm';
import type { Env } from './util';

const SYSTEM = `You name the parts of one mechanism as JSON. Each label is a part or a step the sources describe, such as token, attention, or decoder. Never an article section: Introduction, Overview, Training, Architecture, Limitations, Applications, Key Innovation, History, or Summary. The detail sentence must mention that same part. If the sources do not explain how it works, return {"type":"diagram","nodes":[]}. No markdown, no HTML, no Mermaid, no SVG.`;

/**
 * One small diagram for a visualize / explain-how / diagram question.
 * Returns nothing when the flag is off, the question is not a diagram, the model
 * is unavailable, or the stages are not in the sources. The rest of the card still stands.
 */
export async function requestDiagram(env: Env, question: string, corpus: string): Promise<DiagramCard | undefined> {
  if (!diagramsEnabled(env.ZO_DIAGRAMS)) return undefined;
  const kind = diagramIntent(question);
  if (!kind || !corpus.trim()) return undefined;
  const user = [
    `QUESTION: ${question}`,
    `KIND: ${kind}`,
    kind === 'flow'
      ? 'This is a flow. Order the stages from first to last.'
      : 'This is a concept. Name the parts in the order a newcomer should meet them.',
    'Return one JSON object and nothing else:',
    `{"type":"diagram","kind":"${kind}","title":"2-6 words","nodes":[{"id":"a","label":"1-4 words that appear in the sources or the question","detail":"one sentence from the sources"}],"edges":[{"from":"a","to":"b"}]}`,
    'Use 3 to 6 nodes. Every label is a part or a step copied from the sources or the question, not a section heading. If you cannot name three real parts, return "nodes":[].',
    '',
    'SOURCES',
    corpus.slice(0, 6000),
  ].join('\n');
  try {
    const raw = await llmJson<unknown>(env, SYSTEM, user, 700);
    const card = acceptDiagram(raw, corpus, kind);
    if (!diagramNeedsRetry(raw, card)) return card;
    const again = await llmJson<unknown>(env, SYSTEM, `${user}\n\nYour labels were article sections or were not parts the sources describe. Name 3 to 6 parts of the mechanism, or return {"type":"diagram","nodes":[]}.`, 700);
    return acceptDiagram(again, corpus, kind);
  } catch (err) {
    console.error('diagram skipped', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

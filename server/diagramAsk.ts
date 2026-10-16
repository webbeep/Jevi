import { acceptDiagram, diagramIntent, diagramIsLine, diagramNeedsRetry, diagramsEnabled, type DiagramCard } from '../shared/diagram';
import { llmJson } from './llm';
import type { Env } from './util';

const SYSTEM = `You name the parts of one mechanism as JSON, and you connect them with edges. A split has two outgoing edges. A join has two incoming edges. Use one straight line only when nothing splits or joins. A single column of names is not a diagram of how the parts work together. Each label is a part or a step the sources describe, such as token, query, key, value, or attention. Never an article section: Introduction, Overview, Training, Architecture, Limitations, Applications, Key Innovation, History, or Summary. The detail sentence must mention that same part and say what it does. If the sources do not explain how it works, return {"type":"diagram","nodes":[]}. No markdown, no HTML, no Mermaid, no SVG.`;

const SECTION_NUDGE = 'Your labels were article sections or were not parts the sources describe. Name 3 to 6 parts of the mechanism. If one part splits into parts that work together, give it two or three outgoing edges. If two parts meet, point both at the next part. If you cannot name three real parts, return {"type":"diagram","nodes":[]}.';

const BRANCH_NUDGE = 'That graph is one straight line of names, which does not show how the parts work together. If the sources describe parts that happen together, split them: two or three outgoing edges from the shared part, and two incoming edges where they meet again. Example shape when the sources support it: token to query, token to key, token to value, and query, key, and value to attention. Every label must be words from the sources or the question. Do not invent parts. If nothing really splits or joins, return {"type":"diagram","nodes":[]}.';

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
      ? 'This is a flow. Connect each step to the step that follows. If one step divides, give it two outgoing edges. If two steps meet, point both at the next step. Do not leave a process that splits as one column.'
      : 'This is a concept. Link each part to the parts it feeds or depends on. Draw a split or a join when the sources describe parts that work at the same time. Do not force every part into one line.',
    'Return one JSON object and nothing else:',
    `{"type":"diagram","kind":"${kind}","title":"2-6 words","nodes":[{"id":"a","label":"1-4 words that appear in the sources or the question","detail":"one sentence from the sources"}],"edges":[{"from":"a","to":"b"},{"from":"a","to":"c"},{"from":"b","to":"d"},{"from":"c","to":"d"}]}`,
    'Use 3 to 6 nodes. Every node id appears in at least one edge. Every label is a part or a step copied from the sources or the question, not a section heading. If you cannot name three real parts, return "nodes":[].',
    '',
    'SOURCES',
    corpus.slice(0, 6000),
  ].join('\n');
  try {
    const raw = await llmJson<unknown>(env, SYSTEM, user, 900);
    let card = acceptDiagram(raw, corpus, kind);
    if (!card && diagramNeedsRetry(raw, card)) {
      const again = await llmJson<unknown>(env, SYSTEM, `${user}\n\n${SECTION_NUDGE}`, 900);
      return acceptDiagram(again, corpus, kind);
    }
    if (card && diagramIsLine(card)) {
      try {
        const again = await llmJson<unknown>(env, SYSTEM, `${user}\n\n${BRANCH_NUDGE}`, 900);
        const branched = acceptDiagram(again, corpus, kind);
        if (branched && !diagramIsLine(branched)) return branched;
      } catch (err) {
        console.error('diagram branch skipped', err instanceof Error ? err.message : String(err));
      }
    }
    return card;
  } catch (err) {
    console.error('diagram skipped', err instanceof Error ? err.message : String(err));
    return undefined;
  }
}

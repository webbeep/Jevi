import { useEffect, useRef, useState } from 'react';
import type { CardNode } from '../../shared/card';
import { DIAGRAM_SANDBOX, diagramDocument, diagramFrameHeight, diagramSelectionText } from '../../shared/diagram';

type DiagramNode = Extract<CardNode, { type: 'diagram' }>;

/** The graphic for a diagram node. The frame draws the boxes. The sentence sits under it, in the page, so the frame cannot cut it off. */
export function DiagramView({ node }: { node: DiagramNode }) {
  const frame = useRef<HTMLElement>(null);
  const pane = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(340);
  const [selected, setSelected] = useState(0);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const diagramKey = `${node.kind}|${node.title ?? ''}|${node.nodes.map((step) => `${step.id}:${step.label}:${step.detail ?? ''}`).join('|')}`;
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    const theme = new MutationObserver(sync);
    theme.observe(root, { attributes: true, attributeFilter: ['class'] });
    const el = frame.current;
    const measure = () => {
      const next = el?.clientWidth ?? 0;
      if (next >= 260) setWidth(Math.round(next));
    };
    measure();
    const size = new ResizeObserver(measure);
    if (el) size.observe(el);
    return () => {
      theme.disconnect();
      size.disconnect();
    };
  }, []);
  useEffect(() => {
    setSelected(0);
  }, [diagramKey, dark, width]);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== pane.current?.contentWindow) return;
      const data = event.data as { type?: unknown; i?: unknown } | null;
      if (!data || data.type !== 'zo-diagram' || typeof data.i !== 'number') return;
      if (!Number.isInteger(data.i) || data.i < 0 || data.i >= node.nodes.length) return;
      setSelected(data.i);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [node.nodes.length]);
  const caption = diagramSelectionText(node, selected);
  return (
    <figure ref={frame} className="overflow-hidden rounded-xl border bg-card">
      {node.title ? <h2 className="px-5 pt-4 text-center text-[13px] font-semibold leading-snug text-pretty">{node.title}</h2> : null}
      <iframe
        ref={pane}
        title={node.title || 'Diagram'}
        sandbox={DIAGRAM_SANDBOX}
        srcDoc={diagramDocument(node, dark, width)}
        referrerPolicy="no-referrer"
        scrolling="no"
        style={{ height: diagramFrameHeight(node, width) }}
        className="block w-full border-0 bg-transparent"
      />
      {caption ? (
        <p className="px-5 pb-4 pt-1 text-center text-[13px] leading-relaxed text-pretty text-muted-foreground [overflow-wrap:anywhere]">{caption}</p>
      ) : null}
    </figure>
  );
}

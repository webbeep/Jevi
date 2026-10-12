import { useEffect, useRef, useState } from 'react';
import type { CardNode } from '../../shared/card';
import { DIAGRAM_SANDBOX, diagramDocument, diagramFrameHeight } from '../../shared/diagram';

type DiagramNode = Extract<CardNode, { type: 'diagram' }>;

/** The graphic for a diagram node. The frame draws the boxes and cannot read the page. */
export function DiagramView({ node }: { node: DiagramNode }) {
  const frame = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(340);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
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
  return (
    <figure ref={frame} className="overflow-hidden rounded-xl border bg-card">
      <iframe
        title={node.title || 'Diagram'}
        sandbox={DIAGRAM_SANDBOX}
        srcDoc={diagramDocument(node, dark, width)}
        referrerPolicy="no-referrer"
        scrolling="no"
        style={{ height: diagramFrameHeight(node, width) }}
        className="block w-full border-0 bg-transparent"
      />
    </figure>
  );
}

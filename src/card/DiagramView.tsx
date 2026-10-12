import { useEffect, useState } from 'react';
import type { CardNode } from '../../shared/card';
import { DIAGRAM_SANDBOX, diagramDocument, diagramHeight } from '../../shared/diagram';

type DiagramNode = Extract<CardNode, { type: 'diagram' }>;

/** The graphic for a diagram node. The frame can run the step buttons and cannot read the page. */
export function DiagramView({ node }: { node: DiagramNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains('dark'));
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return (
    <figure className="overflow-hidden rounded-xl border bg-card">
      <iframe
        title={node.title || 'Diagram'}
        sandbox={DIAGRAM_SANDBOX}
        srcDoc={diagramDocument(node, dark)}
        referrerPolicy="no-referrer"
        style={{ height: diagramHeight(node.nodes.length) }}
        className="block w-full border-0 bg-transparent"
      />
    </figure>
  );
}

import { Fragment, type ReactNode } from 'react';
import { useCard } from './context';

/** Renders **bold** and [n] citations that link to the nth search result. */
export function RichText({ text, inline = false }: { text: string; inline?: boolean }) {
  const { results } = useCard();
  const Para = inline ? 'span' : 'p';
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        <Para key={p} className={inline ? undefined : '[&:not(:first-child)]:mt-2'}>
          {para.split(/(\*\*[^*]+\*\*|\[\d+\])/g).map((part, i): ReactNode => {
            const bold = part.match(/^\*\*(.+)\*\*$/);
            if (bold) return <strong key={i} className="font-semibold text-foreground">{bold[1]}</strong>;
            const cite = part.match(/^\[(\d+)\]$/);
            if (cite) {
              const r = results[Number(cite[1]) - 1];
              return r ? (
                <a key={i} href={r.url} target="_blank" rel="noreferrer" title={r.title} className="mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-sm bg-muted px-1 align-middle text-[10px] font-medium text-muted-foreground no-underline transition-colors hover:bg-foreground hover:text-background">
                  {cite[1]}
                </a>
              ) : null;
            }
            return <Fragment key={i}>{part}</Fragment>;
          })}
        </Para>
      ))}
    </>
  );
}

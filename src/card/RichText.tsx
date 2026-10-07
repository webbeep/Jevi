import { Fragment, type ReactNode } from 'react';
import { useCard } from './context';

const CITE = "mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-sm bg-muted px-1 align-middle text-[10px] font-medium text-muted-foreground no-underline relative after:absolute after:-inset-y-[14px] after:content-['']";

/**
 * Renders **bold** and [n] citations that link to the nth search result.
 * Inside buttons pass `noLinks`: links can't nest in interactive elements, so citations become plain badges.
 */
export function RichText({ text, inline = false, noLinks = false }: { text: string; inline?: boolean; noLinks?: boolean }) {
  const { results } = useCard();
  const Para = inline ? 'span' : 'p';
  const citeOk = (s: string | undefined) => {
    const m = s?.match(/^\[(\d+)\]$/);
    return !!m && !!results[Number(m[1]) - 1];
  };
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => {
        const parts = para.split(/(\*\*[^*]+\*\*|\[\d+\])/g);
        return (
          <Para key={p} className={inline ? undefined : '[&:not(:first-child)]:mt-2'}>
            {parts.map((part, i): ReactNode => {
              const bold = part.match(/^\*\*(.+)\*\*$/);
              if (bold) return <strong key={i} className="font-semibold text-foreground">{bold[1]}</strong>;
              const cite = part.match(/^\[(\d+)\]$/);
              if (cite) {
                const r = results[Number(cite[1]) - 1];
                if (!r) return null;
                const l = !parts[i - 1]?.trim() && citeOk(parts[i - 2]) ? 'after:-left-0.5' : 'after:-left-[14px]';
                const right = !parts[i + 1]?.trim() && citeOk(parts[i + 2]) ? 'after:-right-0.5' : 'after:-right-[14px]';
                const cls = `${CITE} ${l} ${right}`;
                if (noLinks) return <span key={i} title={r.title} className={cls}>{cite[1]}</span>;
                return (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" title={r.title} className={`${cls} transition-colors hover:bg-foreground hover:text-background`}>
                    {cite[1]}
                  </a>
                );
              }
              return <Fragment key={i}>{part}</Fragment>;
            })}
          </Para>
        );
      })}
    </>
  );
}

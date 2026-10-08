import { Fragment, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SearchResult } from '../../shared/types';
import { useCard } from './context';

const CITE = "mx-0.5 inline-flex h-4 min-w-4 -translate-y-px items-center justify-center rounded-sm bg-muted px-1 align-middle text-[10px] font-medium text-muted-foreground no-underline relative after:absolute after:-inset-[14px] after:content-['']";
const HOVER = 'transition-colors hover:bg-foreground hover:text-background';
const domainLabel = (d: string) => d.replace(/^(www|en|m)\./, '');

type Cite = { n: number; result: SearchResult };

function readCite(part: string | undefined, results: SearchResult[]): Cite | null {
  const m = part?.match(/^\[(\d+)\]$/);
  if (!m) return null;
  const n = Number(m[1]);
  const result = results[n - 1];
  return result ? { n, result } : null;
}

/** `6–8` when three or more numbers ascend with no gaps; otherwise `4,5`. */
function citeLabel(nums: number[]) {
  const consecutive = nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  return consecutive ? `${nums[0]}–${nums[nums.length - 1]}` : nums.join(',');
}

function sourcesLabel(nums: number[]) {
  if (nums.length === 2) return `Sources ${nums[0]} and ${nums[1]}`;
  return `Sources ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]}`;
}

function CiteRun({ cites, noLinks }: { cites: Cite[]; noLinks: boolean }) {
  const { n, result: r } = cites[0];
  if (cites.length === 1) {
    if (noLinks) return <span title={r.title} className={CITE}>{n}</span>;
    return (
      <a href={r.url} target="_blank" rel="noreferrer" title={r.title} className={`${CITE} ${HOVER}`}>
        {n}
      </a>
    );
  }
  const nums = cites.map((c) => c.n);
  const label = citeLabel(nums);
  const aria = sourcesLabel(nums);
  if (noLinks) {
    return <span title={cites.map((c) => c.result.title).join(' · ')} aria-label={aria} className={CITE}>{label}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={aria} className={`${CITE} cursor-pointer ${HOVER} data-[state=open]:bg-foreground data-[state=open]:text-background`}>
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={8}
        className="w-72 max-w-[calc(100vw-1rem)]"
      >
        {cites.map((c) => (
          <DropdownMenuItem key={c.n} asChild className="min-h-11">
            <a href={c.result.url} target="_blank" rel="noreferrer">
              <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-muted px-1 text-[10px] font-medium text-muted-foreground">{c.n}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{c.result.title}</span>
                <span className="truncate text-xs text-muted-foreground">{domainLabel(c.result.domain)}</span>
              </span>
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function renderParts(parts: string[], results: SearchResult[], noLinks: boolean): ReactNode[] {
  const isSep = (s: string) => /^\s*[,;]?\s*$/.test(s);
  const out: ReactNode[] = [];
  let i = 0;
  while (i < parts.length) {
    const part = parts[i];
    const bold = part.match(/^\*\*(.+)\*\*$/);
    if (bold) {
      out.push(<strong key={i} className="font-semibold text-foreground">{bold[1]}</strong>);
      i++;
      continue;
    }
    if (/^\[\d+\]$/.test(part)) {
      const hit = readCite(part, results);
      if (!hit) {
        i++;
        continue;
      }
      const cites: Cite[] = [hit];
      const seen = new Set([hit.n]);
      let j = i + 1;
      while (j < parts.length && isSep(parts[j])) {
        let k = j;
        while (k < parts.length && isSep(parts[k])) k++;
        const next = readCite(parts[k], results);
        if (!next) break;
        if (!seen.has(next.n)) {
          seen.add(next.n);
          cites.push(next);
        }
        j = k + 1;
      }
      out.push(<CiteRun key={i} cites={cites} noLinks={noLinks} />);
      i = j;
      continue;
    }
    out.push(<Fragment key={i}>{part}</Fragment>);
    i++;
  }
  return out;
}

/**
 * Renders **bold** and [n] citations that link to the nth search result.
 * Neighbouring citations merge into one chip across whitespace or `, ` / `; `. Inside buttons pass `noLinks`:
 * links can't nest in interactive elements, so citations become plain badges.
 */
export function RichText({ text, inline = false, noLinks = false }: { text: string; inline?: boolean; noLinks?: boolean }) {
  const { results } = useCard();
  const Para = inline ? 'span' : 'p';
  return (
    <>
      {text.split(/\n{2,}/).map((para, p) => (
        <Para key={p} className={inline ? undefined : '[&:not(:first-child)]:mt-2'}>
          {renderParts(para.split(/(\*\*[^*]+\*\*|\[\d+\])/g), results, noLinks)}
        </Para>
      ))}
    </>
  );
}

import { useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, HelpCircle } from 'lucide-react';
import type { Disambiguation } from '../../shared/card';
import { choiceQuery } from '../../shared/choices';

const OTHER = -1;

/**
 * "Which one?" — provisional list of options for a name the answer is unsure about
 * (T444). Picking one sends a follow-up search and locks the list. "None of these" asks for
 * a detail (company, school, city) and searches the name with it.
 */
export function WhichOne({ choices, onPick }: { choices: Disambiguation; onPick: (text: string) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [other, setOther] = useState(false);
  const [detail, setDetail] = useState('');
  const sent = useRef(false);
  const name = choices.options[0]?.name ?? '';
  const send = (index: number, text: string) => {
    if (sent.current) return;
    sent.current = true;
    setPicked(index);
    onPick(text);
  };
  const submitOther = () => {
    const extra = detail.trim();
    if (extra) send(OTHER, `${name} ${extra}`.trim());
  };
  return (
    <section aria-label={choices.prompt ?? 'Which one?'} className="space-y-2 animate-in fade-in">
      <h3 className="zo-label">{choices.prompt ?? 'Which one?'}</h3>
      <ul role="list" className="space-y-1.5">
        {choices.options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              disabled={picked !== null}
              aria-pressed={picked === i}
              aria-label={`Choose ${o.name}${o.descriptor ? `, ${o.descriptor}` : ''}`}
              onClick={() => send(i, choiceQuery(o))}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-default disabled:opacity-60 aria-pressed:opacity-100 aria-pressed:border-foreground/30 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="block text-sm font-semibold leading-snug text-pretty [overflow-wrap:anywhere] line-clamp-2">{o.name}</span>
                {o.descriptor && <span className="block text-[13px] leading-snug text-muted-foreground text-pretty [overflow-wrap:anywhere] line-clamp-3">{o.descriptor}</span>}
              </span>
              {picked === i ? <Check className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            </button>
          </li>
        ))}
        <li>
          {other ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitOther();
              }}
              className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed bg-card py-1.5 pl-3.5 pr-1.5 animate-in fade-in"
            >
              <label className="sr-only" htmlFor="which-one-detail">{`Which ${name}? Add a detail`}</label>
              <input
                id="which-one-detail"
                autoFocus
                value={detail}
                disabled={picked !== null}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Company, school, city or role…"
                enterKeyHint="search"
                className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
              />
              <button
                type="submit"
                aria-label={`Search ${name} with this detail`}
                disabled={!detail.trim() || picked !== null}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:opacity-30"
              >
                {picked === OTHER ? <Check className="size-4" /> : <ArrowUp className="size-4" />}
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={picked !== null}
              onClick={() => setOther(true)}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-dashed px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.03] hover:text-foreground disabled:cursor-default disabled:opacity-60 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <HelpCircle className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">None of these</span>
            </button>
          )}
        </li>
      </ul>
    </section>
  );
}

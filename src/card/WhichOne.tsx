import { useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { Disambiguation } from '../../shared/card';
import { choiceQuery } from '../../shared/choices';

/**
 * "Which one?" — provisional list of options for a name the answer is unsure about
 * (T444). Picking one sends a follow-up search and locks the list.
 */
export function WhichOne({ choices, onPick }: { choices: Disambiguation; onPick: (text: string) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const sent = useRef(false);
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
              onClick={() => {
                if (sent.current) return;
                sent.current = true;
                setPicked(i);
                onPick(choiceQuery(o));
              }}
              className="flex min-h-11 w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.03] disabled:cursor-default disabled:opacity-60 aria-pressed:opacity-100 aria-pressed:border-foreground/30 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-snug">{o.name}</span>
                {o.descriptor && <span className="block text-[13px] leading-snug text-muted-foreground">{o.descriptor}</span>}
              </span>
              {picked === i ? <Check className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

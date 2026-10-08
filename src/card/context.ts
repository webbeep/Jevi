import { createContext, useContext } from 'react';
import type { AskRef } from '../../shared/askAbout';
import type { ImageResult, SearchResult } from '../../shared/types';

export interface CardContextValue {
  results: SearchResult[];
  images: ImageResult[];
  /** What the card is about, so a tapped item asks about it in context. */
  entity?: string;
  /** Attribution by picture URL, shown on hover and in the card's credits. */
  credits: Record<string, { credit: string; link: string }>;
  /** True while this card is being (re)designed; interactive controls pause. */
  busy: boolean;
  onSearch: (query: string) => void;
  onAsk: (question: string) => void;
  onRefine: (instruction: string) => void;
  /** Opens the source list narrowed to what this card cites. */
  onSources: () => void;
  /** Puts text in the follow-up box and focuses it, without sending. */
  onDraft: (text: string) => void;
  /** t447: a tapped item/row/tile sends its follow-up right away, with the box it came from (ignored while a request streams). */
  onItem: (question: string, ref?: AskRef) => void;
}

export const CardContext = createContext<CardContextValue>({
  results: [],
  images: [],
  credits: {},
  busy: false,
  onSearch: () => undefined,
  onAsk: () => undefined,
  onRefine: () => undefined,
  onSources: () => undefined,
  onDraft: () => undefined,
  onItem: () => undefined,
});

export const useCard = () => useContext(CardContext);

/** Attribution line for a picture, if known. */
export const useCredit = (src: string | undefined) => {
  const { credits } = useCard();
  return src ? credits[src]?.credit : undefined;
};

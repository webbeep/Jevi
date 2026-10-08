import { createContext, useContext } from 'react';
import type { ImageResult, SearchResult } from '../../shared/types';

export interface CardContextValue {
  results: SearchResult[];
  images: ImageResult[];
  /** Attribution by picture URL, shown on hover and in the card's credits. */
  credits: Record<string, { credit: string; link: string }>;
  /** True while this card is being (re)designed; interactive controls pause. */
  busy: boolean;
  onSearch: (query: string) => void;
  onAsk: (question: string) => void;
  onRefine: (instruction: string) => void;
  /** Opens the source list narrowed to what this card cites. */
  onSources: () => void;
  /** Opens a source in the in-app reader. */
  onRead: (result: SearchResult) => void;
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
  onRead: () => undefined,
});

export const useCard = () => useContext(CardContext);

/** Attribution line for a picture, if known. */
export const useCredit = (src: string | undefined) => {
  const { credits } = useCard();
  return src ? credits[src]?.credit : undefined;
};

import { createContext, useContext } from 'react';
import type { ImageResult, SearchResult } from '../../shared/types';

export interface CardContextValue {
  results: SearchResult[];
  images: ImageResult[];
  /** True while this card is being (re)designed; interactive controls pause. */
  busy: boolean;
  onSearch: (query: string) => void;
  onAsk: (question: string) => void;
  onRefine: (instruction: string) => void;
}

export const CardContext = createContext<CardContextValue>({
  results: [],
  images: [],
  busy: false,
  onSearch: () => undefined,
  onAsk: () => undefined,
  onRefine: () => undefined,
});

export const useCard = () => useContext(CardContext);

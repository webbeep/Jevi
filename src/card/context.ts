import { createContext, useContext } from 'react';
import type { ImageResult, SearchResult } from '../../shared/types';

export interface CardContextValue {
  results: SearchResult[];
  images: ImageResult[];
  onSearch: (query: string) => void;
  onAsk: (question: string) => void;
}

export const CardContext = createContext<CardContextValue>({ results: [], images: [], onSearch: () => undefined, onAsk: () => undefined });

export const useCard = () => useContext(CardContext);

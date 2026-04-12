import { create } from 'zustand';
import type { Heading } from '@shared/types';

interface HeadingsState {
  headings: Heading[];
  setHeadings: (headings: Heading[]) => void;
  scrollToPos: number | null;
  requestScroll: (pos: number) => void;
  clearScroll: () => void;
}

export const useHeadings = create<HeadingsState>((set) => ({
  headings: [],
  setHeadings: (headings) => set({ headings }),
  scrollToPos: null,
  requestScroll: (pos) => set({ scrollToPos: pos }),
  clearScroll: () => set({ scrollToPos: null }),
}));

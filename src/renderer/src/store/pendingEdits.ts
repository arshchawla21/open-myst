import { create } from 'zustand';
import type { PendingEdit } from '@shared/types';
import { bridge } from '../api/bridge';

interface PendingEditsState {
  edits: PendingEdit[];
  loading: boolean;
  activeDoc: string | null;

  load: (docFilename: string) => Promise<void>;
  accept: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  clearAll: () => Promise<void>;
}

export const usePendingEdits = create<PendingEditsState>((set, get) => ({
  edits: [],
  loading: false,
  activeDoc: null,

  load: async (docFilename) => {
    set({ loading: true, activeDoc: docFilename });
    try {
      const edits = await bridge.pendingEdits.list(docFilename);
      set({ edits, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  accept: async (id) => {
    await bridge.pendingEdits.accept(id);
    const doc = get().activeDoc;
    if (doc) {
      const edits = await bridge.pendingEdits.list(doc);
      set({ edits });
    }
  },

  reject: async (id) => {
    await bridge.pendingEdits.reject(id);
    const doc = get().activeDoc;
    if (doc) {
      const edits = await bridge.pendingEdits.list(doc);
      set({ edits });
    }
  },

  clearAll: async () => {
    const doc = get().activeDoc;
    if (!doc) return;
    await bridge.pendingEdits.clear(doc);
    set({ edits: [] });
  },
}));

import { create } from 'zustand';
import type { Comment } from '@shared/types';
import { bridge } from '../api/bridge';

interface CommentsState {
  comments: Comment[];
  loading: boolean;
  activeDoc: string | null;
  expandedId: string | null;

  load: (docFilename: string) => Promise<void>;
  create: (data: {
    text: string;
    contextBefore: string;
    contextAfter: string;
    message: string;
  }) => Promise<Comment | null>;
  delete: (id: string) => Promise<void>;
  resolve: (id: string) => Promise<void>;
  reopen: (id: string) => Promise<void>;
  setExpanded: (id: string | null) => void;
}

export const useComments = create<CommentsState>((set, get) => ({
  comments: [],
  loading: false,
  activeDoc: null,
  expandedId: null,

  load: async (docFilename) => {
    set({ loading: true, activeDoc: docFilename });
    try {
      const comments = await bridge.comments.list(docFilename);
      set({ comments, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  create: async (data) => {
    const doc = get().activeDoc;
    if (!doc) return null;
    const comment = await bridge.comments.create(doc, data);
    set({ comments: [...get().comments, comment] });
    return comment;
  },

  delete: async (id) => {
    await bridge.comments.delete(id);
    set({
      comments: get().comments.filter((c) => c.id !== id),
      expandedId: get().expandedId === id ? null : get().expandedId,
    });
  },

  resolve: async (id) => {
    await bridge.comments.resolve(id);
    const doc = get().activeDoc;
    if (doc) {
      const comments = await bridge.comments.list(doc);
      set({ comments });
    }
  },

  reopen: async (id) => {
    await bridge.comments.reopen(id);
    const doc = get().activeDoc;
    if (doc) {
      const comments = await bridge.comments.list(doc);
      set({ comments });
    }
  },

  setExpanded: (id) => set({ expandedId: id }),
}));

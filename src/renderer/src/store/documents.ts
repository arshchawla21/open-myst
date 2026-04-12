import { create } from 'zustand';
import type { DocumentFile } from '@shared/types';
import { bridge } from '../api/bridge';

interface DocumentsState {
  files: DocumentFile[];
  activeFile: string | null;

  loadFiles: () => Promise<void>;
  setActive: (filename: string) => void;
  createFile: (name: string) => Promise<void>;
  deleteFile: (filename: string) => Promise<void>;
}

export const useDocuments = create<DocumentsState>((set, get) => ({
  files: [],
  activeFile: null,

  loadFiles: async () => {
    const files = await bridge.documents.list();
    const current = get().activeFile;
    const activeFile =
      current && files.some((f) => f.filename === current)
        ? current
        : files[0]?.filename ?? null;
    set({ files, activeFile });
  },

  setActive: (filename) => {
    set({ activeFile: filename });
  },

  createFile: async (name) => {
    const doc = await bridge.documents.create(name);
    const files = [...get().files, doc].sort((a, b) => a.filename.localeCompare(b.filename));
    set({ files, activeFile: doc.filename });
  },

  deleteFile: async (filename) => {
    await bridge.documents.delete(filename);
    const files = get().files.filter((f) => f.filename !== filename);
    const activeFile =
      get().activeFile === filename ? (files[0]?.filename ?? null) : get().activeFile;
    set({ files, activeFile });
  },
}));

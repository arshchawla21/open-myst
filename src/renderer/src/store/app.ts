import { create } from 'zustand';
import type { AppSettings, ProjectMeta } from '@shared/types';
import { bridge } from '../api/bridge';

interface AppState {
  project: ProjectMeta | null;
  settings: AppSettings | null;
  settingsOpen: boolean;
  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  openSettings: () => void;
  closeSettings: () => void;
  createNewProject: () => Promise<void>;
  openExistingProject: () => Promise<void>;
  closeProject: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  project: null,
  settings: null,
  settingsOpen: false,
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const [settings, project] = await Promise.all([
        bridge.settings.get(),
        bridge.projects.getCurrent(),
      ]);
      set({ settings, project, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  refreshSettings: async () => {
    const settings = await bridge.settings.get();
    set({ settings });
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  createNewProject: async () => {
    set({ loading: true, error: null });
    try {
      const result = await bridge.projects.createNew();
      if (result.ok) {
        set({ project: result.value });
        await get().refreshSettings();
      } else if (result.error !== 'cancelled') {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  openExistingProject: async () => {
    set({ loading: true, error: null });
    try {
      const result = await bridge.projects.open();
      if (result.ok) {
        set({ project: result.value });
        await get().refreshSettings();
      } else if (result.error !== 'cancelled') {
        set({ error: result.error });
      }
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  closeProject: async () => {
    await bridge.projects.close();
    set({ project: null });
  },
}));

import type { AppSettings, ProjectMeta, Result } from './types';

export interface MystApi {
  settings: {
    get: () => Promise<AppSettings>;
    setOpenRouterKey: (key: string) => Promise<void>;
    hasOpenRouterKey: () => Promise<boolean>;
    clearOpenRouterKey: () => Promise<void>;
    setDefaultModel: (model: string) => Promise<void>;
  };
  projects: {
    createNew: () => Promise<Result<ProjectMeta>>;
    open: () => Promise<Result<ProjectMeta>>;
    getCurrent: () => Promise<ProjectMeta | null>;
    close: () => Promise<void>;
    listRecent: () => Promise<string[]>;
  };
}

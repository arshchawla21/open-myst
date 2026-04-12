export interface AppSettings {
  defaultModel: string;
  hasOpenRouterKey: boolean;
  recentProjects: string[];
}

export interface ProjectMeta {
  name: string;
  path: string;
  defaultModel: string | null;
  createdAt: string;
}

export interface ProjectSummary {
  path: string;
  name: string;
}

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const DEFAULT_MODEL = 'google/gemma-3-27b-it';

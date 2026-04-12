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

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: string;
}

export interface Heading {
  level: number;
  text: string;
  pos: number;
}

export interface SourceMeta {
  slug: string;
  originalName: string;
  type: 'pdf' | 'markdown' | 'text';
  addedAt: string;
  summary: string;
}

export interface DocumentFile {
  filename: string;
  label: string;
}

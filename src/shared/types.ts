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
  name: string;
  originalName: string;
  type: 'pdf' | 'markdown' | 'text' | 'pasted';
  addedAt: string;
  summary: string;
  indexSummary: string;
  sourcePath?: string;
}

export interface DocumentFile {
  filename: string;
  label: string;
}

export interface ThreadMessage {
  role: ChatRole;
  content: string;
  timestamp: string;
}

export type CommentState = 'open' | 'resolved' | 'orphaned';

export interface Comment {
  id: string;
  docFilename: string;
  text: string;
  contextBefore: string;
  contextAfter: string;
  message: string;
  thread: ThreadMessage[];
  state: CommentState;
  createdAt: string;
  resolvedBy?: string;
}

export interface PendingEdit {
  id: string;
  docFilename: string;
  oldString: string;
  newString: string;
  occurrence: number;
  fromComment?: string;
  createdAt: string;
}

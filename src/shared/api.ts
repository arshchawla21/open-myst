import type { AppSettings, ChatMessage, DocumentFile, ProjectMeta, Result, SourceMeta } from './types';

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
  document: {
    read: (filename: string) => Promise<string>;
    write: (filename: string, content: string) => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
  documents: {
    list: () => Promise<DocumentFile[]>;
    create: (name: string) => Promise<DocumentFile>;
    delete: (filename: string) => Promise<void>;
  };
  chat: {
    send: (message: string, activeDocument: string) => Promise<ChatMessage>;
    history: () => Promise<ChatMessage[]>;
    clear: () => Promise<void>;
    onChunk: (callback: (chunk: string) => void) => () => void;
    onChunkDone: (callback: () => void) => () => void;
  };
  sources: {
    ingest: (filePaths: string[]) => Promise<SourceMeta[]>;
    list: () => Promise<SourceMeta[]>;
    read: (slug: string) => Promise<string>;
    delete: (slug: string) => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
}

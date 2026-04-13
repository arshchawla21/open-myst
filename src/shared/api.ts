import type {
  AppSettings,
  ChatMessage,
  Comment,
  DocumentFile,
  PendingEdit,
  ProjectMeta,
  Result,
  SourceMeta,
  ThreadMessage,
} from './types';

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
    sendInCommentThread: (commentId: string, message: string) => Promise<ThreadMessage>;
    actionComments: (commentIds: string[], activeDocument: string) => Promise<ChatMessage>;
    history: () => Promise<ChatMessage[]>;
    clear: () => Promise<void>;
    onChunk: (callback: (chunk: string) => void) => () => void;
    onChunkDone: (callback: () => void) => () => void;
  };
  sources: {
    ingest: (filePaths: string[]) => Promise<SourceMeta[]>;
    ingestText: (text: string, title: string) => Promise<SourceMeta>;
    pickFiles: () => Promise<string[]>;
    list: () => Promise<SourceMeta[]>;
    read: (slug: string) => Promise<string>;
    delete: (slug: string) => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
  comments: {
    list: (docFilename: string) => Promise<Comment[]>;
    create: (
      docFilename: string,
      data: { text: string; contextBefore: string; contextAfter: string; message: string },
    ) => Promise<Comment>;
    update: (id: string, changes: Partial<Pick<Comment, 'message' | 'state'>>) => Promise<Comment>;
    delete: (id: string) => Promise<void>;
    resolve: (id: string) => Promise<void>;
    reopen: (id: string) => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
  pendingEdits: {
    list: (docFilename: string) => Promise<PendingEdit[]>;
    accept: (id: string) => Promise<void>;
    reject: (id: string) => Promise<void>;
    clear: (docFilename: string) => Promise<void>;
    onChanged: (callback: () => void) => () => void;
  };
}


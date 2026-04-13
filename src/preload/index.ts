import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { MystApi } from '@shared/api';

const api: MystApi = {
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.Settings.Get),
    setOpenRouterKey: (key) => ipcRenderer.invoke(IpcChannels.Settings.SetOpenRouterKey, key),
    hasOpenRouterKey: () => ipcRenderer.invoke(IpcChannels.Settings.HasOpenRouterKey),
    clearOpenRouterKey: () => ipcRenderer.invoke(IpcChannels.Settings.ClearOpenRouterKey),
    setDefaultModel: (model) => ipcRenderer.invoke(IpcChannels.Settings.SetDefaultModel, model),
  },
  projects: {
    createNew: () => ipcRenderer.invoke(IpcChannels.Projects.CreateNew),
    open: () => ipcRenderer.invoke(IpcChannels.Projects.Open),
    getCurrent: () => ipcRenderer.invoke(IpcChannels.Projects.GetCurrent),
    close: () => ipcRenderer.invoke(IpcChannels.Projects.Close),
    listRecent: () => ipcRenderer.invoke(IpcChannels.Projects.ListRecent),
  },
  document: {
    read: (filename) => ipcRenderer.invoke(IpcChannels.Document.Read, filename),
    write: (filename, content) => ipcRenderer.invoke(IpcChannels.Document.Write, filename, content),
    onChanged: (callback) => {
      const handler = (): void => {
        callback();
      };
      ipcRenderer.on(IpcChannels.Document.Changed, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.Document.Changed, handler);
      };
    },
  },
  documents: {
    list: () => ipcRenderer.invoke(IpcChannels.Documents.List),
    create: (name) => ipcRenderer.invoke(IpcChannels.Documents.Create, name),
    delete: (filename) => ipcRenderer.invoke(IpcChannels.Documents.Delete, filename),
  },
  chat: {
    send: (message, activeDocument) => ipcRenderer.invoke(IpcChannels.Chat.Send, message, activeDocument),
    sendInCommentThread: (commentId, message) =>
      ipcRenderer.invoke(IpcChannels.Chat.SendInCommentThread, commentId, message),
    actionComments: (commentIds, activeDocument) =>
      ipcRenderer.invoke(IpcChannels.Chat.ActionComments, commentIds, activeDocument),
    history: () => ipcRenderer.invoke(IpcChannels.Chat.History),
    clear: () => ipcRenderer.invoke(IpcChannels.Chat.Clear),
    onChunk: (callback) => {
      const handler = (_event: Electron.IpcRendererEvent, chunk: string): void => {
        callback(chunk);
      };
      ipcRenderer.on(IpcChannels.Chat.Chunk, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.Chat.Chunk, handler);
      };
    },
    onChunkDone: (callback) => {
      const handler = (): void => {
        callback();
      };
      ipcRenderer.on(IpcChannels.Chat.ChunkDone, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.Chat.ChunkDone, handler);
      };
    },
  },
  sources: {
    ingest: (filePaths) => ipcRenderer.invoke(IpcChannels.Sources.Ingest, filePaths),
    ingestText: (text, title) => ipcRenderer.invoke(IpcChannels.Sources.IngestText, text, title),
    pickFiles: () => ipcRenderer.invoke(IpcChannels.Sources.PickFiles),
    list: () => ipcRenderer.invoke(IpcChannels.Sources.List),
    read: (slug) => ipcRenderer.invoke(IpcChannels.Sources.Read, slug),
    delete: (slug) => ipcRenderer.invoke(IpcChannels.Sources.Delete, slug),
    onChanged: (callback) => {
      const handler = (): void => {
        callback();
      };
      ipcRenderer.on(IpcChannels.Sources.Changed, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.Sources.Changed, handler);
      };
    },
  },
  comments: {
    list: (docFilename) => ipcRenderer.invoke(IpcChannels.Comments.List, docFilename),
    create: (docFilename, data) => ipcRenderer.invoke(IpcChannels.Comments.Create, docFilename, data),
    update: (id, changes) => ipcRenderer.invoke(IpcChannels.Comments.Update, id, changes),
    delete: (id) => ipcRenderer.invoke(IpcChannels.Comments.Delete, id),
    resolve: (id) => ipcRenderer.invoke(IpcChannels.Comments.Resolve, id),
    reopen: (id) => ipcRenderer.invoke(IpcChannels.Comments.Reopen, id),
    onChanged: (callback) => {
      const handler = (): void => {
        callback();
      };
      ipcRenderer.on(IpcChannels.Comments.Changed, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.Comments.Changed, handler);
      };
    },
  },
  pendingEdits: {
    list: (docFilename) => ipcRenderer.invoke(IpcChannels.PendingEdits.List, docFilename),
    accept: (id) => ipcRenderer.invoke(IpcChannels.PendingEdits.Accept, id),
    reject: (id) => ipcRenderer.invoke(IpcChannels.PendingEdits.Reject, id),
    clear: (docFilename) => ipcRenderer.invoke(IpcChannels.PendingEdits.Clear, docFilename),
    onChanged: (callback) => {
      const handler = (): void => {
        callback();
      };
      ipcRenderer.on(IpcChannels.PendingEdits.Changed, handler);
      return () => {
        ipcRenderer.removeListener(IpcChannels.PendingEdits.Changed, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld('myst', api);

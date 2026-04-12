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
};

contextBridge.exposeInMainWorld('myst', api);

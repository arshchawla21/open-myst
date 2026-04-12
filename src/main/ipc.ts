import { ipcMain } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import {
  clearOpenRouterKey,
  getSettings,
  setDefaultModel,
  setOpenRouterKey,
} from './settings';
import { closeProject, createNewProject, getCurrentProject, openProject } from './projects';
import { createDocument, deleteDocument, listDocuments, readDocument, writeDocument } from './document';
import { clearHistory, loadHistory, sendMessage } from './chat';
import { deleteSource, ingestSources, listSources, readSource } from './sources';

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.Settings.Get, () => getSettings());

  ipcMain.handle(IpcChannels.Settings.SetOpenRouterKey, async (_event, key: unknown) => {
    if (typeof key !== 'string' || key.trim().length === 0) {
      throw new Error('API key must be a non-empty string.');
    }
    await setOpenRouterKey(key.trim());
  });

  ipcMain.handle(IpcChannels.Settings.HasOpenRouterKey, async () => {
    const s = await getSettings();
    return s.hasOpenRouterKey;
  });

  ipcMain.handle(IpcChannels.Settings.ClearOpenRouterKey, () => clearOpenRouterKey());

  ipcMain.handle(IpcChannels.Settings.SetDefaultModel, async (_event, model: unknown) => {
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new Error('Model id must be a non-empty string.');
    }
    await setDefaultModel(model.trim());
  });

  ipcMain.handle(IpcChannels.Projects.CreateNew, () => createNewProject());
  ipcMain.handle(IpcChannels.Projects.Open, () => openProject());
  ipcMain.handle(IpcChannels.Projects.GetCurrent, () => getCurrentProject());
  ipcMain.handle(IpcChannels.Projects.Close, () => {
    closeProject();
  });
  ipcMain.handle(IpcChannels.Projects.ListRecent, async () => {
    const s = await getSettings();
    return s.recentProjects;
  });

  // Document read/write (now takes filename)
  ipcMain.handle(IpcChannels.Document.Read, (_event, filename: unknown) => {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new Error('Filename must be a non-empty string.');
    }
    return readDocument(filename.trim());
  });
  ipcMain.handle(IpcChannels.Document.Write, async (_event, filename: unknown, content: unknown) => {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new Error('Filename must be a non-empty string.');
    }
    if (typeof content !== 'string') {
      throw new Error('Document content must be a string.');
    }
    await writeDocument(filename.trim(), content);
  });

  // Documents management
  ipcMain.handle(IpcChannels.Documents.List, () => listDocuments());
  ipcMain.handle(IpcChannels.Documents.Create, async (_event, name: unknown) => {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Document name must be a non-empty string.');
    }
    return createDocument(name.trim());
  });
  ipcMain.handle(IpcChannels.Documents.Delete, async (_event, filename: unknown) => {
    if (typeof filename !== 'string' || filename.trim().length === 0) {
      throw new Error('Filename must be a non-empty string.');
    }
    await deleteDocument(filename.trim());
  });

  // Chat
  ipcMain.handle(IpcChannels.Chat.Send, async (_event, message: unknown, activeDocument: unknown) => {
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new Error('Message must be a non-empty string.');
    }
    if (typeof activeDocument !== 'string' || activeDocument.trim().length === 0) {
      throw new Error('Active document must be specified.');
    }
    return sendMessage(message.trim(), activeDocument.trim());
  });
  ipcMain.handle(IpcChannels.Chat.History, () => loadHistory());
  ipcMain.handle(IpcChannels.Chat.Clear, () => clearHistory());

  // Sources
  ipcMain.handle(IpcChannels.Sources.Ingest, async (_event, filePaths: unknown) => {
    if (!Array.isArray(filePaths) || filePaths.some((p) => typeof p !== 'string')) {
      throw new Error('File paths must be an array of strings.');
    }
    return ingestSources(filePaths as string[]);
  });
  ipcMain.handle(IpcChannels.Sources.List, () => listSources());
  ipcMain.handle(IpcChannels.Sources.Read, (_event, slug: unknown) => {
    if (typeof slug !== 'string' || slug.trim().length === 0) {
      throw new Error('Source slug must be a non-empty string.');
    }
    return readSource(slug.trim());
  });
  ipcMain.handle(IpcChannels.Sources.Delete, async (_event, slug: unknown) => {
    if (typeof slug !== 'string' || slug.trim().length === 0) {
      throw new Error('Source slug must be a non-empty string.');
    }
    await deleteSource(slug.trim());
  });
}

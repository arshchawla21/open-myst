import { ipcMain } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import {
  clearOpenRouterKey,
  getSettings,
  setDefaultModel,
  setOpenRouterKey,
} from './settings';
import { closeProject, createNewProject, getCurrentProject, openProject } from './projects';
import { readDocument, writeDocument } from './document';
import { clearHistory, loadHistory, sendMessage } from './chat';

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

  ipcMain.handle(IpcChannels.Document.Read, () => readDocument());
  ipcMain.handle(IpcChannels.Document.Write, async (_event, content: unknown) => {
    if (typeof content !== 'string') {
      throw new Error('Document content must be a string.');
    }
    await writeDocument(content);
  });

  ipcMain.handle(IpcChannels.Chat.Send, async (_event, message: unknown) => {
    if (typeof message !== 'string' || message.trim().length === 0) {
      throw new Error('Message must be a non-empty string.');
    }
    return sendMessage(message.trim());
  });
  ipcMain.handle(IpcChannels.Chat.History, () => loadHistory());
  ipcMain.handle(IpcChannels.Chat.Clear, () => clearHistory());
}

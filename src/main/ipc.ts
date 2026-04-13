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
import { deleteSource, ingestSources, ingestText, listSources, pickSourceFiles, readSource } from './sources';
import { computeWikiGraph } from './wiki';
import { createComment, deleteComment, listComments } from './comments';
import {
  acceptPendingEdit,
  clearPendingEdits,
  listPendingEdits,
  patchPendingEditNewString,
  rejectPendingEdit,
} from './pendingEdits';

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
  ipcMain.handle(
    IpcChannels.Chat.Send,
    async (_event, message: unknown, activeDocument: unknown, displayText: unknown) => {
      if (typeof message !== 'string' || message.trim().length === 0) {
        throw new Error('Message must be a non-empty string.');
      }
      if (typeof activeDocument !== 'string' || activeDocument.trim().length === 0) {
        throw new Error('Active document must be specified.');
      }
      const display =
        typeof displayText === 'string' && displayText.trim().length > 0
          ? displayText
          : undefined;
      return sendMessage(message.trim(), activeDocument.trim(), display);
    },
  );
  ipcMain.handle(IpcChannels.Chat.History, () => loadHistory());
  ipcMain.handle(IpcChannels.Chat.Clear, () => clearHistory());

  // Comments
  ipcMain.handle(IpcChannels.Comments.List, (_event, docFilename: unknown) => {
    if (typeof docFilename !== 'string' || docFilename.trim().length === 0) {
      throw new Error('docFilename must be a non-empty string.');
    }
    return listComments(docFilename.trim());
  });
  ipcMain.handle(IpcChannels.Comments.Create, async (_event, docFilename: unknown, data: unknown) => {
    if (typeof docFilename !== 'string' || docFilename.trim().length === 0) {
      throw new Error('docFilename must be a non-empty string.');
    }
    const d = data as { text?: string; contextBefore?: string; contextAfter?: string; message?: string };
    if (!d || typeof d.text !== 'string' || typeof d.message !== 'string') {
      throw new Error('Invalid comment data.');
    }
    return createComment(docFilename.trim(), {
      text: d.text,
      contextBefore: d.contextBefore ?? '',
      contextAfter: d.contextAfter ?? '',
      message: d.message,
    });
  });
  ipcMain.handle(IpcChannels.Comments.Delete, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Comment id must be a string.');
    await deleteComment(id);
  });

  // Pending edits
  ipcMain.handle(IpcChannels.PendingEdits.List, (_event, docFilename: unknown) => {
    if (typeof docFilename !== 'string' || docFilename.trim().length === 0) {
      throw new Error('docFilename must be a non-empty string.');
    }
    return listPendingEdits(docFilename.trim());
  });
  ipcMain.handle(IpcChannels.PendingEdits.Accept, async (_event, id: unknown, override: unknown) => {
    if (typeof id !== 'string') throw new Error('Pending edit id must be a string.');
    const overrideStr = typeof override === 'string' ? override : undefined;
    await acceptPendingEdit(id, overrideStr);
  });
  ipcMain.handle(IpcChannels.PendingEdits.Reject, async (_event, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Pending edit id must be a string.');
    await rejectPendingEdit(id);
  });
  ipcMain.handle(
    IpcChannels.PendingEdits.Patch,
    async (_event, docFilename: unknown, id: unknown, newString: unknown) => {
      if (typeof docFilename !== 'string' || docFilename.trim().length === 0) {
        throw new Error('docFilename must be a non-empty string.');
      }
      if (typeof id !== 'string') throw new Error('Pending edit id must be a string.');
      if (typeof newString !== 'string') throw new Error('newString must be a string.');
      await patchPendingEditNewString(docFilename.trim(), id, newString);
    },
  );
  ipcMain.handle(IpcChannels.PendingEdits.Clear, async (_event, docFilename: unknown) => {
    if (typeof docFilename !== 'string' || docFilename.trim().length === 0) {
      throw new Error('docFilename must be a non-empty string.');
    }
    await clearPendingEdits(docFilename.trim());
  });

  // Sources
  ipcMain.handle(IpcChannels.Sources.Ingest, async (_event, filePaths: unknown) => {
    if (!Array.isArray(filePaths) || filePaths.some((p) => typeof p !== 'string')) {
      throw new Error('File paths must be an array of strings.');
    }
    return ingestSources(filePaths as string[]);
  });
  ipcMain.handle(IpcChannels.Sources.IngestText, async (_event, text: unknown, title: unknown) => {
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('Text must be a non-empty string.');
    }
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new Error('Title must be a non-empty string.');
    }
    return ingestText(text.trim(), title.trim());
  });
  ipcMain.handle(IpcChannels.Sources.PickFiles, () => pickSourceFiles());
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

  // Wiki
  ipcMain.handle(IpcChannels.Wiki.Graph, async () => {
    const sources = await listSources();
    return computeWikiGraph(sources);
  });
}

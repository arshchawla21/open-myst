import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { PendingEdit } from '@shared/types';
import { getCurrentProject } from './projects';
import { resolveComment } from './comments';
import { readDocument, writeDocument } from './document';

function projectRoot(): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return project.path;
}

function pendingPath(docFilename: string): string {
  return join(projectRoot(), '.myst', 'pending', `${docFilename}.json`);
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

async function readPending(docFilename: string): Promise<PendingEdit[]> {
  const path = pendingPath(docFilename);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as PendingEdit[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writePending(docFilename: string, edits: PendingEdit[]): Promise<void> {
  const path = pendingPath(docFilename);
  await ensureDir(join(projectRoot(), '.myst', 'pending'));
  await fs.writeFile(path, JSON.stringify(edits, null, 2), 'utf-8');
}

function notifyChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.PendingEdits.Changed);
  }
}

function notifyDocumentChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.Document.Changed);
  }
}

export async function listPendingEdits(docFilename: string): Promise<PendingEdit[]> {
  return readPending(docFilename);
}

export async function addPendingEdits(
  docFilename: string,
  edits: Array<{ oldString: string; newString: string; occurrence?: number; fromComment?: string }>,
): Promise<PendingEdit[]> {
  const existing = await readPending(docFilename);
  const newEdits: PendingEdit[] = edits.map((e) => {
    const edit: PendingEdit = {
      id: randomUUID(),
      docFilename,
      oldString: e.oldString,
      newString: e.newString,
      occurrence: e.occurrence ?? 1,
      createdAt: new Date().toISOString(),
    };
    if (e.fromComment) edit.fromComment = e.fromComment;
    return edit;
  });
  const combined = [...existing, ...newEdits];
  await writePending(docFilename, combined);
  notifyChanged();
  return newEdits;
}

async function findPendingById(id: string): Promise<{ edit: PendingEdit; docFilename: string } | null> {
  const pendingDir = join(projectRoot(), '.myst', 'pending');
  let entries: string[];
  try {
    entries = await fs.readdir(pendingDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const docFilename = entry.replace(/\.json$/, '');
    const edits = await readPending(docFilename);
    const edit = edits.find((e) => e.id === id);
    if (edit) return { edit, docFilename };
  }
  return null;
}

function applyOccurrence(doc: string, oldString: string, newString: string, occurrence: number): string | null {
  if (oldString === '') {
    const trimmed = doc.trimEnd();
    return trimmed + '\n\n' + newString + '\n';
  }
  let idx = -1;
  let nth = 0;
  let searchFrom = 0;
  while (nth < occurrence) {
    idx = doc.indexOf(oldString, searchFrom);
    if (idx === -1) return null;
    nth++;
    if (nth < occurrence) searchFrom = idx + oldString.length;
  }
  return doc.slice(0, idx) + newString + doc.slice(idx + oldString.length);
}

export async function acceptPendingEdit(id: string): Promise<void> {
  const found = await findPendingById(id);
  if (!found) throw new Error(`Pending edit ${id} not found.`);
  const { edit, docFilename } = found;

  const doc = await readDocument(docFilename);
  const newDoc = applyOccurrence(doc, edit.oldString, edit.newString, edit.occurrence);
  if (newDoc === null) {
    throw new Error('Could not locate the original text to apply this edit. Reject it and ask the LLM to retry.');
  }
  await writeDocument(docFilename, newDoc);
  notifyDocumentChanged();

  const remaining = (await readPending(docFilename)).filter((e) => e.id !== id);
  await writePending(docFilename, remaining);
  notifyChanged();

  if (edit.fromComment && remaining.every((e) => e.fromComment !== edit.fromComment)) {
    try {
      await resolveComment(edit.fromComment, edit.id);
    } catch {
      // comment may have been deleted
    }
  }
}

export async function rejectPendingEdit(id: string): Promise<void> {
  const found = await findPendingById(id);
  if (!found) return;
  const { docFilename } = found;
  const remaining = (await readPending(docFilename)).filter((e) => e.id !== id);
  await writePending(docFilename, remaining);
  notifyChanged();
}

export async function clearPendingEdits(docFilename: string): Promise<void> {
  await writePending(docFilename, []);
  notifyChanged();
}

export async function countPendingForDoc(docFilename: string): Promise<number> {
  const edits = await readPending(docFilename);
  return edits.length;
}

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { Comment, ThreadMessage } from '@shared/types';
import { getCurrentProject } from './projects';

function projectRoot(): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return project.path;
}

function commentsPath(docFilename: string): string {
  return join(projectRoot(), '.myst', 'comments', `${docFilename}.json`);
}

async function ensureDir(path: string): Promise<void> {
  await fs.mkdir(path, { recursive: true });
}

async function readComments(docFilename: string): Promise<Comment[]> {
  const path = commentsPath(docFilename);
  try {
    const raw = await fs.readFile(path, 'utf-8');
    return JSON.parse(raw) as Comment[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeComments(docFilename: string, comments: Comment[]): Promise<void> {
  const path = commentsPath(docFilename);
  await ensureDir(join(projectRoot(), '.myst', 'comments'));
  await fs.writeFile(path, JSON.stringify(comments, null, 2), 'utf-8');
}

function notifyChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IpcChannels.Comments.Changed);
  }
}

export async function listComments(docFilename: string): Promise<Comment[]> {
  return readComments(docFilename);
}

export async function createComment(
  docFilename: string,
  data: { text: string; contextBefore: string; contextAfter: string; message: string },
): Promise<Comment> {
  const comments = await readComments(docFilename);
  const comment: Comment = {
    id: randomUUID(),
    docFilename,
    text: data.text,
    contextBefore: data.contextBefore,
    contextAfter: data.contextAfter,
    message: data.message,
    thread: [],
    state: 'open',
    createdAt: new Date().toISOString(),
  };
  comments.push(comment);
  await writeComments(docFilename, comments);
  notifyChanged();
  return comment;
}

async function findCommentById(id: string): Promise<{ comment: Comment; docFilename: string } | null> {
  const commentsDir = join(projectRoot(), '.myst', 'comments');
  let entries: string[];
  try {
    entries = await fs.readdir(commentsDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const docFilename = entry.replace(/\.json$/, '');
    const comments = await readComments(docFilename);
    const comment = comments.find((c) => c.id === id);
    if (comment) return { comment, docFilename };
  }
  return null;
}

export async function updateComment(
  id: string,
  changes: Partial<Pick<Comment, 'message' | 'state'>>,
): Promise<Comment> {
  const found = await findCommentById(id);
  if (!found) throw new Error(`Comment ${id} not found.`);
  const comments = await readComments(found.docFilename);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Comment ${id} not found.`);
  comments[idx] = { ...comments[idx]!, ...changes };
  await writeComments(found.docFilename, comments);
  notifyChanged();
  return comments[idx]!;
}

export async function deleteComment(id: string): Promise<void> {
  const found = await findCommentById(id);
  if (!found) return;
  const comments = await readComments(found.docFilename);
  const filtered = comments.filter((c) => c.id !== id);
  await writeComments(found.docFilename, filtered);
  notifyChanged();
}

export async function resolveComment(id: string, resolvedBy?: string): Promise<void> {
  const found = await findCommentById(id);
  if (!found) return;
  const comments = await readComments(found.docFilename);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return;
  comments[idx] = { ...comments[idx]!, state: 'resolved', resolvedBy };
  await writeComments(found.docFilename, comments);
  notifyChanged();
}

export async function reopenComment(id: string): Promise<void> {
  const found = await findCommentById(id);
  if (!found) return;
  const comments = await readComments(found.docFilename);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const next = { ...comments[idx]!, state: 'open' as const };
  delete next.resolvedBy;
  comments[idx] = next;
  await writeComments(found.docFilename, comments);
  notifyChanged();
}

export async function addThreadMessage(id: string, message: ThreadMessage): Promise<Comment> {
  const found = await findCommentById(id);
  if (!found) throw new Error(`Comment ${id} not found.`);
  const comments = await readComments(found.docFilename);
  const idx = comments.findIndex((c) => c.id === id);
  if (idx === -1) throw new Error(`Comment ${id} not found.`);
  const updated: Comment = { ...comments[idx]!, thread: [...comments[idx]!.thread, message] };
  comments[idx] = updated;
  await writeComments(found.docFilename, comments);
  notifyChanged();
  return updated;
}

export async function getComment(id: string): Promise<Comment | null> {
  const found = await findCommentById(id);
  return found ? found.comment : null;
}

export async function getCommentsByIds(ids: string[]): Promise<Comment[]> {
  const result: Comment[] = [];
  for (const id of ids) {
    const found = await findCommentById(id);
    if (found) result.push(found.comment);
  }
  return result;
}

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { getCurrentProject } from './projects';
import type { DocumentFile } from '@shared/types';

function documentsDir(): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return join(project.path, 'documents');
}

export async function listDocuments(): Promise<DocumentFile[]> {
  const dir = documentsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.md'))
    .sort()
    .map((filename) => ({
      filename,
      label: filename.replace(/\.md$/, ''),
    }));
}

export async function createDocument(name: string): Promise<DocumentFile> {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const filePath = join(documentsDir(), filename);
  await fs.writeFile(filePath, `# ${name.replace(/\.md$/, '')}\n`, 'utf-8');
  return { filename, label: filename.replace(/\.md$/, '') };
}

export async function deleteDocument(filename: string): Promise<void> {
  const filePath = join(documentsDir(), filename);
  await fs.unlink(filePath);
}

export async function readDocument(filename: string): Promise<string> {
  const filePath = join(documentsDir(), filename);
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export async function writeDocument(filename: string, content: string): Promise<void> {
  const filePath = join(documentsDir(), filename);
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, 'utf-8');
  await fs.rename(tmp, filePath);
}

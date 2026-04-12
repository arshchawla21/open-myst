import { promises as fs } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { SourceMeta } from '@shared/types';
import { getCurrentProject } from './projects';
import { getOpenRouterKey, getSettings } from './settings';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function projectPath(file: string): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return join(project.path, file);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

async function generateSummary(text: string, originalName: string): Promise<string> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) return `Source: ${originalName}`;

  const settings = await getSettings();
  const model = settings.defaultModel;

  const preview = text.slice(0, 3000);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://myst-review.app',
        'X-Title': 'Myst Review',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You summarize documents in ONE sentence. Be specific and informative. Output only the summary, nothing else.',
          },
          {
            role: 'user',
            content: `Summarize this source titled "${originalName}" in one sentence:\n\n${preview}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) return `Source: ${originalName}`;

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() || `Source: ${originalName}`;
  } catch {
    return `Source: ${originalName}`;
  }
}

async function updateSourcesIndex(): Promise<void> {
  const sources = await listSources();
  const lines = ['# Sources\n'];
  if (sources.length === 0) {
    lines.push('_No sources yet._\n');
  } else {
    for (const s of sources) {
      lines.push(`- [${s.originalName}](${s.slug}.md) — ${s.summary}`);
    }
    lines.push('');
  }
  await fs.writeFile(projectPath('sources/index.md'), lines.join('\n'), 'utf-8');
}

export async function ingestSources(filePaths: string[]): Promise<SourceMeta[]> {
  const results: SourceMeta[] = [];

  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase();
    const originalName = basename(filePath);
    const slug = slugify(originalName);

    let uniqueSlug = slug;
    let counter = 1;
    while (await pathExists(projectPath(`sources/${uniqueSlug}.md`))) {
      uniqueSlug = `${slug}_${counter}`;
      counter++;
    }

    let text = '';
    let type: SourceMeta['type'] = 'text';

    if (ext === '.pdf') {
      type = 'pdf';
      const buffer = await fs.readFile(filePath);
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      text = result.text;
      await parser.destroy();
    } else if (ext === '.md' || ext === '.markdown') {
      type = 'markdown';
      text = await fs.readFile(filePath, 'utf-8');
    } else {
      type = 'text';
      text = await fs.readFile(filePath, 'utf-8');
    }

    await fs.writeFile(projectPath(`sources/${uniqueSlug}.md`), text, 'utf-8');

    const summary = await generateSummary(text, originalName);

    const meta: SourceMeta = {
      slug: uniqueSlug,
      originalName,
      type,
      addedAt: new Date().toISOString(),
      summary,
    };
    await fs.writeFile(
      projectPath(`sources/${uniqueSlug}.meta.json`),
      JSON.stringify(meta, null, 2),
      'utf-8',
    );

    results.push(meta);
  }

  await updateSourcesIndex();
  sendToRenderer(IpcChannels.Sources.Changed);
  return results;
}

export async function listSources(): Promise<SourceMeta[]> {
  const sourcesDir = projectPath('sources');
  let entries: string[];
  try {
    entries = await fs.readdir(sourcesDir);
  } catch {
    return [];
  }

  const metaFiles = entries.filter((e) => e.endsWith('.meta.json'));
  const results: SourceMeta[] = [];

  for (const metaFile of metaFiles) {
    try {
      const raw = await fs.readFile(join(sourcesDir, metaFile), 'utf-8');
      results.push(JSON.parse(raw) as SourceMeta);
    } catch {
      // skip corrupt meta files
    }
  }

  results.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  return results;
}

export async function readSource(slug: string): Promise<string> {
  return fs.readFile(projectPath(`sources/${slug}.md`), 'utf-8');
}

export async function deleteSource(slug: string): Promise<void> {
  const mdPath = projectPath(`sources/${slug}.md`);
  const metaPath = projectPath(`sources/${slug}.meta.json`);

  await fs.unlink(mdPath).catch(() => {});
  await fs.unlink(metaPath).catch(() => {});

  await updateSourcesIndex();
  sendToRenderer(IpcChannels.Sources.Changed);
}

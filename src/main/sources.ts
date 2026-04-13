import { promises as fs } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { dialog, BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { SourceMeta } from '@shared/types';
import { getCurrentProject } from './projects';
import { getOpenRouterKey, getSettings } from './settings';
import { updateWikiIndex, appendWikiLog } from './wiki';

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

async function uniqueSlugFor(base: string): Promise<string> {
  let slug = base;
  let counter = 1;
  while (await pathExists(projectPath(`sources/${slug}.md`))) {
    slug = `${base}_${counter}`;
    counter++;
  }
  return slug;
}

interface SourceDigest {
  name: string;
  summary: string;
  indexSummary: string;
}

async function generateDigest(rawText: string, hint: string, existingSources?: SourceMeta[]): Promise<SourceDigest> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) {
    return {
      name: hint,
      summary: rawText.slice(0, 500),
      indexSummary: `Source: ${hint}`,
    };
  }

  const settings = await getSettings();
  const model = settings.defaultModel;
  const preview = rawText.slice(0, 6000);

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
            content: `You process source material into a research wiki entry. Given raw text from a source, output ONLY valid JSON with these three fields:

{
  "name": "A short, descriptive title for this source (2-6 words)",
  "summary": "A detailed wiki-style summary of the source content. 2-4 paragraphs covering the key points, arguments, data, and conclusions. Write in third person. Be thorough — this summary replaces the original for research purposes. You may use markdown links to reference other sources if relevant, using the format [Source Name](slug.md).",
  "indexSummary": "One sentence (under 20 words) describing what this source covers, for quick scanning."
}

Output ONLY the JSON object. No markdown fences, no commentary.`,
          },
          {
            role: 'user',
            content: `Source hint: "${hint}"${existingSources?.length ? `\n\nExisting sources in this project (you can link to these using [Name](slug.md)):\n${existingSources.map((s) => `- ${s.name} (${s.slug}.md)`).join('\n')}` : ''}\n\nRaw text:\n${preview}`,
          },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      return { name: hint, summary: rawText.slice(0, 500), indexSummary: `Source: ${hint}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    const cleaned = content.replace(/^```json?\s*\n?/, '').replace(/\n?```\s*$/, '');
    const parsed = JSON.parse(cleaned) as Partial<SourceDigest>;

    return {
      name: typeof parsed.name === 'string' ? parsed.name : hint,
      summary: typeof parsed.summary === 'string' ? parsed.summary : rawText.slice(0, 500),
      indexSummary: typeof parsed.indexSummary === 'string' ? parsed.indexSummary : `Source: ${hint}`,
    };
  } catch {
    return { name: hint, summary: rawText.slice(0, 500), indexSummary: `Source: ${hint}` };
  }
}

async function extractText(filePath: string): Promise<{ text: string; type: SourceMeta['type'] }> {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const buffer = await fs.readFile(filePath);
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    await parser.destroy();
    return { text: result.text, type: 'pdf' };
  }
  const text = await fs.readFile(filePath, 'utf-8');
  if (ext === '.md' || ext === '.markdown') return { text, type: 'markdown' };
  return { text, type: 'text' };
}

async function saveSource(
  slug: string,
  digest: SourceDigest,
  type: SourceMeta['type'],
  originalName: string,
  sourcePath?: string,
): Promise<SourceMeta> {
  await fs.writeFile(projectPath(`sources/${slug}.md`), digest.summary, 'utf-8');

  const meta: SourceMeta = {
    slug,
    name: digest.name,
    originalName,
    type,
    addedAt: new Date().toISOString(),
    summary: digest.summary,
    indexSummary: digest.indexSummary,
    sourcePath,
  };
  await fs.writeFile(
    projectPath(`sources/${slug}.meta.json`),
    JSON.stringify(meta, null, 2),
    'utf-8',
  );
  return meta;
}

async function updateSourcesIndex(): Promise<void> {
  const sources = await listSources();
  const lines = ['# Sources\n'];
  if (sources.length === 0) {
    lines.push('_No sources yet._\n');
  } else {
    for (const s of sources) {
      lines.push(`- [${s.name}](${s.slug}.md) — ${s.indexSummary}`);
    }
    lines.push('');
  }
  await fs.writeFile(projectPath('sources/index.md'), lines.join('\n'), 'utf-8');
}

export async function ingestSources(filePaths: string[]): Promise<SourceMeta[]> {
  const results: SourceMeta[] = [];
  const existing = await listSources();

  for (const filePath of filePaths) {
    const originalName = basename(filePath);
    const { text, type } = await extractText(filePath);
    const digest = await generateDigest(text, originalName, existing);
    const slug = await uniqueSlugFor(slugify(digest.name || originalName));
    const meta = await saveSource(slug, digest, type, originalName, filePath);
    results.push(meta);
  }

  await updateSourcesIndex();
  const all = await listSources();
  await updateWikiIndex(all);
  for (const m of results) {
    await appendWikiLog('ingest', `${m.name} (${m.slug})`);
  }
  sendToRenderer(IpcChannels.Sources.Changed);
  return results;
}

export async function ingestText(text: string, title: string): Promise<SourceMeta> {
  const existing = await listSources();
  const digest = await generateDigest(text, title, existing);
  const slug = await uniqueSlugFor(slugify(digest.name || title));
  const meta = await saveSource(slug, digest, 'pasted', title);

  await updateSourcesIndex();
  await updateWikiIndex(await listSources());
  await appendWikiLog('ingest', `${meta.name} (${meta.slug})`);
  sendToRenderer(IpcChannels.Sources.Changed);
  return meta;
}

export async function pickSourceFiles(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: 'Add sources',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Documents', extensions: ['pdf', 'md', 'markdown', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled) return [];
  return result.filePaths;
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
  await updateWikiIndex(await listSources());
  await appendWikiLog('delete', slug);
  sendToRenderer(IpcChannels.Sources.Changed);
}

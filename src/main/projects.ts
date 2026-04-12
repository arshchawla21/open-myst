import { dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type { ProjectMeta, Result } from '@shared/types';
import { pushRecentProject } from './settings';

const AGENT_TEMPLATE = `# Agent Instructions

You are the AI collaborator for this Myst Review project. A project is a folder containing:
- \`document.md\` — the working document the user is editing.
- \`sources/\` — research sources, each stored as \`source_<slug>.md\`, with \`sources/index.md\` as a one-line index.
- \`chat.jsonl\` — the main conversation transcript.

## How you work
- Always consult \`sources/index.md\` first when the user asks about research.
- Open individual \`source_*.md\` files only when you need their details.
- When the user asks for an edit via an inline comment, reply with a proposed change as a structured \`myst-edit\` block plus a one-line summary of what changed and why.
- When the user asks a question via an inline comment, answer briefly and without editing the document unless told to.
- Prefer accuracy and source fidelity over fluency. If you are not confident a claim is supported by the sources, say so.

## Output discipline
- Short comments deserve short answers.
- Long reasoning belongs in deep-dive sidebars, not main chat.
- Never fabricate citations.
`;

let currentProject: ProjectMeta | null = null;

function projectJsonPath(root: string): string {
  return join(root, 'project.json');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function scaffoldProject(root: string, name: string): Promise<ProjectMeta> {
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(join(root, 'sources'), { recursive: true });
  await fs.mkdir(join(root, '.myst', 'diffs'), { recursive: true });

  const meta: ProjectMeta = {
    name,
    path: root,
    defaultModel: null,
    createdAt: new Date().toISOString(),
  };

  const writes: Array<[string, string]> = [
    [projectJsonPath(root), JSON.stringify(meta, null, 2)],
    [join(root, 'agent.md'), AGENT_TEMPLATE],
    [join(root, 'document.md'), `# ${name}\n\nStart writing here.\n`],
    [join(root, 'chat.jsonl'), ''],
    [join(root, 'comments.json'), '[]'],
    [join(root, 'sources', 'index.md'), '# Sources\n\n_No sources yet._\n'],
  ];

  for (const [path, contents] of writes) {
    if (!(await pathExists(path))) {
      await fs.writeFile(path, contents, 'utf-8');
    }
  }

  return meta;
}

async function readProject(root: string): Promise<ProjectMeta> {
  const raw = await fs.readFile(projectJsonPath(root), 'utf-8');
  return JSON.parse(raw) as ProjectMeta;
}

export async function createNewProject(): Promise<Result<ProjectMeta>> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a folder for your new Myst Review project',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Create project here',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' };
  }
  const root = result.filePaths[0]!;
  const name = basename(root);
  const meta = await scaffoldProject(root, name);
  currentProject = meta;
  await pushRecentProject(root);
  return { ok: true, value: meta };
}

export async function openProject(): Promise<Result<ProjectMeta>> {
  const result = await dialog.showOpenDialog({
    title: 'Open a Myst Review project',
    properties: ['openDirectory'],
    buttonLabel: 'Open project',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'cancelled' };
  }
  const root = result.filePaths[0]!;
  if (!(await pathExists(projectJsonPath(root)))) {
    return {
      ok: false,
      error: 'Not a Myst Review project (no project.json found). Create a new project instead.',
    };
  }
  const meta = await readProject(root);
  currentProject = meta;
  await pushRecentProject(root);
  return { ok: true, value: meta };
}

export function getCurrentProject(): ProjectMeta | null {
  return currentProject;
}

export function closeProject(): void {
  currentProject = null;
}

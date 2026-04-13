import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type {
  SourceMeta,
  WikiGraph,
  WikiGraphEdge,
  WikiGraphNode,
} from '@shared/types';
import { getCurrentProject } from './projects';
import { log } from './log';

/**
 * The research wiki: a persistent, LLM-maintained knowledge base that lives
 * under .myst/wiki/ and is loaded into every chat turn as the agent's
 * default memory. The user never sees it directly in the file tree — the
 * agent reads from it to think, writes to it to remember, and the graph
 * popup renders its shape as a trust signal for what's happening under the
 * hood.
 *
 * Layout:
 *   .myst/wiki/index.md  — master index (sources, concepts, findings)
 *   .myst/wiki/log.md    — append-only activity log
 *
 * Source summaries themselves stay at sources/<slug>.md (existing layout,
 * visible in the project folder). The wiki index points at them.
 */

function wikiRoot(): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return join(project.path, '.myst', 'wiki');
}

function indexPath(): string {
  return join(wikiRoot(), 'index.md');
}

function logPath(): string {
  return join(wikiRoot(), 'log.md');
}

export async function ensureWikiDir(): Promise<void> {
  await fs.mkdir(wikiRoot(), { recursive: true });
}

export async function readWikiIndex(): Promise<string> {
  try {
    return await fs.readFile(indexPath(), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

export async function updateWikiIndex(sources: SourceMeta[]): Promise<void> {
  await ensureWikiDir();
  const lines: string[] = [];
  lines.push('# Research Wiki Index');
  lines.push('');
  lines.push(
    '_Auto-maintained by the agent. This is the default memory surface: read it before every chat turn to orient yourself, then pull the specific source pages you need._',
  );
  lines.push('');
  lines.push('## Sources');
  if (sources.length === 0) {
    lines.push('');
    lines.push('_No sources yet._');
  } else {
    for (const s of sources) {
      lines.push(`- [${s.name}](../../sources/${s.slug}.md) — ${s.indexSummary}`);
    }
  }
  lines.push('');
  lines.push('## Concepts');
  lines.push('');
  lines.push(
    '_Cross-cutting themes, methods, or ideas that span multiple sources. Create a concept page (wiki/concepts/<slug>.md) and link it here when you notice a pattern worth naming._',
  );
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push(
    '_Experimental results, observations, and conclusions. Tie each back to the source(s) or doc(s) that motivated it._',
  );
  lines.push('');
  await fs.writeFile(indexPath(), lines.join('\n'), 'utf-8');
  log('wiki', 'index.updated', { sourceCount: sources.length });
}

export async function appendWikiLog(type: string, description: string): Promise<void> {
  await ensureWikiDir();
  const date = new Date().toISOString().slice(0, 10);
  const line = `## [${date}] ${type} | ${description}\n`;
  try {
    // readFile first so we can seed with a header on the first write.
    await fs.access(logPath());
    await fs.appendFile(logPath(), line, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      await fs.writeFile(logPath(), `# Research Log\n\n${line}`, 'utf-8');
    } else {
      throw err;
    }
  }
  log('wiki', 'log.appended', { type, description: description.slice(0, 80) });
}

/**
 * Scan source summaries for `[text](slug.md)` markdown links that point at
 * other known source slugs, and turn them into graph edges. This is the
 * cheapest possible "linked sources" heuristic: the summary prompt already
 * asks the LLM to cite related sources as wikilinks, so the edges fall out
 * of the summary text for free. No embeddings, no separate inference pass.
 */
export function computeWikiGraph(sources: SourceMeta[]): WikiGraph {
  const slugSet = new Set(sources.map((s) => s.slug));
  const nodes: WikiGraphNode[] = sources.map((s) => ({
    id: s.slug,
    name: s.name,
    indexSummary: s.indexSummary,
    addedAt: s.addedAt,
  }));
  const edges: WikiGraphEdge[] = [];
  const seen = new Set<string>();
  const linkRe = /\]\(([^)\s]+?)\.md\)/g;
  for (const s of sources) {
    let m: RegExpExecArray | null;
    while ((m = linkRe.exec(s.summary)) !== null) {
      const target = m[1];
      if (!target || target === s.slug || !slugSet.has(target)) continue;
      const key = `${s.slug}->${target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: s.slug, target });
    }
  }
  return { nodes, edges };
}

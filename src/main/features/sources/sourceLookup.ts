import { readAnchor, type AnchorLookupHit } from './lookup';
import { log } from '../../platform';

/**
 * LLM-facing `source_lookup` protocol.
 *
 * The LLM emits one or more fenced blocks:
 *   ```source_lookup
 *   {"slug": "smith-2022", "anchor": "law-1-2"}
 *   ```
 *
 * We parse them out of a response, resolve each via readAnchor (deterministic
 * byte-range read from <slug>.raw.txt), strip the fences from the chat text,
 * and return a formatted follow-up message that can be injected back into
 * the conversation before the LLM's next turn.
 *
 * Kept pure-ish: parseSourceLookups is I/O-free for tests; resolveSourceLookups
 * does the disk reads.
 */

const LOOKUP_FENCE = /```source_lookup\s*\n([\s\S]*?)```/g;

export interface SourceLookupRequest {
  slug: string;
  anchor: string;
}

export interface SourceLookupParseResult {
  requests: SourceLookupRequest[];
  stripped: string;
}

export function parseSourceLookups(text: string): SourceLookupParseResult {
  const requests: SourceLookupRequest[] = [];
  let stripped = text;
  let match: RegExpExecArray | null;
  LOOKUP_FENCE.lastIndex = 0;
  while ((match = LOOKUP_FENCE.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!.trim()) as { slug?: unknown; anchor?: unknown };
      if (typeof parsed.slug === 'string' && typeof parsed.anchor === 'string') {
        requests.push({ slug: parsed.slug, anchor: parsed.anchor });
      }
    } catch {
      // malformed block — drop silently, caller still gets the chat text
    }
    stripped = stripped.replace(match[0], '');
  }
  return { requests, stripped: stripped.trim() };
}

export interface ResolvedLookup {
  request: SourceLookupRequest;
  hit: AnchorLookupHit | null;
}

export async function resolveSourceLookups(
  requests: SourceLookupRequest[],
): Promise<ResolvedLookup[]> {
  const out: ResolvedLookup[] = [];
  for (const req of requests) {
    const hit = await readAnchor(req.slug, req.anchor);
    if (!hit) {
      log('sources', 'lookup.miss', { slug: req.slug, anchor: req.anchor });
    } else {
      log('sources', 'lookup.hit', {
        slug: req.slug,
        anchor: req.anchor,
        len: hit.text.length,
      });
    }
    out.push({ request: req, hit });
  }
  return out;
}

export function formatLookupReply(resolved: ResolvedLookup[]): string {
  if (resolved.length === 0) return '';
  const parts = resolved.map(({ request, hit }) => {
    if (!hit) {
      return `**Lookup failed:** \`${request.slug}#${request.anchor}\` — no such anchor. Check the wiki index for the correct id, or ask the user to reingest the source if you're sure it should exist.`;
    }
    const { anchor, text } = hit;
    return `**${request.slug}#${anchor.id}** — ${anchor.label} [${anchor.type}]\n\n> ${text.replace(/\n/g, '\n> ')}`;
  });
  return (
    '[source_lookup results — deterministic verbatim text pulled from disk]\n\n' +
    parts.join('\n\n---\n\n')
  );
}

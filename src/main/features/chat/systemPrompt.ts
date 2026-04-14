import type { PendingEdit } from '@shared/types';

/**
 * System prompt builder — the one file you touch to change how the agent is
 * briefed at the start of each turn. Split out from turn.ts deliberately:
 * tweaking the prompt is the single most common "I want to change agent
 * behavior" knob, and it should not live buried inside the orchestration
 * loop.
 *
 * The system content for a turn is the concatenation of:
 *   1. agent.md               — per-project persona/instructions
 *   2. tweak etiquette rider  — ask-for-feedback hint after edits
 *   3. active document label
 *   4. the full document text (delimited)
 *   5. pending-edits block    — the staging area the user hasn't accepted yet
 *   6. wiki index             — research memory surface (when non-empty)
 *
 * Pending edits and the wiki index are conditional; docs and agent.md are
 * always present.
 */

const TWEAK_ETIQUETTE =
  '\n\n[Revision etiquette] After proposing any myst_edit, end your chat with a short invitation like "Want me to tweak anything?" so the user can iterate naturally. To revise an existing pending edit, reuse the same old_string — never create a parallel pending entry.';

function buildPendingBlock(pending: PendingEdit[]): string {
  if (pending.length === 0) return '';
  return (
    '\n\n========== PENDING EDITS (awaiting user accept/reject — NOT in the document yet) ==========\n' +
    pending
      .map(
        (e, i) =>
          `--- Pending ${i + 1} ---\n` +
          `old_string: ${JSON.stringify(e.oldString)}\n` +
          `new_string:\n${e.newString}\n`,
      )
      .join('\n') +
    '==========\n' +
    'If the user is asking you to adjust a pending edit, you have two options:\n' +
    '  (a) Full rewrite — emit a myst_edit with the SAME old_string as the pending one; the system replaces that pending entry in place.\n' +
    '  (b) Surgical tweak — emit a myst_edit whose old_string is a SUBSTRING of the pending new_string above, and whose new_string is the fix. The system will patch that pending edit for you — you do NOT need the text to be in the document yet.\n' +
    'Either way, NEVER create a parallel pending entry when the user is refining the last one.'
  );
}

function buildWikiBlock(wikiIndex: string): string {
  if (!wikiIndex.trim()) return '';
  return (
    '\n\n========== BEGIN research wiki index (.myst/wiki/index.md — your default memory surface) ==========\n' +
    wikiIndex +
    '\n========== END research wiki index ==========\n' +
    'This index is loaded every turn. Treat it as the map of what you already know: consult it before answering, and open the source pages (sources/<slug>.md) it points at when you need the full text. Do not ask the user to attach sources that are already here.\n\n' +
    '[Deep reference] Each source lists anchor ids beneath it (format `slug#anchor-id`). To pull the EXACT verbatim passage for an anchor — for quoting, definition checks, citing a law/equation — emit a fenced `source_lookup` block. The system will resolve it deterministically from disk and inject the verbatim text back into the conversation before your next turn. Do NOT paraphrase quotes from memory — use the lookup.\n\n' +
    'Format:\n' +
    '```source_lookup\n{"slug": "smith-2022", "anchor": "law-1-2"}\n```\n' +
    'You may emit multiple source_lookup blocks in one response; each is resolved independently. Lookups are free — use them liberally when precision matters.'
  );
}

export interface SystemPromptInput {
  agentPrompt: string;
  activeDocument: string;
  docLabel: string;
  document: string;
  pending: PendingEdit[];
  wikiIndex: string;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const { agentPrompt, activeDocument, docLabel, document, pending, wikiIndex } = input;
  return [
    agentPrompt,
    TWEAK_ETIQUETTE,
    `\n\n[Active document: ${docLabel}]`,
    `\n\n========== BEGIN ${activeDocument} ==========\n` +
      document +
      `\n========== END ${activeDocument} ==========`,
    buildPendingBlock(pending),
    buildWikiBlock(wikiIndex),
  ].join('');
}

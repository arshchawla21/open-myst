import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { ChatMessage } from '@shared/types';
import { getCurrentProject } from './projects';
import { getOpenRouterKey, getSettings } from './settings';
import { addPendingEdits, listPendingEdits, patchPendingEditNewString } from './pendingEdits';
import {
  cleanChatContent,
  looksLikeDocumentRequest,
  parseEditBlocks,
  tryResolvePendingPatch,
  validateEdits,
  type EditOp,
} from './editLogic';
import { log, logError } from './log';
import { readWikiIndex } from './wiki';
import type { PendingEdit } from '@shared/types';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function projectPath(file: string): string {
  const project = getCurrentProject();
  if (!project) throw new Error('No project is open.');
  return join(project.path, file);
}

async function readProjectFile(file: string): Promise<string> {
  try {
    return await fs.readFile(projectPath(file), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  }
}

async function appendMessage(msg: ChatMessage): Promise<void> {
  const path = projectPath('chat.jsonl');
  await fs.appendFile(path, JSON.stringify(msg) + '\n', 'utf-8');
}

export async function loadHistory(): Promise<ChatMessage[]> {
  const raw = await readProjectFile('chat.jsonl');
  if (!raw.trim()) return [];
  return raw
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ChatMessage);
}

export async function clearHistory(): Promise<void> {
  await fs.writeFile(projectPath('chat.jsonl'), '', 'utf-8');
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

async function streamCompletion(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  emitChunks: boolean,
): Promise<string> {
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  log('chat', 'llm.request', {
    model,
    messages: messages.length,
    roles: messages.map((m) => m.role).join(','),
    totalChars,
    emitChunks,
  });
  const t0 = Date.now();
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://myst-review.app',
      'X-Title': 'Myst Review',
    },
    body: JSON.stringify({ model, messages, stream: true }),
  });

  if (!response.ok) {
    const body = await response.text();
    logError('chat', 'llm.http.failed', new Error(body), { status: response.status });
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  let fullContent = '';
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream available.');

  const decoder = new TextDecoder();
  let buffer = '';

  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
      continue;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const chunk = parsed.choices?.[0]?.delta?.content;
        if (chunk) {
          fullContent += chunk;
          if (emitChunks) sendToRenderer(IpcChannels.Chat.Chunk, chunk);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  log('chat', 'llm.response', {
    chars: fullContent.length,
    elapsedMs: Date.now() - t0,
    preview: fullContent.slice(0, 400),
  });
  return fullContent;
}

async function listPendingEditsSafe(docFilename: string) {
  try {
    return await listPendingEdits(docFilename);
  } catch {
    return [];
  }
}

async function stageEdits(docFilename: string, edits: EditOp[]): Promise<number> {
  if (edits.length === 0) return 0;
  await addPendingEdits(
    docFilename,
    edits.map((e) => {
      const entry: { oldString: string; newString: string; occurrence?: number } = {
        oldString: e.old_string,
        newString: e.new_string,
      };
      if (e.occurrence !== undefined) entry.occurrence = e.occurrence;
      return entry;
    }),
  );
  return edits.length;
}

export async function sendMessage(
  userText: string,
  activeDocument: string,
  displayText?: string,
): Promise<ChatMessage> {
  log('chat', 'send.received', {
    doc: activeDocument,
    userText,
    displayText: displayText ?? null,
    userTextChars: userText.length,
  });
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Settings.');

  const settings = await getSettings();
  const model = settings.defaultModel;

  const agentPrompt = await readProjectFile('agent.md');
  const docPath = `documents/${activeDocument}`;
  const document = await readProjectFile(docPath);
  const wikiIndex = await readWikiIndex();

  const docLabel = activeDocument.replace(/\.md$/, '');

  // `displayText` is what the user sees in chat history; `userText` is what
  // the LLM sees for this turn. When they differ (e.g. Ask Myst from a
  // comment), the raw prompt scaffolding stays out of the visible thread.
  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: displayText ?? userText,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(userMsg);
  // Tell the renderer a new turn has started so it can show the user
  // message + typing indicator immediately, before the first chunk arrives.
  sendToRenderer(IpcChannels.Chat.Started);

  try {
    return await runTurn({
      apiKey,
      model,
      agentPrompt,
      docPath,
      document,
      wikiIndex,
      docLabel,
      activeDocument,
      userText,
      displayText,
    });
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    logError('chat', 'send.failed', err);
    const errorMsg: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: `⚠️ ${message}`,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(errorMsg);
    return errorMsg;
  } finally {
    // Always unblock the renderer UI — even on error.
    sendToRenderer(IpcChannels.Chat.ChunkDone);
  }
}

interface TurnContext {
  apiKey: string;
  model: string;
  agentPrompt: string;
  docPath: string;
  document: string;
  wikiIndex: string;
  docLabel: string;
  activeDocument: string;
  userText: string;
  displayText: string | undefined;
}

async function runTurn(ctx: TurnContext): Promise<ChatMessage> {
  const {
    apiKey,
    model,
    agentPrompt,
    docPath,
    document,
    wikiIndex,
    docLabel,
    activeDocument,
    userText,
    displayText,
  } = ctx;

  const history = await loadHistory();
  log('chat', 'turn.start', {
    doc: activeDocument,
    model,
    docChars: document.length,
    historyLen: history.length,
    hasDisplayText: displayText !== undefined,
    isComment: userText.startsWith('COMMENT CONTEXT'),
  });

  const existingPending = await listPendingEditsSafe(activeDocument);
  log('chat', 'turn.pending.snapshot', {
    count: existingPending.length,
    ids: existingPending.map((e) => e.id).join(','),
  });
  const pendingBlock = existingPending.length
    ? '\n\n========== PENDING EDITS (awaiting user accept/reject — NOT in the document yet) ==========\n' +
      existingPending
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
    : '';

  const tweakEtiquette =
    '\n\n[Revision etiquette] After proposing any myst_edit, end your chat with a short invitation like "Want me to tweak anything?" so the user can iterate naturally. To revise an existing pending edit, reuse the same old_string — never create a parallel pending entry.';

  const systemContent = [
    agentPrompt,
    tweakEtiquette,
    `\n\n[Active document: ${docLabel}]`,
    `\n\n========== BEGIN ${activeDocument} ==========\n` + document + `\n========== END ${activeDocument} ==========`,
    pendingBlock,
    wikiIndex.trim()
      ? '\n\n========== BEGIN research wiki index (.myst/wiki/index.md — your default memory surface) ==========\n' +
        wikiIndex +
        '\n========== END research wiki index ==========\n' +
        'This index is loaded every turn. Treat it as the map of what you already know: consult it before answering, and open the source pages (sources/<slug>.md) it points at when you need the full text. Do not ask the user to attach sources that are already here.'
      : '',
  ].join('');

  const llmHistory = history.map((m) => ({ role: m.role, content: m.content }));
  // Replace the just-appended user turn with the full prompt for the LLM.
  if (displayText !== undefined && llmHistory.length > 0) {
    llmHistory[llmHistory.length - 1] = { role: 'user', content: userText };
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...llmHistory,
  ];

  log('chat', 'turn.systemPrompt', { chars: systemContent.length });

  const fullContent = await streamCompletion(apiKey, model, messages, true);

  let { edits, chatContent } = parseEditBlocks(fullContent);
  log('chat', 'turn.parsed', {
    edits: edits.length,
    editPreviews: edits.map((e) => ({
      oldLen: e.old_string.length,
      newLen: e.new_string.length,
      occ: e.occurrence ?? 1,
      oldPreview: e.old_string.slice(0, 80),
      newPreview: e.new_string.slice(0, 80),
    })),
    chatPreview: chatContent.slice(0, 200),
  });

  // Triage: an edit whose old_string references content from a pending edit
  // (not yet in the doc on disk) should patch that pending in place, not fail
  // doc validation. Critical for "write me X → make it shorter" where the
  // story only lives inside the pending newString so far.
  let pendingPatched = 0;
  if (edits.length > 0 && existingPending.length > 0) {
    const workingPending: PendingEdit[] = existingPending.map((e) => ({ ...e }));
    const remaining: EditOp[] = [];
    for (const edit of edits) {
      if (edit.old_string === '' || document.indexOf(edit.old_string) !== -1) {
        log('chat', 'triage.doc', {
          reason: edit.old_string === '' ? 'append' : 'matched-doc',
          oldPreview: edit.old_string.slice(0, 60),
        });
        remaining.push(edit);
        continue;
      }
      const match = tryResolvePendingPatch(
        edit.old_string,
        edit.new_string,
        edit.occurrence ?? 1,
        workingPending,
      );
      if (match) {
        const target = workingPending[match.index]!;
        log('chat', 'triage.pendingPatch', {
          pendingId: target.id,
          index: match.index,
          oldPreview: edit.old_string.slice(0, 60),
          newPreview: edit.new_string.slice(0, 60),
          patchedLen: match.updatedNewString.length,
        });
        await patchPendingEditNewString(activeDocument, target.id, match.updatedNewString);
        workingPending[match.index] = { ...target, newString: match.updatedNewString };
        pendingPatched++;
      } else {
        log('chat', 'triage.unmatched', {
          oldPreview: edit.old_string.slice(0, 80),
        });
        remaining.push(edit);
      }
    }
    edits = remaining;
  }

  // Comment-context turns default to chat answers; don't nag the LLM to emit
  // an edit just because the scaffolded prompt has example change-verbs in it.
  const isCommentTurn = userText.startsWith('COMMENT CONTEXT');
  if (
    !isCommentTurn &&
    edits.length === 0 &&
    pendingPatched === 0 &&
    looksLikeDocumentRequest(userText, fullContent)
  ) {
    log('chat', 'retry.missingBlock', { userText: userText.slice(0, 120) });
    const doc = await readProjectFile(docPath);
    const retryMessages = [
      ...messages,
      { role: 'assistant', content: fullContent },
      {
        role: 'user',
        content: `You forgot to include the myst_edit block. Here is the current document:\n\n${doc}\n\nPlease output the myst_edit block(s) now to make the change.`,
      },
    ];
    const retryContent = await streamCompletion(apiKey, model, retryMessages, false);
    const retryResult = parseEditBlocks(retryContent);
    if (retryResult.edits.length > 0) {
      edits = retryResult.edits;
      if (!chatContent) chatContent = retryResult.chatContent;
    }
  }

  if (edits.length > 0) {
    const validation = validateEdits(document, edits);
    if (!validation.ok) {
      log('chat', 'retry.validation', { failures: validation.failures });
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        {
          role: 'user',
          content: `Some edits could not be located unambiguously:\n${validation.failures.join('\n\n')}\n\nRe-emit the failed myst_edit blocks with a more specific old_string, or add an "occurrence" field to pick which match you meant.`,
        },
      ];
      const retryContent = await streamCompletion(apiKey, model, retryMessages, false);
      const retryResult = parseEditBlocks(retryContent);
      if (retryResult.edits.length > 0) {
        const retryValidation = validateEdits(document, retryResult.edits);
        if (retryValidation.ok) {
          edits = retryResult.edits;
        }
      }
    }
  }

  const staged = await stageEdits(activeDocument, edits);
  const totalApplied = staged + pendingPatched;
  log('chat', 'turn.done', {
    staged,
    pendingPatched,
    totalApplied,
    finalChatPreview: chatContent.slice(0, 200),
  });

  let finalChat = totalApplied > 0 ? (chatContent || 'Ready to review — check the pending edits.') : fullContent;
  finalChat = cleanChatContent(finalChat);

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: finalChat || (totalApplied > 0 ? `Staged ${totalApplied} edit${totalApplied === 1 ? '' : 's'} for review.` : ''),
    timestamp: new Date().toISOString(),
  };
  await appendMessage(assistantMsg);

  return assistantMsg;
}

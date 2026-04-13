import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { ChatMessage, Comment, ThreadMessage } from '@shared/types';
import { getCurrentProject } from './projects';
import { getOpenRouterKey, getSettings } from './settings';
import { addPendingEdits } from './pendingEdits';
import { addThreadMessage, getComment, getCommentsByIds } from './comments';

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

  return fullContent;
}

interface EditOp {
  old_string: string;
  new_string: string;
  occurrence?: number;
}

function extractEdits(text: string): { edits: EditOp[]; chatContent: string } {
  const regex = /```myst_edit\s*\n([\s\S]*?)```/g;
  const edits: EditOp[] = [];
  let chatContent = text;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    try {
      const raw = match[1]!.trim();
      const parsed = JSON.parse(raw) as {
        old_string?: string;
        new_string?: string;
        occurrence?: number;
      };
      if (typeof parsed.old_string === 'string' && typeof parsed.new_string === 'string') {
        const op: EditOp = {
          old_string: parsed.old_string,
          new_string: parsed.new_string,
        };
        if (typeof parsed.occurrence === 'number' && parsed.occurrence > 0) {
          op.occurrence = parsed.occurrence;
        }
        edits.push(op);
      }
    } catch {
      console.log('[myst-chat] failed to parse myst_edit JSON:', match[1]);
    }
    chatContent = chatContent.replace(match[0], '');
  }

  chatContent = chatContent.replace(/\n{3,}/g, '\n\n').trim();
  return { edits, chatContent };
}

interface LocateResult {
  ok: boolean;
  count: number;
  contexts: string[];
}

function locateEdit(doc: string, edit: EditOp): LocateResult {
  if (edit.old_string === '') return { ok: true, count: 1, contexts: [] };
  const contexts: string[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = doc.indexOf(edit.old_string, searchFrom);
    if (idx === -1) break;
    const start = Math.max(0, idx - 20);
    const end = Math.min(doc.length, idx + edit.old_string.length + 20);
    contexts.push(doc.slice(start, end).replace(/\n/g, ' '));
    searchFrom = idx + edit.old_string.length;
  }
  return { ok: contexts.length === 1, count: contexts.length, contexts };
}

function validateEdits(doc: string, edits: EditOp[]): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (let i = 0; i < edits.length; i++) {
    const edit = edits[i]!;
    if (edit.old_string === '') continue;
    const loc = locateEdit(doc, edit);
    if (loc.count === 0) {
      failures.push(`Edit ${i}: old_string not found. old_string: "${edit.old_string.slice(0, 80)}"`);
    } else if (loc.count > 1) {
      if (edit.occurrence && edit.occurrence >= 1 && edit.occurrence <= loc.count) continue;
      const ctxList = loc.contexts.map((c, j) => `  ${j + 1}. "${c}"`).join('\n');
      failures.push(
        `Edit ${i}: old_string matches ${loc.count} places. Re-emit with an "occurrence" field set to 1-${loc.count}.\nMatches:\n${ctxList}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}

const CHANGE_WORDS = /\b(changed|updated|switched|swapped|renamed|replaced|tweaked|edited|modified|added|wrote|dropped|inserted|promotion|start|here'?s)\b/i;
const REQUEST_WORDS = /\b(write|create|add|change|rename|edit|fix|rewrite|make|extend|continue|update|swap|replace|remove|delete)\b/i;

function looksLikeDocumentRequest(userText: string, llmResponse: string): boolean {
  return REQUEST_WORDS.test(userText) || CHANGE_WORDS.test(llmResponse);
}

function cleanChatContent(text: string): string {
  return text
    .replace(/```myst_edit\s*\n[\s\S]*?```/g, '')
    .replace(/`myst_edit`/gi, '')
    .replace(/myst_edit/gi, '')
    .replace(/old_string/g, '')
    .replace(/new_string/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function stageEdits(
  docFilename: string,
  edits: EditOp[],
  fromComment?: string,
): Promise<number> {
  if (edits.length === 0) return 0;
  await addPendingEdits(
    docFilename,
    edits.map((e) => {
      const entry: { oldString: string; newString: string; occurrence?: number; fromComment?: string } = {
        oldString: e.old_string,
        newString: e.new_string,
      };
      if (e.occurrence !== undefined) entry.occurrence = e.occurrence;
      if (fromComment !== undefined) entry.fromComment = fromComment;
      return entry;
    }),
  );
  return edits.length;
}

export async function sendMessage(userText: string, activeDocument: string): Promise<ChatMessage> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Settings.');

  const settings = await getSettings();
  const model = settings.defaultModel;

  const agentPrompt = await readProjectFile('agent.md');
  const docPath = `documents/${activeDocument}`;
  const document = await readProjectFile(docPath);
  const sourcesIndex = await readProjectFile('sources/index.md');

  const docLabel = activeDocument.replace(/\.md$/, '');

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: userText,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(userMsg);

  const history = await loadHistory();

  const systemContent = [
    agentPrompt,
    `\n\n[Active document: ${docLabel}]`,
    `\n\n========== BEGIN ${activeDocument} ==========\n` + document + `\n========== END ${activeDocument} ==========`,
    sourcesIndex.trim()
      ? '\n\n========== BEGIN sources/index.md (READ-ONLY, not part of the document) ==========\n' + sourcesIndex + '\n========== END sources/index.md =========='
      : '',
  ].join('');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  const fullContent = await streamCompletion(apiKey, model, messages, true);
  sendToRenderer(IpcChannels.Chat.ChunkDone);

  let { edits, chatContent } = extractEdits(fullContent);

  if (edits.length === 0 && looksLikeDocumentRequest(userText, fullContent)) {
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
    const retryResult = extractEdits(retryContent);
    if (retryResult.edits.length > 0) {
      edits = retryResult.edits;
      if (!chatContent) chatContent = retryResult.chatContent;
    }
  }

  if (edits.length > 0) {
    const validation = validateEdits(document, edits);
    if (!validation.ok) {
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        {
          role: 'user',
          content: `Some edits could not be located unambiguously:\n${validation.failures.join('\n\n')}\n\nRe-emit the failed myst_edit blocks with a more specific old_string, or add an "occurrence" field to pick which match you meant.`,
        },
      ];
      const retryContent = await streamCompletion(apiKey, model, retryMessages, false);
      const retryResult = extractEdits(retryContent);
      if (retryResult.edits.length > 0) {
        const retryValidation = validateEdits(document, retryResult.edits);
        if (retryValidation.ok) {
          edits = retryResult.edits;
        }
      }
    }
  }

  const staged = await stageEdits(activeDocument, edits);

  let finalChat = staged > 0 ? (chatContent || 'Ready to review — check the pending edits.') : fullContent;
  finalChat = cleanChatContent(finalChat);

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: finalChat || (staged > 0 ? `Staged ${staged} edit${staged === 1 ? '' : 's'} for review.` : ''),
    timestamp: new Date().toISOString(),
  };
  await appendMessage(assistantMsg);

  return assistantMsg;
}

function buildCommentSystemPrompt(
  agentPrompt: string,
  docFilename: string,
  document: string,
  comment: Comment,
): string {
  const docLabel = docFilename.replace(/\.md$/, '');
  return [
    agentPrompt,
    `\n\n[Active document: ${docLabel}]`,
    `\n\n[Scoped comment-thread mode]`,
    `\nYou are responding to a single inline comment on a specific passage. The user may ask a question about the passage or request a change.`,
    `\nIf they ask for a change, emit myst_edit block(s) as usual. If they ask a question, answer briefly in chat.`,
    `\n\n========== COMMENTED PASSAGE ==========\n${comment.text}\n========== END PASSAGE ==========`,
    `\n\nThe user's original comment: ${comment.message}`,
    `\n\n========== BEGIN ${docFilename} ==========\n${document}\n========== END ${docFilename} ==========`,
  ].join('');
}

export async function sendMessageInCommentThread(
  commentId: string,
  userText: string,
): Promise<ThreadMessage> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Settings.');

  const comment = await getComment(commentId);
  if (!comment) throw new Error('Comment not found.');

  const settings = await getSettings();
  const model = settings.defaultModel;

  const agentPrompt = await readProjectFile('agent.md');
  const docPath = `documents/${comment.docFilename}`;
  const document = await readProjectFile(docPath);

  const userThreadMsg: ThreadMessage = {
    role: 'user',
    content: userText,
    timestamp: new Date().toISOString(),
  };
  await addThreadMessage(commentId, userThreadMsg);

  const systemContent = buildCommentSystemPrompt(agentPrompt, comment.docFilename, document, comment);
  const threadHistory = [...comment.thread, userThreadMsg];

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...threadHistory.map((m) => ({ role: m.role, content: m.content })),
  ];

  const fullContent = await streamCompletion(apiKey, model, messages, true);
  sendToRenderer(IpcChannels.Chat.ChunkDone);

  let { edits, chatContent } = extractEdits(fullContent);

  if (edits.length > 0) {
    const validation = validateEdits(document, edits);
    if (!validation.ok) {
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        {
          role: 'user',
          content: `Some edits could not be located unambiguously:\n${validation.failures.join('\n\n')}\n\nRe-emit the failed myst_edit blocks with a more specific old_string, or add an "occurrence" field to pick which match you meant.`,
        },
      ];
      const retryContent = await streamCompletion(apiKey, model, retryMessages, false);
      const retryResult = extractEdits(retryContent);
      if (retryResult.edits.length > 0) {
        const retryValidation = validateEdits(document, retryResult.edits);
        if (retryValidation.ok) {
          edits = retryResult.edits;
          if (!chatContent) chatContent = retryResult.chatContent;
        }
      }
    }
  }

  await stageEdits(comment.docFilename, edits, comment.id);

  const finalChat = cleanChatContent(chatContent || fullContent) || (edits.length > 0 ? `Staged ${edits.length} edit${edits.length === 1 ? '' : 's'} for review.` : '');

  const assistantThreadMsg: ThreadMessage = {
    role: 'assistant',
    content: finalChat,
    timestamp: new Date().toISOString(),
  };
  await addThreadMessage(commentId, assistantThreadMsg);

  return assistantThreadMsg;
}

export async function actionComments(
  commentIds: string[],
  activeDocument: string,
): Promise<ChatMessage> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Settings.');

  const comments = await getCommentsByIds(commentIds);
  if (comments.length === 0) throw new Error('No comments to action.');

  const settings = await getSettings();
  const model = settings.defaultModel;

  const agentPrompt = await readProjectFile('agent.md');
  const docPath = `documents/${activeDocument}`;
  const document = await readProjectFile(docPath);
  const docLabel = activeDocument.replace(/\.md$/, '');

  const commentSummary = comments
    .map(
      (c, i) =>
        `Comment ${i + 1} [id: ${c.id}]:\n  Passage: "${c.text}"\n  Note: ${c.message}`,
    )
    .join('\n\n');

  const userPromptText = `Please action these inline comments on the document. For each comment, emit myst_edit block(s) that address what the user asked for. If a comment is a question rather than a change request, include a short answer for it in your chat reply instead of an edit.\n\n${commentSummary}`;

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: 'user',
    content: `Action ${comments.length} comment${comments.length === 1 ? '' : 's'}.`,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(userMsg);

  const history = await loadHistory();

  const systemContent = [
    agentPrompt,
    `\n\n[Active document: ${docLabel}]`,
    `\n\n========== BEGIN ${activeDocument} ==========\n${document}\n========== END ${activeDocument} ==========`,
  ].join('');

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userPromptText },
  ];

  const fullContent = await streamCompletion(apiKey, model, messages, true);
  sendToRenderer(IpcChannels.Chat.ChunkDone);

  let { edits, chatContent } = extractEdits(fullContent);

  if (edits.length > 0) {
    const validation = validateEdits(document, edits);
    if (!validation.ok) {
      const retryMessages = [
        ...messages,
        { role: 'assistant', content: fullContent },
        {
          role: 'user',
          content: `Some edits could not be located unambiguously:\n${validation.failures.join('\n\n')}\n\nRe-emit the failed myst_edit blocks with a more specific old_string, or add an "occurrence" field to pick which match you meant.`,
        },
      ];
      const retryContent = await streamCompletion(apiKey, model, retryMessages, false);
      const retryResult = extractEdits(retryContent);
      if (retryResult.edits.length > 0) {
        const retryValidation = validateEdits(document, retryResult.edits);
        if (retryValidation.ok) {
          edits = retryResult.edits;
        }
      }
    }
  }

  // Stage with comment linkage: match edits to comments by substring of old_string
  for (const edit of edits) {
    const linked = comments.find((c) => edit.old_string.includes(c.text) || c.text.includes(edit.old_string));
    await stageEdits(activeDocument, [edit], linked?.id);
  }

  const staged = edits.length;
  const finalChat = cleanChatContent(chatContent || fullContent) || (staged > 0 ? `Staged ${staged} edit${staged === 1 ? '' : 's'} for review.` : '');

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: finalChat,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(assistantMsg);

  return assistantMsg;
}

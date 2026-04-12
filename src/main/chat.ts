import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcChannels } from '@shared/ipc-channels';
import type { ChatMessage } from '@shared/types';
import { getCurrentProject } from './projects';
import { getOpenRouterKey } from './settings';
import { getSettings } from './settings';

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

export async function sendMessage(userText: string): Promise<ChatMessage> {
  const apiKey = await getOpenRouterKey();
  if (!apiKey) throw new Error('OpenRouter API key not set. Add it in Settings.');

  const settings = await getSettings();
  const model = settings.defaultModel;

  const agentPrompt = await readProjectFile('agent.md');
  const document = await readProjectFile('document.md');
  const sourcesIndex = await readProjectFile('sources/index.md');

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
    '\n\n---\n## Current Document\n\n' + document,
    sourcesIndex.trim() ? '\n\n---\n## Sources Index\n\n' + sourcesIndex : '',
  ].join('');

  const messages = [
    { role: 'system' as const, content: systemContent },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  ];

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
          sendToRenderer(IpcChannels.Chat.Chunk, chunk);
        }
      } catch {
        // skip malformed chunks
      }
    }
  }

  sendToRenderer(IpcChannels.Chat.ChunkDone);

  const assistantMsg: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: fullContent,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(assistantMsg);

  return assistantMsg;
}

import { randomUUID } from 'node:crypto';
import { IpcChannels } from '@shared/ipc-channels';
import type {
  DeepPlanMessage,
  DeepPlanSession,
  DeepPlanStage,
  DeepPlanStatus,
  SourceMeta,
} from '@shared/types';
import { broadcast, log, logError } from '../../platform';
import { streamChat, completeText, type LlmMessage } from '../../llm';
import { getOpenRouterKey, getDeepPlanModel, getTavilyKey } from '../settings';
import { ingestText, listSources } from '../sources';
import { listDocuments, writeDocument } from '../documents';
import {
  buildStatus,
  clearAutoStart,
  createSession,
  deleteSession,
  markAutoStart,
  nextStage,
  readSession,
  updateSession,
} from './state';
import {
  clarifyPrompt,
  gapsPrompt,
  intentPrompt,
  oneShotPrompt,
  researchPlannerPrompt,
  reviewPrompt,
  scopingPrompt,
  sourcesPrompt,
} from './prompts';
import { applyRubricPatch, parsePlannerReply, type ResearchQueryProposal } from './parse';
import { tavilySearch, type TavilyResult } from './tavily';

/**
 * Deep Plan orchestration. This file is the brains:
 *   - runPlannerTurn: user sends a message in the current stage → LLM reply,
 *     streams via broadcast(Chunk), stores both messages, applies rubric
 *     patches, returns the updated status.
 *   - runResearchLoop: triggered from stage 4 → asks planner for queries,
 *     runs Tavily, ingests winning results as sources, updates counters.
 *   - runOneShot: triggered from stage 7 → calls the generator model once
 *     with the full rubric + wiki, writes the draft into the active
 *     document, marks the session complete.
 *
 * All broadcasts fire `DeepPlan.Changed` after any state mutation so the
 * renderer re-fetches status.
 */

export {
  buildStatus,
  markAutoStart,
  clearAutoStart,
  shouldAutoStart,
  deleteSession,
} from './state';

const STAGE_PROMPT_BUILDERS: Record<
  DeepPlanStage,
  ((session: DeepPlanSession, sources: SourceMeta[]) => string) | null
> = {
  intent: () => intentPrompt(),
  sources: sourcesPrompt,
  scoping: scopingPrompt,
  gaps: gapsPrompt,
  research: researchPlannerPrompt,
  clarify: clarifyPrompt,
  review: reviewPrompt,
  handoff: null,
  done: null,
};

function notifyChanged(): void {
  broadcast(IpcChannels.DeepPlan.Changed);
}

function estimateTokensK(chars: number): number {
  // Rough: 4 chars per token → divide by 4000 to get K tokens.
  return chars / 4000;
}

function appendMessage(
  session: DeepPlanSession,
  role: DeepPlanMessage['role'],
  content: string,
  kind: DeepPlanMessage['kind'] = 'chat',
): DeepPlanSession {
  const msg: DeepPlanMessage = {
    id: randomUUID(),
    role,
    content,
    kind,
    timestamp: new Date().toISOString(),
  };
  return { ...session, messages: [...session.messages, msg] };
}

function llmHistoryFrom(session: DeepPlanSession): LlmMessage[] {
  return session.messages
    .filter((m) => m.kind === 'chat')
    .map((m) => ({
      role: m.role === 'system' ? 'user' : m.role,
      content: m.content,
    }));
}

async function requireKey(): Promise<string> {
  const key = await getOpenRouterKey();
  if (!key) {
    throw new Error('OpenRouter API key not set. Open Settings and add one.');
  }
  return key;
}

/* ------------------------------ Public API ------------------------------ */

export async function startSession(task: string): Promise<DeepPlanStatus> {
  if (!task.trim()) throw new Error('Task description cannot be empty.');
  await deleteSession();
  const session = await createSession(task);
  // Seed the conversation with an opening planner message so the user lands
  // on a populated chat column instead of a cold box.
  const opener = `Got it — "${session.task}". Drop any sources you already have into the panel on the left, and tell me if there's anything you want me to pay special attention to. Hit Continue when you're ready to scope.`;
  const withOpener = appendMessage(session, 'assistant', opener);
  const moved: DeepPlanSession = { ...withOpener, stage: 'sources' };
  await updateSession(() => moved);
  notifyChanged();
  return buildStatus();
}

export async function sendUserMessage(text: string): Promise<DeepPlanStatus> {
  const session = await readSession();
  if (!session) throw new Error('No Deep Plan session is active.');
  if (!text.trim()) return buildStatus();

  const builder = STAGE_PROMPT_BUILDERS[session.stage];
  if (!builder) {
    // In a terminal stage, just append the user turn.
    await updateSession((s) => appendMessage(s, 'user', text));
    notifyChanged();
    return buildStatus();
  }

  const sources = await listSources();
  const systemPrompt = builder(session, sources);

  const withUser = appendMessage(session, 'user', text);
  await updateSession(() => withUser);
  notifyChanged();

  const key = await requireKey();
  const model = await getDeepPlanModel();

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    ...llmHistoryFrom(withUser),
  ];

  let fullContent = '';
  try {
    fullContent = await streamChat({
      apiKey: key,
      model,
      messages,
      logScope: 'deep-plan',
      onChunk: (chunk) => broadcast(IpcChannels.DeepPlan.Chunk, chunk),
    });
  } catch (err) {
    logError('deep-plan', 'planner.stream.failed', err);
    broadcast(IpcChannels.DeepPlan.ChunkDone);
    const errMsg = `I hit an error talking to the planner model: ${(err as Error).message}. You can try again or hit Skip.`;
    await updateSession((s) => appendMessage(s, 'assistant', errMsg));
    notifyChanged();
    return buildStatus();
  }

  broadcast(IpcChannels.DeepPlan.ChunkDone);

  const parsed = parsePlannerReply(fullContent);
  const chatBody = parsed.chat || fullContent;
  const tokenCost =
    estimateTokensK(systemPrompt.length + fullContent.length) +
    withUser.messages.reduce((sum, m) => sum + estimateTokensK(m.content.length), 0);

  await updateSession((s) => {
    let next = appendMessage(s, 'assistant', chatBody);
    if (parsed.rubricPatch) {
      next = { ...next, rubric: applyRubricPatch(next.rubric, parsed.rubricPatch) };
    }
    next = { ...next, tokensUsedK: Math.max(next.tokensUsedK, tokenCost) };
    return next;
  });

  notifyChanged();
  return buildStatus();
}

export async function advanceStage(): Promise<DeepPlanStatus> {
  const session = await readSession();
  if (!session) throw new Error('No Deep Plan session is active.');
  const target = nextStage(session.stage);
  log('deep-plan', 'stage.advance', { from: session.stage, to: target });

  await updateSession((s) => ({
    ...s,
    stage: target,
    messages: [
      ...s.messages,
      {
        id: randomUUID(),
        role: 'system',
        content: `Moved to stage: ${target}`,
        kind: 'stage-transition',
        timestamp: new Date().toISOString(),
      },
    ],
  }));
  notifyChanged();

  // Auto-emit an opening planner message for the new stage so the user sees
  // something other than silence after hitting Continue.
  await primeStage(target);

  return buildStatus();
}

async function primeStage(stage: DeepPlanStage): Promise<void> {
  const session = await readSession();
  if (!session) return;
  const builder = STAGE_PROMPT_BUILDERS[stage];
  if (!builder) return;

  const sources = await listSources();
  const systemPrompt = builder(session, sources);
  const key = await requireKey();
  const model = await getDeepPlanModel();

  // The priming call reuses the full history so the model has full context,
  // but with a stage-specific opener to nudge it.
  const opener: LlmMessage = {
    role: 'user',
    content: `[stage: ${stage}] Begin this stage now. Address me directly.`,
  };

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    ...llmHistoryFrom(session),
    opener,
  ];

  let content = '';
  try {
    content = await streamChat({
      apiKey: key,
      model,
      messages,
      logScope: 'deep-plan',
      onChunk: (chunk) => broadcast(IpcChannels.DeepPlan.Chunk, chunk),
    });
  } catch (err) {
    logError('deep-plan', 'planner.prime.failed', err, { stage });
    broadcast(IpcChannels.DeepPlan.ChunkDone);
    return;
  }
  broadcast(IpcChannels.DeepPlan.ChunkDone);

  const parsed = parsePlannerReply(content);
  const chatBody = parsed.chat || content;

  await updateSession((s) => {
    let next = appendMessage(s, 'assistant', chatBody);
    if (parsed.rubricPatch) {
      next = { ...next, rubric: applyRubricPatch(next.rubric, parsed.rubricPatch) };
    }
    next = {
      ...next,
      tokensUsedK: next.tokensUsedK + estimateTokensK(systemPrompt.length + content.length),
    };
    return next;
  });
  notifyChanged();
}

export async function runResearchLoop(): Promise<DeepPlanStatus> {
  const session = await readSession();
  if (!session) throw new Error('No Deep Plan session is active.');
  if (session.stage !== 'research') {
    log('deep-plan', 'research.skipNotInStage', { stage: session.stage });
    return buildStatus();
  }

  const tavilyKey = await getTavilyKey();
  if (!tavilyKey) {
    await updateSession((s) =>
      appendMessage(
        s,
        'assistant',
        'I need a Tavily API key to run web research. Open Settings and add one, then hit Run Research again. You can also just Skip this stage if you have enough sources already.',
      ),
    );
    notifyChanged();
    return buildStatus();
  }

  const key = await requireKey();
  const model = await getDeepPlanModel();
  const sources = await listSources();

  // Ask the planner for the next batch of queries.
  const plannerSystem = researchPlannerPrompt(session, sources);
  const plannerMessages: LlmMessage[] = [
    { role: 'system', content: plannerSystem },
    { role: 'user', content: 'Propose the next queries now.' },
  ];

  const rawPlan = await completeText({
    apiKey: key,
    model,
    messages: plannerMessages,
    logScope: 'deep-plan',
  });
  if (rawPlan === null) {
    await updateSession((s) =>
      appendMessage(
        s,
        'assistant',
        'The planner model did not respond. Try again, or skip to the next stage.',
      ),
    );
    notifyChanged();
    return buildStatus();
  }

  const parsed = parsePlannerReply(rawPlan);
  const plan = parsed.researchPlan ?? [];
  log('deep-plan', 'research.planned', { count: plan.length });

  if (plan.length === 0) {
    await updateSession((s) =>
      appendMessage(
        s,
        'assistant',
        'I think we have enough. Hit Continue to move on to clarification questions.',
      ),
    );
    notifyChanged();
    return buildStatus();
  }

  let tokensThisLoop = estimateTokensK(plannerSystem.length + rawPlan.length);

  for (const proposal of plan.slice(0, 3)) {
    const ingested = await runOneQuery(proposal, tavilyKey);
    tokensThisLoop += estimateTokensK(
      ingested.reduce((sum, r) => sum + r.content.length + (r.rawContent?.length ?? 0), 0),
    );
    await updateSession((s) => {
      const record = {
        query: proposal.query,
        rationale: proposal.rationale,
        resultsSeen: ingested.length,
        ingestedSlugs: ingested.map((r) => r.url),
        timestamp: new Date().toISOString(),
      };
      const note = `Searched **${proposal.query}** — added ${ingested.length} source${
        ingested.length === 1 ? '' : 's'
      } to the wiki.${
        proposal.rationale ? `\n\n_Why:_ ${proposal.rationale}` : ''
      }`;
      return {
        ...s,
        researchQueries: [...s.researchQueries, record],
        messages: [
          ...s.messages,
          {
            id: randomUUID(),
            role: 'assistant',
            content: note,
            kind: 'research-note',
            timestamp: new Date().toISOString(),
          },
        ],
      };
    });
    notifyChanged();
  }

  await updateSession((s) => ({
    ...s,
    tokensUsedK: s.tokensUsedK + tokensThisLoop,
  }));
  notifyChanged();

  return buildStatus();
}

async function runOneQuery(
  proposal: ResearchQueryProposal,
  tavilyKey: string,
): Promise<TavilyResult[]> {
  const resp = await tavilySearch({ apiKey: tavilyKey, query: proposal.query, maxResults: 4 });
  if (!resp || resp.results.length === 0) return [];

  const top = resp.results.slice(0, 3);
  const ingested: TavilyResult[] = [];
  for (const result of top) {
    const body = result.rawContent || result.content;
    if (!body || body.length < 200) continue;
    try {
      const title = `${result.title} (${new URL(result.url).hostname})`;
      await ingestText(`Source URL: ${result.url}\n\n${body}`, title);
      ingested.push(result);
    } catch (err) {
      logError('deep-plan', 'research.ingestFailed', err, { url: result.url });
    }
  }
  return ingested;
}

export async function skipSession(): Promise<DeepPlanStatus> {
  const session = await readSession();
  if (session) {
    await updateSession((s) => ({ ...s, skipped: true, stage: 'done' }));
  }
  await clearAutoStart();
  notifyChanged();
  return buildStatus();
}

export async function resetSession(): Promise<DeepPlanStatus> {
  await deleteSession();
  await clearAutoStart();
  notifyChanged();
  return buildStatus();
}

export async function runOneShot(): Promise<DeepPlanStatus> {
  const session = await readSession();
  if (!session) throw new Error('No Deep Plan session is active.');

  const key = await requireKey();
  const model = await getDeepPlanModel();
  const sources = await listSources();

  // Pick the active document — for a new project there's only one, created
  // during scaffolding. If somehow there are multiple, take the first.
  const docs = await listDocuments();
  if (docs.length === 0) {
    throw new Error('No document to write into. Create one from the documents panel first.');
  }
  const target = docs[0]!;

  const prompt = oneShotPrompt(session, sources, target.label);
  const messages: LlmMessage[] = [
    { role: 'system', content: prompt },
    {
      role: 'user',
      content:
        'Write the full draft now. Output only the markdown of the draft itself — no preamble.',
    },
  ];

  log('deep-plan', 'oneshot.start', { doc: target.filename, model });

  let fullContent = '';
  try {
    fullContent = await streamChat({
      apiKey: key,
      model,
      messages,
      logScope: 'deep-plan',
      onChunk: (chunk) => broadcast(IpcChannels.DeepPlan.Chunk, chunk),
    });
  } catch (err) {
    logError('deep-plan', 'oneshot.failed', err);
    broadcast(IpcChannels.DeepPlan.ChunkDone);
    throw err;
  }
  broadcast(IpcChannels.DeepPlan.ChunkDone);

  // Overwrite the target document with the generated draft.
  const cleaned = fullContent.trim();
  if (cleaned.length === 0) {
    throw new Error('The generator returned an empty draft. Try again.');
  }
  await writeDocument(target.filename, cleaned);

  await updateSession((s) => ({
    ...s,
    stage: 'done',
    completed: true,
    tokensUsedK: s.tokensUsedK + estimateTokensK(prompt.length + fullContent.length),
  }));
  await clearAutoStart();
  broadcast(IpcChannels.Document.Changed);
  notifyChanged();
  return buildStatus();
}

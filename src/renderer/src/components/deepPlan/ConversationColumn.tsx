import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DeepPlanMessage, DeepPlanSession } from '@shared/types';
import { useDeepPlan } from '../../store/deepPlan';
import { useResearchEvents } from '../../store/researchEvents';
import { renderMarkdown } from '../../utils/markdown';
import { stripDeepPlanFences } from './stripFences';
import { ResearchGraph } from '../research/ResearchGraph';

function Markdown({ text }: { text: string }): JSX.Element {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className="dp-md" dangerouslySetInnerHTML={{ __html: html }} />;
}

interface Props {
  session: DeepPlanSession;
}

export function ConversationColumn({ session }: Props): JSX.Element {
  const {
    status,
    streaming,
    streamingBuffer,
    busy,
    sendMessage,
    addResearchHint,
  } = useDeepPlan();
  const [draft, setDraft] = useState('');
  const [steerAck, setSteerAck] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const researchEvents = useResearchEvents((s) => s.events);
  const researchRunning = status?.researchRunning ?? false;

  // Transient "✓ Steering: …" ack under the input — dismisses itself so
  // we don't have to manage clear-on-next-hint etc.
  useEffect(() => {
    if (!steerAck) return;
    const id = window.setTimeout(() => setSteerAck(null), 3200);
    return () => window.clearTimeout(id);
  }, [steerAck]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session.messages.length, streamingBuffer]);

  const stage = session.stage;
  const isResearchStage = stage === 'research';
  const isDone = stage === 'done';

  // During the research stage the single chat input becomes the steering
  // channel — submit it and it's added as a mid-run hint rather than a
  // normal chat turn.
  const handleSend = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const text = draft.trim();
      if (!text) return;
      if (isResearchStage) {
        if (!researchRunning) return;
        setDraft('');
        setSteerAck(text);
        await addResearchHint(text);
        return;
      }
      if (busy) return;
      setDraft('');
      await sendMessage(text);
    },
    [draft, busy, isResearchStage, researchRunning, sendMessage, addResearchHint],
  );

  // During research we hide the chat stream entirely. The graph IS the
  // view; the only affordance is the steer input pinned at the bottom.
  if (isResearchStage) {
    return (
      <div className="dp-chat dp-chat-research">
        <div className="dp-research-graph-full">
          <ResearchGraph
            events={researchEvents}
            rootLabel={session.task}
            running={researchRunning}
          />
        </div>
        <div className="dp-chat-footer">
          {steerAck && (
            <div className="dp-steer-ack" key={steerAck}>
              <span className="dp-steer-ack-mark">✓</span>
              <span className="dp-steer-ack-label">Steering:</span>
              <span className="dp-steer-ack-text">{steerAck}</span>
            </div>
          )}
          <form className="dp-chat-form" onSubmit={(e) => void handleSend(e)}>
            <textarea
              className="dp-chat-input"
              placeholder="Steer research…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend(e);
                }
              }}
              disabled={!researchRunning}
              rows={2}
            />
            <button
              type="submit"
              className="dp-btn"
              disabled={!researchRunning || draft.trim().length === 0}
            >
              Steer
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="dp-chat">
      <div className="dp-chat-scroll" ref={scrollRef}>
        {session.messages.length === 0 && !streaming && (
          <div className="dp-empty">Starting the Deep Plan conversation…</div>
        )}
        {session.messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (() => {
          const { visible, isWriting } = stripDeepPlanFences(streamingBuffer);
          return (
            <div className="dp-msg dp-msg-assistant">
              <div className="dp-msg-body">
                {visible && <Markdown text={visible} />}
                {(isWriting || !visible) && (
                  <div className="dp-typing">
                    <span className="generating-dots">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </span>
                    <span className="dp-muted"> {isWriting ? 'Planning…' : 'Thinking…'}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      <div className="dp-chat-footer">
        <form className="dp-chat-form" onSubmit={(e) => void handleSend(e)}>
          <textarea
            className="dp-chat-input"
            placeholder={isDone ? 'Deep Plan complete.' : 'Write a reply…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend(e);
              }
            }}
            disabled={isDone || busy}
            rows={2}
          />
          <button
            type="submit"
            className="dp-btn"
            disabled={isDone || draft.trim().length === 0 || busy}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: DeepPlanMessage }): JSX.Element {
  if (message.kind === 'stage-transition') {
    return (
      <div className="dp-stage-transition">
        <span>{message.content}</span>
      </div>
    );
  }
  if (message.kind === 'research-note') {
    return (
      <div className="dp-research-note">
        <div className="dp-research-note-body">
          <Markdown text={message.content} />
        </div>
      </div>
    );
  }
  const klass = message.role === 'user' ? 'dp-msg dp-msg-user' : 'dp-msg dp-msg-assistant';
  const { visible } = stripDeepPlanFences(message.content);
  return (
    <div className={klass}>
      <div className="dp-msg-body">
        <Markdown text={visible || message.content} />
      </div>
    </div>
  );
}

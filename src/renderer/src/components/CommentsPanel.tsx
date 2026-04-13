import { useCallback, useEffect, useRef, useState } from 'react';
import type { Comment, ThreadMessage } from '@shared/types';
import { useComments } from '../store/comments';
import { usePendingEdits } from '../store/pendingEdits';
import { bridge } from '../api/bridge';

interface CommentsPanelProps {
  activeFile: string;
}

export function CommentsPanel({ activeFile }: CommentsPanelProps): JSX.Element | null {
  const comments = useComments((s) => s.comments);
  const expandedId = useComments((s) => s.expandedId);
  const setExpanded = useComments((s) => s.setExpanded);
  const deleteComment = useComments((s) => s.delete);
  const resolveComment = useComments((s) => s.resolve);
  const reopenComment = useComments((s) => s.reopen);
  const editsCount = usePendingEdits((s) => s.edits.length);

  const openComments = comments.filter((c) => c.state !== 'resolved');
  const resolvedComments = comments.filter((c) => c.state === 'resolved');

  const openCount = openComments.length;
  const [showResolved, setShowResolved] = useState(false);

  if (comments.length === 0) {
    return null;
  }

  const handleActionAll = async (): Promise<void> => {
    const ids = openComments.filter((c) => c.state === 'open').map((c) => c.id);
    if (ids.length === 0) return;
    try {
      await bridge.chat.actionComments(ids, activeFile);
    } catch (err) {
      console.error('action comments failed', err);
    }
  };

  return (
    <div className="comments-panel">
      <div className="comments-header">
        <h3>Comments</h3>
        <span className="comments-count">{openCount} open</span>
      </div>

      {openCount > 0 && editsCount === 0 && (
        <button
          type="button"
          className="comments-action-all"
          onClick={() => void handleActionAll()}
          title="Ask Myst to action all open comments"
        >
          Action all with Myst
        </button>
      )}

      <div className="comments-list">
        {openComments.map((comment) => (
          <CommentCard
            key={comment.id}
            comment={comment}
            expanded={expandedId === comment.id}
            onToggle={() => setExpanded(expandedId === comment.id ? null : comment.id)}
            onDelete={() => void deleteComment(comment.id)}
            onResolve={() => void resolveComment(comment.id)}
          />
        ))}

        {resolvedComments.length > 0 && (
          <button
            type="button"
            className="comments-resolved-toggle"
            onClick={() => setShowResolved((v) => !v)}
          >
            {showResolved ? 'Hide' : 'Show'} resolved ({resolvedComments.length})
          </button>
        )}

        {showResolved &&
          resolvedComments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              expanded={expandedId === comment.id}
              onToggle={() => setExpanded(expandedId === comment.id ? null : comment.id)}
              onDelete={() => void deleteComment(comment.id)}
              onReopen={() => void reopenComment(comment.id)}
            />
          ))}
      </div>
    </div>
  );
}

interface CommentCardProps {
  comment: Comment;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onResolve?: () => void;
  onReopen?: () => void;
}

function CommentCard({
  comment,
  expanded,
  onToggle,
  onDelete,
  onResolve,
  onReopen,
}: CommentCardProps): JSX.Element {
  const stateClass =
    comment.state === 'resolved'
      ? 'comment-card-resolved'
      : comment.state === 'orphaned'
        ? 'comment-card-orphaned'
        : '';

  return (
    <div className={`comment-card ${stateClass} ${expanded ? 'comment-card-expanded' : ''}`}>
      <div className="comment-card-head" onClick={onToggle}>
        <div className="comment-card-quote">"{truncate(comment.text, 80)}"</div>
        <div className="comment-card-message">{truncate(comment.message, 120)}</div>
      </div>

      {expanded && (
        <div className="comment-card-body">
          {comment.thread.length > 0 && <CommentThreadView thread={comment.thread} />}

          {comment.state === 'open' && <CommentThreadInput commentId={comment.id} />}

          <div className="comment-card-actions">
            {comment.state === 'open' && onResolve && (
              <button type="button" className="comment-action" onClick={onResolve}>
                Resolve
              </button>
            )}
            {comment.state === 'resolved' && onReopen && (
              <button type="button" className="comment-action" onClick={onReopen}>
                Reopen
              </button>
            )}
            <button type="button" className="comment-action danger" onClick={onDelete}>
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentThreadView({ thread }: { thread: ThreadMessage[] }): JSX.Element {
  return (
    <div className="comment-thread">
      {thread.map((msg, i) => (
        <div key={i} className={`comment-thread-msg comment-thread-${msg.role}`}>
          <div className="comment-thread-role">{msg.role === 'user' ? 'You' : 'Myst'}</div>
          <div className="comment-thread-content">{msg.content}</div>
        </div>
      ))}
    </div>
  );
}

function CommentThreadInput({ commentId }: { commentId: string }): JSX.Element {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(async () => {
    const text = value.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await bridge.chat.sendInCommentThread(commentId, text);
      setValue('');
    } catch (err) {
      console.error('thread send failed', err);
    } finally {
      setSending(false);
    }
  }, [commentId, value, sending]);

  useEffect(() => {
    ref.current?.focus();
  }, [commentId]);

  return (
    <div className="comment-thread-input">
      <textarea
        ref={ref}
        placeholder="Ask Myst about this…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        rows={2}
        disabled={sending}
      />
      <button
        type="button"
        className="comment-action primary"
        onClick={() => void handleSend()}
        disabled={sending || !value.trim()}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

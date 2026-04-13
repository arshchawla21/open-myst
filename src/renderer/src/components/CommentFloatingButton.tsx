import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useComments } from '../store/comments';

interface CommentFloatingButtonProps {
  editor: Editor | null;
  disabled: boolean;
}

interface Position {
  top: number;
  left: number;
}

interface SelectionSnapshot {
  text: string;
  contextBefore: string;
  contextAfter: string;
}

const CONTEXT_CHARS = 24;

function buildSnapshot(editor: Editor): SelectionSnapshot | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const text = editor.state.doc.textBetween(from, to, '\n');
  if (!text.trim()) return null;

  const beforeFrom = Math.max(0, from - CONTEXT_CHARS);
  const afterTo = Math.min(editor.state.doc.content.size, to + CONTEXT_CHARS);
  const contextBefore = editor.state.doc.textBetween(beforeFrom, from, '\n');
  const contextAfter = editor.state.doc.textBetween(to, afterTo, '\n');
  return { text, contextBefore, contextAfter };
}

export function CommentFloatingButton({
  editor,
  disabled,
}: CommentFloatingButtonProps): JSX.Element | null {
  const [position, setPosition] = useState<Position | null>(null);
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null);
  const [composing, setComposing] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const createComment = useComments((s) => s.create);
  const setExpanded = useComments((s) => s.setExpanded);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editor || disabled) {
      setPosition(null);
      setSnapshot(null);
      setComposing(false);
      return;
    }

    const handler = (): void => {
      if (composing) return;
      const snap = buildSnapshot(editor);
      if (!snap) {
        setPosition(null);
        setSnapshot(null);
        return;
      }
      const { from, to } = editor.state.selection;
      try {
        const startCoords = editor.view.coordsAtPos(from);
        const endCoords = editor.view.coordsAtPos(to);
        const top = Math.min(startCoords.top, endCoords.top) - 44;
        const left = (startCoords.left + endCoords.right) / 2;
        setPosition({ top, left });
        setSnapshot(snap);
      } catch {
        setPosition(null);
        setSnapshot(null);
      }
    };

    editor.on('selectionUpdate', handler);
    editor.on('blur', () => {
      // Small delay so clicking the button still works
      setTimeout(() => {
        if (!composing) {
          setPosition(null);
        }
      }, 200);
    });
    return () => {
      editor.off('selectionUpdate', handler);
    };
  }, [editor, disabled, composing]);

  useEffect(() => {
    if (composing) {
      textareaRef.current?.focus();
    }
  }, [composing]);

  const handleStart = useCallback(() => {
    if (!snapshot) return;
    setComposing(true);
  }, [snapshot]);

  const handleCancel = useCallback(() => {
    setComposing(false);
    setMessage('');
    setPosition(null);
    setSnapshot(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!snapshot || !message.trim() || busy) return;
    setBusy(true);
    try {
      const comment = await createComment({
        text: snapshot.text,
        contextBefore: snapshot.contextBefore,
        contextAfter: snapshot.contextAfter,
        message: message.trim(),
      });
      setMessage('');
      setComposing(false);
      setPosition(null);
      setSnapshot(null);
      if (comment) setExpanded(comment.id);
    } catch (err) {
      console.error('create comment failed', err);
    } finally {
      setBusy(false);
    }
  }, [snapshot, message, busy, createComment, setExpanded]);

  if (!position || !snapshot) return null;

  const style = {
    top: `${position.top}px`,
    left: `${position.left}px`,
  };

  if (composing) {
    return (
      <div className="comment-composer" style={style}>
        <textarea
          ref={textareaRef}
          className="comment-composer-input"
          placeholder="Add a comment…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') handleCancel();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          rows={3}
        />
        <div className="comment-composer-actions">
          <button type="button" className="comment-action" onClick={handleCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="comment-action primary"
            onClick={() => void handleSubmit()}
            disabled={busy || !message.trim()}
          >
            Comment
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="comment-floating-btn"
      style={style}
      onMouseDown={(e) => e.preventDefault()}
      onClick={handleStart}
      title="Add comment"
    >
      Comment
    </button>
  );
}

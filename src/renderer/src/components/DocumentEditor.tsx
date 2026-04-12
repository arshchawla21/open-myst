import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import { clipboard } from '@milkdown/kit/plugin/clipboard';
import { cursor } from '@milkdown/kit/plugin/cursor';
import { trailing } from '@milkdown/kit/plugin/trailing';
import { Milkdown, MilkdownProvider, useEditor, useInstance } from '@milkdown/react';
import type { Node as PmNode } from '@milkdown/kit/prose/model';
import { bridge } from '../api/bridge';
import { EditorToolbar } from './EditorToolbar';
import { useHeadings } from '../store/headings';
import type { Heading } from '@shared/types';

const FONT_SIZE_STORAGE_KEY = 'myst:font-size';
const DEFAULT_FONT_SIZE = 18;

function loadFontSize(): number {
  if (typeof window === 'undefined') return DEFAULT_FONT_SIZE;
  const raw = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FONT_SIZE;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTOSAVE_DELAY_MS = 500;

interface EditorViewProps {
  initialValue: string;
  onChange: (markdown: string) => void;
}

function EditorView({ initialValue, onChange }: EditorViewProps): JSX.Element {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEditor(
    (root) =>
      Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialValue);
          ctx.get(listenerCtx).markdownUpdated((_, markdown, prev) => {
            if (markdown === prev) return;
            onChangeRef.current(markdown);
          });
        })
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(listener)
        .use(clipboard)
        .use(cursor)
        .use(trailing),
    [],
  );

  return <Milkdown />;
}

function extractHeadings(doc: PmNode): Heading[] {
  const result: Heading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      result.push({ level: node.attrs['level'] as number, text: node.textContent, pos });
    }
  });
  return result;
}

function HeadingsExtractor(): null {
  const [loading, getEditor] = useInstance();
  const { setHeadings, scrollToPos, clearScroll } = useHeadings();
  const prevJson = useRef('');

  const sync = useCallback(() => {
    if (loading) return;
    const editor = getEditor();
    if (!editor) return;
    try {
      const view = editor.ctx.get(editorViewCtx);
      const headings = extractHeadings(view.state.doc);
      const json = JSON.stringify(headings);
      if (json !== prevJson.current) {
        prevJson.current = json;
        setHeadings(headings);
      }
    } catch {
      // editor not ready
    }
  }, [loading, getEditor, setHeadings]);

  useEffect(() => {
    sync();
    const id = setInterval(sync, 800);
    return () => clearInterval(id);
  }, [sync]);

  useEffect(() => {
    if (scrollToPos === null || loading) return;
    const editor = getEditor();
    if (!editor) return;
    try {
      const view = editor.ctx.get(editorViewCtx);
      const dom = view.domAtPos(scrollToPos);
      const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearScroll();
    } catch {
      clearScroll();
    }
  }, [scrollToPos, loading, getEditor, clearScroll]);

  return null;
}

interface DocumentEditorProps {
  projectPath: string;
}

export function DocumentEditor({ projectPath }: DocumentEditorProps): JSX.Element {
  const [initialValue, setInitialValue] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [fontSize, setFontSize] = useState<number>(loadFontSize);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    let cancelled = false;
    setInitialValue(null);
    setLoadError(null);
    bridge.document
      .read()
      .then((content) => {
        if (cancelled) return;
        lastSavedRef.current = content;
        setInitialValue(content);
        setStatus('saved');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoadError(err.message);
      });
    return () => {
      cancelled = true;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [projectPath]);

  const scheduleSave = (markdown: string): void => {
    if (markdown === lastSavedRef.current) return;
    setStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      bridge.document
        .write(markdown)
        .then(() => {
          lastSavedRef.current = markdown;
          setStatus('saved');
        })
        .catch((err: Error) => {
          console.error('document write failed', err);
          setStatus('error');
        });
    }, AUTOSAVE_DELAY_MS);
  };

  const surfaceStyle = { '--doc-font-size': `${fontSize}px` } as CSSProperties;

  if (loadError) {
    return (
      <div className="document-editor" style={surfaceStyle}>
        <div className="document-error">
          <p>Could not load document: {loadError}</p>
        </div>
      </div>
    );
  }

  if (initialValue === null) {
    return (
      <div className="document-editor" style={surfaceStyle}>
        <div className="document-loading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="document-editor" style={surfaceStyle}>
      <MilkdownProvider>
        <EditorToolbar fontSize={fontSize} onFontSize={setFontSize} />
        <HeadingsExtractor />
        <div className="document-scroll">
          <div className="document-page">
            <EditorView
              key={projectPath}
              initialValue={initialValue}
              onChange={scheduleSave}
            />
          </div>
        </div>
      </MilkdownProvider>
      <SaveIndicator status={status} />
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }): JSX.Element | null {
  if (status === 'idle') return null;
  const label =
    status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save failed';
  return <div className={`save-indicator save-${status}`}>{label}</div>;
}

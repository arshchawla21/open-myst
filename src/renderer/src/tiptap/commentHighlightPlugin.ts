import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { Comment } from '@shared/types';

export const commentHighlightKey = new PluginKey<{ decorations: DecorationSet }>('commentHighlight');

function findCommentRange(doc: PmNode, comment: Comment): { from: number; to: number } | null {
  if (!comment.text) return null;
  let found: { from: number; to: number } | null = null;

  const combined = `${comment.contextBefore}${comment.text}${comment.contextAfter}`;

  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isText || !node.text) return;

    // Try with full context first (most reliable)
    if (combined.length > 0 && node.text.includes(combined)) {
      const idx = node.text.indexOf(combined);
      const start = pos + idx + comment.contextBefore.length;
      found = { from: start, to: start + comment.text.length };
      return false;
    }

    // Fallback: just the text
    if (node.text.includes(comment.text)) {
      const idx = node.text.indexOf(comment.text);
      found = { from: pos + idx, to: pos + idx + comment.text.length };
      return false;
    }
    return undefined;
  });

  return found;
}

function buildDecorations(doc: PmNode, comments: Comment[]): DecorationSet {
  const decos: Decoration[] = [];
  for (const comment of comments) {
    if (comment.state === 'resolved') continue;
    const range = findCommentRange(doc, comment);
    if (!range) continue;
    const cls = comment.state === 'orphaned' ? 'comment-highlight comment-orphaned' : 'comment-highlight';
    decos.push(
      Decoration.inline(range.from, range.to, {
        class: cls,
        'data-comment-id': comment.id,
      }),
    );
  }
  return DecorationSet.create(doc, decos);
}

export function createCommentHighlightExtension(): Extension {
  return Extension.create({
    name: 'commentHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin<{ decorations: DecorationSet }>({
          key: commentHighlightKey,
          state: {
            init() {
              return { decorations: DecorationSet.empty };
            },
            apply(tr, old) {
              const meta = tr.getMeta(commentHighlightKey) as Comment[] | undefined;
              if (meta !== undefined) {
                return { decorations: buildDecorations(tr.doc, meta) };
              }
              return { decorations: old.decorations.map(tr.mapping, tr.doc) };
            },
          },
          props: {
            decorations(state) {
              return commentHighlightKey.getState(state)?.decorations ?? DecorationSet.empty;
            },
          },
        }),
      ];
    },
  });
}

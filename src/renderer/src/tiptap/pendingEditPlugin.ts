import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import MarkdownIt from 'markdown-it';
import type { PendingEdit } from '@shared/types';

const widgetMd = new MarkdownIt({ html: false, linkify: true, breaks: true });

export const pendingEditsKey = new PluginKey<PendingEditsState>('pendingEdits');

interface PendingEditsState {
  decorations: DecorationSet;
  renderableIds: Set<string>;
}

function findPendingEditRange(
  doc: PmNode,
  oldString: string,
  occurrence: number,
): { from: number; to: number } | null {
  if (oldString === '') return null;
  let remaining = occurrence;
  let found: { from: number; to: number } | null = null;

  doc.descendants((node, pos) => {
    if (found) return false;
    if (!node.isText || !node.text) return;
    const text = node.text;
    let searchFrom = 0;
    while (true) {
      const idx = text.indexOf(oldString, searchFrom);
      if (idx === -1) break;
      remaining--;
      if (remaining === 0) {
        found = { from: pos + idx, to: pos + idx + oldString.length };
        return false;
      }
      searchFrom = idx + oldString.length;
    }
    return undefined;
  });

  return found;
}

function buildDecorations(doc: PmNode, edits: PendingEdit[]): PendingEditsState {
  const decos: Decoration[] = [];
  const renderableIds = new Set<string>();

  const widgetSpec = {
    stopEvent: () => true,
    ignoreSelection: true,
  };

  for (const edit of edits) {
    if (edit.oldString === '') {
      // Append-at-end edits get a widget at the doc end
      const widget = Decoration.widget(
        doc.content.size,
        () => buildInsertWidget(edit, true),
        { key: `pending-${edit.id}`, side: 1, ...widgetSpec },
      );
      decos.push(widget);
      renderableIds.add(edit.id);
      continue;
    }

    const range = findPendingEditRange(doc, edit.oldString, edit.occurrence);
    if (!range) continue;

    decos.push(
      Decoration.inline(range.from, range.to, {
        class: 'pending-delete',
        'data-pending-id': edit.id,
      }),
    );
    decos.push(
      Decoration.widget(range.to, () => buildInsertWidget(edit, false), {
        key: `pending-${edit.id}`,
        side: 1,
        ...widgetSpec,
      }),
    );
    renderableIds.add(edit.id);
  }

  return {
    decorations: DecorationSet.create(doc, decos),
    renderableIds,
  };
}

function buildInsertWidget(edit: PendingEdit, isAppend: boolean): HTMLElement {
  const container = document.createElement(isAppend ? 'div' : 'span');
  container.className = isAppend ? 'pending-insert pending-insert-append' : 'pending-insert';
  container.dataset['pendingId'] = edit.id;
  container.contentEditable = 'false';

  const text = document.createElement(isAppend ? 'div' : 'span');
  text.className = 'pending-insert-text';
  if (isAppend) {
    text.innerHTML = widgetMd.render(edit.newString);
  } else {
    text.innerHTML = widgetMd.renderInline(edit.newString);
  }
  container.appendChild(text);

  const actions = document.createElement(isAppend ? 'div' : 'span');
  actions.className = 'pending-actions';
  actions.contentEditable = 'false';

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'pending-action pending-accept';
  acceptBtn.textContent = 'Accept';
  acceptBtn.dataset['pendingAction'] = 'accept';
  acceptBtn.dataset['pendingId'] = edit.id;

  const rejectBtn = document.createElement('button');
  rejectBtn.type = 'button';
  rejectBtn.className = 'pending-action pending-reject';
  rejectBtn.textContent = 'Reject';
  rejectBtn.dataset['pendingAction'] = 'reject';
  rejectBtn.dataset['pendingId'] = edit.id;

  const discussBtn = document.createElement('button');
  discussBtn.type = 'button';
  discussBtn.className = 'pending-action pending-discuss';
  discussBtn.textContent = 'Discuss';
  discussBtn.dataset['pendingAction'] = 'discuss';
  discussBtn.dataset['pendingId'] = edit.id;

  actions.appendChild(acceptBtn);
  actions.appendChild(rejectBtn);
  actions.appendChild(discussBtn);
  container.appendChild(actions);

  return container;
}

export function createPendingEditsExtension(): Extension {
  return Extension.create({
    name: 'pendingEdits',
    addProseMirrorPlugins() {
      return [
        new Plugin<PendingEditsState>({
          key: pendingEditsKey,
          state: {
            init() {
              return { decorations: DecorationSet.empty, renderableIds: new Set() };
            },
            apply(tr, old) {
              const meta = tr.getMeta(pendingEditsKey) as PendingEdit[] | undefined;
              if (meta !== undefined) {
                return buildDecorations(tr.doc, meta);
              }
              return {
                decorations: old.decorations.map(tr.mapping, tr.doc),
                renderableIds: old.renderableIds,
              };
            },
          },
          props: {
            decorations(state) {
              return pendingEditsKey.getState(state)?.decorations ?? DecorationSet.empty;
            },
          },
        }),
      ];
    },
  });
}

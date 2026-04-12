import { useCallback, useEffect, useState } from 'react';
import type { SourceMeta } from '@shared/types';
import { bridge } from '../api/bridge';

export function SourcesPanel(): JSX.Element {
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [dragging, setDragging] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const loadSources = useCallback(() => {
    bridge.sources.list().then(setSources).catch(console.error);
  }, []);

  useEffect(() => {
    loadSources();
    const off = bridge.sources.onChanged(loadSources);
    return off;
  }, [loadSources]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files);
      const paths = files
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => !!p);
      if (paths.length === 0) return;
      setIngesting(true);
      try {
        await bridge.sources.ingest(paths);
      } catch (err) {
        console.error('Source ingestion failed:', err);
      } finally {
        setIngesting(false);
      }
    },
    [],
  );

  const handleDelete = useCallback(async (slug: string) => {
    await bridge.sources.delete(slug);
  }, []);

  return (
    <div
      className={`sources-panel${dragging ? ' sources-dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => void handleDrop(e)}
    >
      <h2>Sources</h2>

      {sources.length === 0 && !ingesting && (
        <div className="drop-hint">
          <p>Drop PDFs or markdown files here.</p>
        </div>
      )}

      {ingesting && (
        <div className="source-ingesting">
          <span className="generating-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
          {' '}Ingesting…
        </div>
      )}

      {sources.length > 0 && (
        <ul className="source-list">
          {sources.map((s) => (
            <li key={s.slug} className="source-item">
              <div className="source-item-header">
                <span className="source-name" title={s.originalName}>
                  {s.originalName}
                </span>
                <button
                  type="button"
                  className="source-delete"
                  title="Remove source"
                  onClick={() => void handleDelete(s.slug)}
                >
                  &#x2715;
                </button>
              </div>
              <div className="source-summary">{s.summary}</div>
            </li>
          ))}
        </ul>
      )}

      {sources.length > 0 && (
        <div className="drop-hint drop-hint-small">
          <p>Drop more files to add.</p>
        </div>
      )}
    </div>
  );
}

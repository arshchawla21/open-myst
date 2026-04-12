import { useCallback, useState } from 'react';
import { useDocuments } from '../store/documents';

export function DocumentFiles(): JSX.Element {
  const { files, activeFile, setActive, createFile, deleteFile } = useDocuments();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;
    await createFile(name);
    setNewName('');
    setAdding(false);
  }, [newName, createFile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void handleCreate();
      }
      if (e.key === 'Escape') {
        setAdding(false);
        setNewName('');
      }
    },
    [handleCreate],
  );

  return (
    <div className="docfiles-panel">
      <div className="docfiles-header">
        <h2>Documents</h2>
        <button
          type="button"
          className="docfiles-add-btn"
          title="New document"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>

      {adding && (
        <div className="docfiles-new">
          <input
            type="text"
            className="docfiles-new-input"
            placeholder="Document name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!newName.trim()) setAdding(false);
            }}
            autoFocus
          />
        </div>
      )}

      <nav className="docfiles-list">
        {files.map((f) => (
          <div
            key={f.filename}
            className={`docfiles-item${f.filename === activeFile ? ' docfiles-item-active' : ''}`}
          >
            <button
              type="button"
              className="docfiles-item-btn"
              onClick={() => setActive(f.filename)}
            >
              {f.label}
            </button>
            {files.length > 1 && (
              <button
                type="button"
                className="docfiles-item-delete"
                title="Delete document"
                onClick={() => void deleteFile(f.filename)}
              >
                &#x2715;
              </button>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}

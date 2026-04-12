import { useApp } from '../store/app';

export function DocumentPanel(): JSX.Element {
  const { project } = useApp();

  return (
    <div className="document-panel">
      <div className="document-placeholder">
        <h2>{project?.name ?? 'Untitled'}</h2>
        <p className="muted">Milkdown editor loads here in Phase 1.</p>
      </div>
    </div>
  );
}

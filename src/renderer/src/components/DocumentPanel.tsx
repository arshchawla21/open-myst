import { useApp } from '../store/app';
import { useDocuments } from '../store/documents';
import { DocumentEditor } from './DocumentEditor';
import { ErrorBoundary } from './ErrorBoundary';

export function DocumentPanel(): JSX.Element {
  const { project } = useApp();
  const activeFile = useDocuments((s) => s.activeFile);

  if (!project) {
    return (
      <div className="document-panel">
        <div className="document-placeholder">
          <p className="muted">No project open.</p>
        </div>
      </div>
    );
  }

  if (!activeFile) {
    return (
      <div className="document-panel">
        <div className="document-placeholder">
          <p className="muted">No document selected.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="document-panel">
      <ErrorBoundary>
        <DocumentEditor projectPath={project.path} activeFile={activeFile} />
      </ErrorBoundary>
    </div>
  );
}

import { useApp } from '../store/app';
import { SourcesPanel } from './SourcesPanel';
import { DocumentPanel } from './DocumentPanel';
import { ChatPanel } from './ChatPanel';
import { TableOfContents } from './TableOfContents';

export function Layout(): JSX.Element {
  const { project, openSettings, closeProject } = useApp();

  return (
    <div className="layout">
      <header className="titlebar">
        <div className="titlebar-left">
          <span className="app-name">Myst Review</span>
          {project && <span className="project-name">· {project.name}</span>}
        </div>
        <div className="titlebar-right">
          <button type="button" className="link" onClick={openSettings}>
            Settings
          </button>
          <button type="button" className="link" onClick={() => void closeProject()}>
            Close project
          </button>
        </div>
      </header>
      <main className="panes">
        <aside className="pane pane-left">
          <SourcesPanel />
        </aside>
        <section className="pane pane-center">
          <DocumentPanel />
        </section>
        <aside className="pane pane-right">
          <ChatPanel />
          <TableOfContents />
        </aside>
      </main>
    </div>
  );
}

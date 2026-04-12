import { useApp } from '../store/app';

export function Welcome(): JSX.Element {
  const { createNewProject, openExistingProject, openSettings, settings, loading } = useApp();

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Myst Review</h1>
        <p className="welcome-tagline">A writing and research companion.</p>

        <div className="welcome-actions">
          <button
            type="button"
            className="primary"
            onClick={() => void createNewProject()}
            disabled={loading}
          >
            New project
          </button>
          <button
            type="button"
            onClick={() => void openExistingProject()}
            disabled={loading}
          >
            Open project
          </button>
        </div>

        <div className="welcome-footer">
          <button type="button" className="link" onClick={openSettings}>
            Settings
          </button>
          {settings && !settings.hasOpenRouterKey && (
            <span className="hint">Set your OpenRouter API key in Settings before chatting.</span>
          )}
        </div>
      </div>
    </div>
  );
}

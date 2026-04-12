import { useApp } from '../store/app';

export function ChatPanel(): JSX.Element {
  const { settings, openSettings } = useApp();
  const needsKey = settings && !settings.hasOpenRouterKey;

  return (
    <div className="chat-panel">
      <h2>Chat</h2>
      {needsKey ? (
        <div className="muted">
          <p>Set your OpenRouter API key to start chatting.</p>
          <button type="button" className="link" onClick={openSettings}>
            Open Settings
          </button>
        </div>
      ) : (
        <p className="muted">Chat wired up in Phase 2.</p>
      )}
    </div>
  );
}

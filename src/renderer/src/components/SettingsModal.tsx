import { useEffect, useState } from 'react';
import { useApp } from '../store/app';
import { bridge } from '../api/bridge';

export function SettingsModal(): JSX.Element {
  const { settings, closeSettings, refreshSettings } = useApp();
  const [key, setKey] = useState('');
  const [model, setModel] = useState(settings?.defaultModel ?? '');
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setModel(settings.defaultModel);
  }, [settings]);

  const saveKey = async (): Promise<void> => {
    setLocalError(null);
    setSaving(true);
    try {
      await bridge.settings.setOpenRouterKey(key);
      setKey('');
      await refreshSettings();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async (): Promise<void> => {
    setSaving(true);
    try {
      await bridge.settings.clearOpenRouterKey();
      await refreshSettings();
    } finally {
      setSaving(false);
    }
  };

  const saveModel = async (): Promise<void> => {
    setLocalError(null);
    setSaving(true);
    try {
      await bridge.settings.setDefaultModel(model);
      await refreshSettings();
    } catch (err) {
      setLocalError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={closeSettings}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="link" onClick={closeSettings}>
            Close
          </button>
        </header>

        <section className="modal-section">
          <h3>OpenRouter API key</h3>
          <p className="muted">
            Stored encrypted via your OS keychain. Get a key at openrouter.ai.
          </p>
          {settings?.hasOpenRouterKey ? (
            <div className="row">
              <span className="status-ok">Key is set</span>
              <button type="button" onClick={() => void clearKey()} disabled={saving}>
                Clear key
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                type="password"
                placeholder="sk-or-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
              <button
                type="button"
                className="primary"
                onClick={() => void saveKey()}
                disabled={saving || key.trim().length === 0}
              >
                Save key
              </button>
            </div>
          )}
        </section>

        <section className="modal-section">
          <h3>Default model</h3>
          <p className="muted">OpenRouter model id used unless a project overrides it.</p>
          <div className="row">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="google/gemma-3-27b-it"
            />
            <button type="button" onClick={() => void saveModel()} disabled={saving}>
              Save model
            </button>
          </div>
        </section>

        {localError && <div className="error">{localError}</div>}
      </div>
    </div>
  );
}

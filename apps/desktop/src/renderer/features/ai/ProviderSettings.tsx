/**
 * The settings of the providers (spec §11.4).
 *
 * The panel shows every provider with its state and lets the user
 * switch it on, test the connection, add or remove the API key and
 * choose the default.
 *
 * The key is typed in a field that is cleared as soon as it is sent to
 * the main process — the renderer never keeps it and never gets it
 * back.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ProviderDescriptor,
  ProviderStatus,
} from '../../../shared/ai-types';

export interface ProviderSettingsProps {
  /** The providers. */
  providers: ProviderDescriptor[];
  /** The state of the selected provider. */
  status: ProviderStatus | null;
  /** Re-reads the providers. */
  onRefresh: () => void;
}

/** The providers the application knows. */
const PROVIDER_NAMES: Record<string, string> = {
  ollama: 'Ollama (local)',
  'openai-compatible': 'OpenAI compatible (cloud)',
};

/** True when the address points at this machine. */
function isLoopback(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '::1' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

export function ProviderSettings({
  providers,
  status,
  onRefresh,
}: ProviderSettingsProps): React.JSX.Element {
  const [key, setKey] = useState('');
  const [address, setAddress] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [providerId, setProviderId] = useState<string>(
    providers[0]?.id ?? 'ollama',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The provider whose settings are shown. */
  const selected =
    providers.find((entry) => entry.id === providerId) ?? providers[0] ?? null;

  // The address of the selected provider is shown in the field.
  useEffect(() => {
    setAddress(selected?.baseUrl ?? '');
    setConfirmed(selected?.remoteConfirmed ?? false);
  }, [selected?.baseUrl, selected?.remoteConfirmed]);

  const handleSaveAddress = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || selected === null) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await api.ai.updateProvider(providerId, {
      baseUrl: address,
      remoteConfirmed: confirmed,
    });
    setBusy(false);
    if (result.ok) {
      setMessage('The address was saved.');
      onRefresh();
    } else {
      setError(result.error.message);
    }
  }, [address, confirmed, onRefresh, providerId, selected]);

  const handleToggle = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || selected === null) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.ai.updateProvider(providerId, {
      enabled: !selected.enabled,
    });
    setBusy(false);
    if (result.ok) {
      onRefresh();
    } else {
      setError(result.error.message);
    }
  }, [onRefresh, providerId, selected]);

  const handleSaveKey = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api || key.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    // The key is sent once and the field is emptied right away.
    const result = await api.ai.setKey(providerId, key);
    setKey('');
    setBusy(false);
    if (result.ok) {
      setMessage('The key was stored (encrypted by the operating system).');
      onRefresh();
    } else {
      setError(result.error.message);
    }
  }, [key, onRefresh, providerId]);

  const handleClearKey = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api) {
      return;
    }
    setBusy(true);
    const result = await api.ai.clearKey(providerId);
    setBusy(false);
    if (result.ok) {
      setMessage('The key was removed.');
      onRefresh();
    } else {
      setError(result.error.message);
    }
  }, [onRefresh, providerId]);

  const handleTest = useCallback(async (): Promise<void> => {
    const api = window.nova;
    if (!api) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await api.ai.status(providerId);
    setBusy(false);
    if (result.ok && result.value.available) {
      setMessage('The provider answered.');
    } else if (result.ok) {
      setError(result.value.message ?? 'The provider is not available.');
    } else {
      setError(result.error.message);
    }
  }, [providerId]);

  return (
    <section className="ai-settings" aria-label="Provider settings">
      <h3 className="ai-settings__title">Providers</h3>

      <ul className="ai-settings__list">
        {providers.map((provider) => (
          <li key={provider.id} className="ai-settings__item">
            <button
              type="button"
              className={`ai-settings__provider${
                provider.id === providerId ? ' ai-settings__provider--active' : ''
              }`}
              onClick={() => setProviderId(provider.id)}
            >
              <span className="ai-settings__name">
                {PROVIDER_NAMES[provider.id] ?? provider.name}
              </span>
              <span
                className={`ai-badge ai-badge--${provider.kind}`}
                title={provider.kind === 'local' ? 'Runs on this machine' : 'Sends the request to an external service'}
              >
                {provider.kind === 'local' ? 'LOCAL' : 'CLOUD'}
              </span>
              {provider.enabled ? null : (
                <span className="ai-settings__off">off</span>
              )}
            </button>
            <span className="ai-settings__address">{provider.baseUrl}</span>
          </li>
        ))}
      </ul>

      <div className="ai-settings__row">
        <input
          type="text"
          className="ai-settings__address-input"
          placeholder="Address of the service"
          aria-label="Address of the service"
          value={address}
          disabled={busy}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button
          type="button"
          className="ai-settings__action"
          onClick={() => void handleSaveAddress()}
          disabled={busy}
        >
          Save address
        </button>
        <button
          type="button"
          className="ai-settings__action"
          onClick={() => void handleToggle()}
          disabled={busy || selected === null}
        >
          {selected?.enabled === true ? 'Switch off' : 'Switch on'}
        </button>
      </div>

      {selected !== null && !isLoopback(selected.baseUrl) ? (
        <label className="ai-settings__confirm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          This address is not on this machine — requests would be sent to an
          external service.
        </label>
      ) : null}

      <div className="ai-settings__row">
        <input
          type="password"
          className="ai-settings__key"
          placeholder="API key"
          aria-label="API key"
          autoComplete="off"
          value={key}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
        />
        <button
          type="button"
          className="ai-settings__action"
          onClick={() => void handleSaveKey()}
          disabled={busy || key.trim().length === 0}
        >
          Save key
        </button>
        <button
          type="button"
          className="ai-settings__action"
          onClick={() => void handleClearKey()}
          disabled={busy}
        >
          Remove key
        </button>
        <button
          type="button"
          className="ai-settings__action"
          onClick={() => void handleTest()}
          disabled={busy}
        >
          Test connection
        </button>
      </div>

      {message !== null ? (
        <p className="ai-settings__message" role="status">
          {message}
        </p>
      ) : null}
      {error !== null ? (
        <p className="ai-settings__error" role="alert">
          {error}
        </p>
      ) : null}
      {status !== null && !status.available && status.message !== null ? (
        <p className="ai-settings__error" role="status">
          {status.message}
        </p>
      ) : null}
    </section>
  );
}

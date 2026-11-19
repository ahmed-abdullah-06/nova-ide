/**
 * The Settings editor tab (A6 UI review, step U4).
 *
 * Real settings only: providers, local models, agent permissions, voice and
 * privacy. Every control writes through the existing IPC channels; the
 * renderer never decides a permission or a privacy rule by itself. The
 * controls are grouped as sections of one scrollable editor-area view.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { useAiContext } from '../ai/AiContext';
import { LocalModels } from '../ai/LocalModels';
import { ProviderSettings } from '../ai/ProviderSettings';
import { AgentPermissionSettings } from '../agent/AgentPermissionSettings';
import { useVoiceSettingsContext } from '../voice/VoiceSettingsContext';
import { VoiceSettingsPanel } from '../voice/VoiceSettingsPanel';

export function SettingsView(): ReactNode {
  const ai = useAiContext();
  const voiceSettings = useVoiceSettingsContext();
  const [modelsRevision, setModelsRevision] = useState(0);

  const handleProviderChanged = useCallback((): void => {
    setModelsRevision((revision) => revision + 1);
  }, []);

  return (
    <div className="settings-view" role="tabpanel" aria-label="Settings">
      <header className="settings-view__header">
        <h1 className="settings-view__title">Settings</h1>
        <p className="settings-view__intro">
          Changes are stored by the application. Privacy rules and agent
          permissions are enforced in the main process, not by this form.
        </p>
      </header>

      <section
        className="settings-view__section"
        aria-labelledby="settings-providers"
      >
        <h2 id="settings-providers" className="settings-view__section-title">
          Providers
        </h2>
        <p className="settings-view__section-note">
          Choose which service answers, set its address, and manage its key.
          A key is only shown for providers that use one.
        </p>
        <ProviderSettings
          providers={ai.providers}
          status={ai.status}
          onRefresh={ai.refresh}
          onModelsChanged={handleProviderChanged}
        />
      </section>

      <section
        className="settings-view__section"
        aria-labelledby="settings-models"
      >
        <h2 id="settings-models" className="settings-view__section-title">
          Models
        </h2>
        <p className="settings-view__section-note">
          The chat and the agent start with these defaults; the model picker
          in the AI panel can override them for the current session.
        </p>
        <dl className="settings-view__facts">
          <div className="settings-view__fact">
            <dt>Chat model</dt>
            <dd>{ai.defaultChatModel || 'Not chosen yet'}</dd>
          </div>
          <div className="settings-view__fact">
            <dt>Agent model</dt>
            <dd>{ai.defaultAgentModel || 'Not chosen yet'}</dd>
          </div>
        </dl>
        <LocalModels
          onModelsChanged={ai.refresh}
          revision={modelsRevision}
        />
      </section>

      <section
        className="settings-view__section"
        aria-labelledby="settings-agent"
      >
        <h2 id="settings-agent" className="settings-view__section-title">
          Agent
        </h2>
        <p className="settings-view__section-note">
          Decide what the agent may do without asking. Forbidden operations
          are never offered as a setting.
        </p>
        <AgentPermissionSettings />
      </section>

      <section
        className="settings-view__section"
        aria-labelledby="settings-voice"
      >
        <h2 id="settings-voice" className="settings-view__section-title">
          Voice
        </h2>
        <p className="settings-view__section-note">
          Voice input is off until it is enabled here. Recognised text is
          only placed in the composer; nothing is sent automatically.
        </p>
        <VoiceSettingsPanel state={voiceSettings} localOnly={ai.localOnly} />
      </section>

      <section
        className="settings-view__section"
        aria-labelledby="settings-privacy"
      >
        <h2 id="settings-privacy" className="settings-view__section-title">
          Privacy
        </h2>
        <label className="settings-view__privacy-toggle">
          <input
            type="checkbox"
            aria-label="Local-only mode"
            checked={ai.localOnly}
            onChange={(event) => ai.setLocalOnly(event.target.checked)}
          />
          <span>
            <strong>Local-only mode</strong>
            <span className="settings-view__privacy-detail">
              No cloud provider and no cloud voice service may be used. The
              main process enforces this for every request, including the
              agent and the microphone.
            </span>
          </span>
        </label>
        <p className="settings-view__section-note">
          API keys are stored by the operating system and are never returned
          to the renderer. Conversations and settings stay in the local
          application data folder.
        </p>
      </section>
    </div>
  );
}

/**
 * The Settings editor tab (A6 UI review, step U4).
 *
 * Real settings only: theme, providers, local models, agent permissions,
 * voice and privacy. Every control writes through the existing application
 * state or IPC channels; the renderer never decides a permission or a
 * privacy rule by itself. A section list scrolls the editor to one section
 * and the search field filters sections by their labels.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { FieldRow, Input, Select, Toggle } from '../../components/ui';
import { useUi } from '../../stores/ui';
import type { Theme } from '../../hooks/useTheme';
import { useAiContext } from '../ai/AiContext';
import { LocalModels } from '../ai/LocalModels';
import { ProviderSettings } from '../ai/ProviderSettings';
import { AgentPermissionSettings } from '../agent/AgentPermissionSettings';
import { useVoiceSettingsContext } from '../voice/VoiceSettingsContext';
import { VoiceSettingsPanel } from '../voice/VoiceSettingsPanel';

type SectionId = 'appearance' | 'providers' | 'models' | 'agent' | 'voice' | 'privacy';

interface SectionDescriptor {
  id: SectionId;
  label: string;
  keywords: string;
}

const SECTIONS: readonly SectionDescriptor[] = [
  { id: 'appearance', label: 'Appearance', keywords: 'theme dark light' },
  { id: 'providers', label: 'Providers', keywords: 'api key address status' },
  { id: 'models', label: 'Models', keywords: 'chat model agent model ollama download' },
  { id: 'agent', label: 'Agent', keywords: 'permissions approvals' },
  { id: 'voice', label: 'Voice', keywords: 'speech recognition microphone' },
  { id: 'privacy', label: 'Privacy', keywords: 'local only cloud keys' },
];

export interface SettingsViewProps {
  theme: Theme;
  onToggleTheme: () => void;
}

export function SettingsView({ theme, onToggleTheme }: SettingsViewProps): ReactNode {
  const ai = useAiContext();
  const voiceSettings = useVoiceSettingsContext();
  const ui = useUi();
  const [modelsRevision, setModelsRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<SectionId>('appearance');
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleSections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return SECTIONS;
    return SECTIONS.filter(
      (section) =>
        section.label.toLowerCase().includes(needle) ||
        section.keywords.includes(needle),
    );
  }, [query]);

  const handleProviderChanged = (): void => {
    setModelsRevision((revision) => revision + 1);
  };

  const goToSection = (id: SectionId): void => {
    setActive(id);
    document
      .getElementById(`settings-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // A status-bar or popover action can open Settings directly at a section.
  // The signal lets a repeated request scroll to the same section again.
  useEffect(() => {
    const section = ui.settingsSection;
    if (section === null) {
      return;
    }
    setQuery('');
    setActive(section);
    window.requestAnimationFrame(() => goToSection(section));
  }, [ui.settingsSection, ui.settingsSectionSignal]);

  const handleNavKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (visibleSections.length === 0) return;
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const next =
      (index + offset + visibleSections.length) % visibleSections.length;
    const nextSection = visibleSections[next];
    if (nextSection === undefined) return;
    navRefs.current[next]?.focus();
    goToSection(nextSection.id);
  };

  const isVisible = (id: SectionId): boolean =>
    visibleSections.some((section) => section.id === id);

  return (
    <div className="settings-view" role="tabpanel" aria-label="Settings">
      <aside className="settings-view__nav" aria-label="Settings sections">
        <div className="settings-view__nav-title">Settings</div>
        <Input
          type="search"
          className="settings-view__search"
          aria-label="Search settings"
          placeholder="Search settings"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav className="settings-view__section-list" aria-label="Sections">
          {visibleSections.map((section, index) => (
            <button
              key={section.id}
              ref={(node) => {
                navRefs.current[index] = node;
              }}
              type="button"
              className={`settings-view__section-link${
                active === section.id ? ' settings-view__section-link--active' : ''
              }`}
              aria-current={active === section.id ? 'true' : undefined}
              onClick={() => goToSection(section.id)}
              onKeyDown={(event) => handleNavKeyDown(event, index)}
            >
              {section.label}
            </button>
          ))}
          {visibleSections.length === 0 ? (
            <p className="settings-view__no-match">No matching settings.</p>
          ) : null}
        </nav>
      </aside>

      <div className="settings-view__content" id="settings-content">
        <header className="settings-view__header">
          <h1 className="settings-view__title">Settings</h1>
          <p className="settings-view__intro">
            Changes are stored by the application. Privacy rules and agent
            permissions are enforced in the main process, not by this form.
          </p>
        </header>

        <section
          id="settings-appearance"
          className={`settings-view__section${
            active === 'appearance' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-appearance-title"
          hidden={!isVisible('appearance')}
        >
          <h2 id="settings-appearance-title" className="settings-view__section-title">
            Appearance
          </h2>
          <p className="settings-view__section-note">
            The workbench theme applies to the shell, the editor and the
            terminal.
          </p>
          <FieldRow label="Theme" htmlFor="settings-theme" horizontal>
            <Select
              id="settings-theme"
              value={theme}
              aria-label="Theme"
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(value) => {
                if (value !== theme) onToggleTheme();
              }}
            />
          </FieldRow>
        </section>

        <section
          id="settings-providers"
          className={`settings-view__section${
            active === 'providers' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-providers-title"
          hidden={!isVisible('providers')}
        >
          <h2 id="settings-providers-title" className="settings-view__section-title">
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
          id="settings-models"
          className={`settings-view__section${
            active === 'models' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-models-title"
          hidden={!isVisible('models')}
        >
          <h2 id="settings-models-title" className="settings-view__section-title">
            Models
          </h2>
          <p className="settings-view__section-note">
            The chat and the agent start with the defaults selected below;
            the model picker in the AI panel can override them for a session.
          </p>
          <LocalModels onModelsChanged={ai.refresh} revision={modelsRevision} />
        </section>

        <section
          id="settings-agent"
          className={`settings-view__section${
            active === 'agent' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-agent-title"
          hidden={!isVisible('agent')}
        >
          <h2 id="settings-agent-title" className="settings-view__section-title">
            Agent
          </h2>
          <p className="settings-view__section-note">
            Decide what the agent may do without asking. Forbidden operations
            are never offered as a setting.
          </p>
          <AgentPermissionSettings />
        </section>

        <section
          id="settings-voice"
          className={`settings-view__section${
            active === 'voice' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-voice-title"
          hidden={!isVisible('voice')}
        >
          <h2 id="settings-voice-title" className="settings-view__section-title">
            Voice
          </h2>
          <p className="settings-view__section-note">
            Voice input is off until it is enabled here. Recognised text is
            only placed in the composer; nothing is sent automatically.
          </p>
          <VoiceSettingsPanel state={voiceSettings} localOnly={ai.localOnly} />
        </section>

        <section
          id="settings-privacy"
          className={`settings-view__section${
            active === 'privacy' ? ' settings-view__section--active' : ''
          }`}
          aria-labelledby="settings-privacy-title"
          hidden={!isVisible('privacy')}
        >
          <h2 id="settings-privacy-title" className="settings-view__section-title">
            Privacy
          </h2>
          <Toggle
            checked={ai.localOnly}
            label="Local-only mode"
            description="No cloud provider and no cloud voice service may be used. The main process enforces this for every request, including the agent and the microphone."
            onChange={(checked) => ai.setLocalOnly(checked)}
          />
          <p className="settings-view__section-note">
            API keys are stored by the operating system and are never returned
            to the renderer. Conversations and settings stay in the local
            application data folder.
          </p>
        </section>
      </div>
    </div>
  );
}

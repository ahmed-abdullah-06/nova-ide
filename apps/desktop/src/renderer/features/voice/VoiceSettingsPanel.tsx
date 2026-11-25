/**
 * The settings of the voice assistant (spec §15.3, Milestone 8).
 *
 * The panel edits a draft and sends it to the main process with an
 * explicit Save: nothing is stored while the user is still typing. The
 * main process sanitizes and validates the values again, so this form is
 * a convenience, not a security boundary.
 *
 * There is no automatic reading of an answer: the model may never start
 * the speech by itself. The user presses "Read aloud" on the answer.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PUSH_TO_TALK_KEY,
  describePushToTalkEvent,
} from '../../../shared/pushToTalk';
import type { VoiceSettings } from '../../../shared/voice-types';
import { Button, Checkbox, FieldRow, Input, Select, Toggle } from '../../components/ui';
import type { VoiceSettingsState } from './useVoiceSettings';

export interface VoiceSettingsPanelProps {
  /** The stored settings (null while they load). */
  state: VoiceSettingsState;
  /** True when nothing may leave this machine. */
  localOnly: boolean;
}

/** The voices of the operating system (may arrive late). */
function useSystemVoices(): { name: string; lang: string }[] {
  const [voices, setVoices] = useState<{ name: string; lang: string }[]>([]);
  useEffect(() => {
    const synthesis = globalThis.speechSynthesis;
    if (synthesis === undefined) {
      return;
    }
    const update = (): void => {
      setVoices(
        synthesis.getVoices().map((voice) => ({
          name: voice.name,
          lang: voice.lang,
        })),
      );
    };
    update();
    synthesis.addEventListener('voiceschanged', update);
    return () => {
      synthesis.removeEventListener('voiceschanged', update);
    };
  }, []);
  return voices;
}

export function VoiceSettingsPanel({
  state,
  localOnly,
}: VoiceSettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<VoiceSettings | null>(state.settings);
  const [saved, setSaved] = useState(false);
  const voices = useSystemVoices();

  // The stored value wins when it arrives (or is written by another path).
  useEffect(() => {
    setDraft(state.settings);
    setSaved(false);
  }, [state.settings]);

  const update = (patch: Partial<VoiceSettings>): void => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
    setSaved(false);
  };

  const engineArgs = useMemo(
    () => (draft === null ? '' : draft.engineArgs.join(' ')),
    [draft],
  );

  if (draft === null) {
    return (
      <section className="ai-settings voice-settings" aria-label="Voice settings">
        <h3 className="ai-settings__title">Voice input</h3>
        <p className="ai-settings__message">
          {state.error ?? 'The voice settings are loading…'}
        </p>
      </section>
    );
  }

  const save = async (): Promise<void> => {
    const stored = await state.save(draft);
    if (stored !== null) {
      setSaved(true);
    }
  };

  return (
    <section className="ai-settings voice-settings" aria-label="Voice settings">
      <h3 className="ai-settings__title">Voice input</h3>

      <Toggle
        checked={draft.enabled}
        label="Voice assistant"
        description="Record the microphone and read answers aloud."
        onChange={(checked) => update({ enabled: checked })}
      />

      <FieldRow label="Recognition" htmlFor="voice-engine" horizontal>
        <Select
          id="voice-engine"
          value={draft.engine}
          onChange={(value) =>
            update({ engine: value as VoiceSettings['engine'] })
          }
          options={[
            { value: 'none', label: 'Off — no speech recognition' },
            { value: 'local', label: 'Local engine (whisper.cpp compatible)' },
            {
              value: 'cloud',
              disabled: localOnly,
              label: localOnly
                ? 'Cloud service — blocked by the local-only mode'
                : 'Cloud service — not available in this build',
            },
          ]}
        />
      </FieldRow>

      {draft.engine === 'local' ? (
        <>
          <div className="ai-settings__row">
            <Input
              className="ai-settings__key"
              aria-label="Path of the speech engine"
              placeholder="Path of the speech engine (whisper-cli.exe)"
              value={draft.enginePath}
              onChange={(event) => update({ enginePath: event.target.value })}
            />
            <Button
              size="sm"
              className="ai-settings__action"
              onClick={async () => {
                const picked = await state.pickFile('engine');
                if (picked !== null) {
                  update({ enginePath: picked });
                }
              }}
            >
              Browse…
            </Button>
          </div>
          <div className="ai-settings__row">
            <Input
              className="ai-settings__key"
              aria-label="Path of the speech model"
              placeholder="Path of the speech model (ggml-base.bin)"
              value={draft.modelPath}
              onChange={(event) => update({ modelPath: event.target.value })}
            />
            <Button
              size="sm"
              className="ai-settings__action"
              onClick={async () => {
                const picked = await state.pickFile('model');
                if (picked !== null) {
                  update({ modelPath: picked });
                }
              }}
            >
              Browse…
            </Button>
          </div>
          <p className="ai-settings__off">
            The audio is written to the standard input of the engine and never
            to the disk. The application never downloads an engine or a model:
            both files must already be on this machine.
          </p>
          <details className="voice-settings__advanced">
            <summary>Advanced arguments</summary>
            <div className="ai-settings__row">
              <Input
                className="ai-settings__key"
                aria-label="Arguments of the speech engine"
                value={engineArgs}
                onChange={(event) =>
                  update({
                    engineArgs: event.target.value
                      .split(/\s+/)
                      .filter((part) => part.length > 0),
                  })
                }
              />
            </div>
            <p className="ai-settings__off">
              One argument per word; <code>{'{model}'}</code> is replaced with
              the path of the model.
            </p>
          </details>
        </>
      ) : null}

      <FieldRow label="Voice" htmlFor="voice-name" horizontal>
        <Select
          id="voice-name"
          value={draft.voice}
          onChange={(value) => update({ voice: value })}
          options={[
            { value: '', label: 'Default voice of the system' },
            ...voices.map((voice) => ({
              value: voice.name,
              label: `${voice.name} (${voice.lang})`,
            })),
          ]}
        />
      </FieldRow>

      <FieldRow label="Speed" htmlFor="voice-rate" horizontal>
        <div className="voice-settings__speed">
          <Input
            id="voice-rate"
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={draft.rate}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isFinite(value)) {
                update({ rate: value });
              }
            }}
          />
          <span className="ai-settings__off">{draft.rate.toFixed(1)}×</span>
        </div>
      </FieldRow>

      <Checkbox
        checked={draft.readCodeBlocks}
        label="Read code blocks aloud"
        description="They are skipped by default."
        onChange={(checked) => update({ readCodeBlocks: checked })}
      />

      <div className="ai-settings__row">
        <label className="voice-settings__label" htmlFor="voice-push-to-talk">
          Push-to-talk
        </label>
        <Input
          id="voice-push-to-talk"
          className="ai-settings__key"
          aria-label="Push-to-talk key"
          readOnly
          value={draft.pushToTalkKey}
          placeholder={DEFAULT_PUSH_TO_TALK_KEY}
          onKeyDown={(event) => {
            // Tab must keep moving the focus; it is never a recording key.
            if (event.key === 'Tab') {
              return;
            }
            event.preventDefault();
            const described = describePushToTalkEvent(event);
            if (described !== null) {
              update({ pushToTalkKey: described });
            }
          }}
        />
        <Button
          size="sm"
          className="ai-settings__action"
          onClick={() => update({ pushToTalkKey: DEFAULT_PUSH_TO_TALK_KEY })}
        >
          Reset
        </Button>
      </div>
      <p className="ai-settings__off">
        Press the field and then the key. Hold the key to record, release it to
        stop. A function key (F8 by default) is best: typing never starts a
        recording.
      </p>

      <div className="ai-settings__row">
        <label className="voice-settings__label" htmlFor="voice-max-seconds">
          Longest recording
        </label>
        <Input
          id="voice-max-seconds"
          className="voice-settings__number"
          type="number"
          min={5}
          max={120}
          value={draft.maxRecordingSeconds}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) {
              update({ maxRecordingSeconds: value });
            }
          }}
        />
        <span className="ai-settings__off">seconds</span>
      </div>

      <div className="voice-settings__actions">
        <Button
          size="sm"
          className="ai-settings__action"
          onClick={() => void save()}
          disabled={state.saving}
        >
          {state.saving ? 'Saving…' : 'Save voice settings'}
        </Button>
        {saved ? (
          <span className="ai-settings__message" role="status">
            Saved.
          </span>
        ) : null}
      </div>

      <p className="ai-settings__off">
        The microphone is only open while a recording runs. The text is placed
        in the input field for review; it is never sent by itself, and a spoken
        sentence can never start an action of the agent.
      </p>
      {localOnly ? (
        <p className="ai-settings__off voice-settings__local-only">
          The local-only mode is on: no cloud speech service may be used, and
          the main process refuses one even if the setting is changed.
        </p>
      ) : null}
      {state.error !== null ? (
        <p className="ai-settings__error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The AI assistant panel (spec §6.1, §9.1).
 *
 * The panel shows the conversation, the provider and the model that are
 * used, and the state of the provider (LOCAL or CLOUD). It never writes
 * the answer of a model into a file — that belongs to Milestone 5.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderDescriptor } from '../../../shared/ai-types';
import { AgentPanel } from '../agent/AgentPanel';
import { MessageList } from './MessageList';
import { ProviderSettings } from './ProviderSettings';
import { useAi, type Attachment } from './useAi';
import { useConversations } from './useConversations';
import { insertTranscript } from '../voice/composer';
import { useSpeech } from '../voice/useSpeech';
import { useVoiceInput } from '../voice/useVoiceInput';
import { useVoiceSettings } from '../voice/useVoiceSettings';
import { VoiceSettingsPanel } from '../voice/VoiceSettingsPanel';

export interface AiPanelProps {
  /** True when a workspace is open (the context needs one). */
  hasWorkspace: boolean;
  /** The file that is open in the editor (can be attached as context). */
  activeFile: { path: string; name: string; sizeBytes: number } | null;
  /** The selected text of the editor (can be attached as context). */
  selection: {
    path: string;
    name: string;
    sizeBytes: number;
    startLine: number;
    endLine: number;
  } | null;
}

export function AiPanel({
  hasWorkspace,
  activeFile,
  selection,
}: AiPanelProps): React.JSX.Element {
  const ai = useAi();
  const conversations = useConversations();
  const voiceSettings = useVoiceSettings();
  const voice = useVoiceInput({
    settings: voiceSettings.settings,
    onTranscript: (text) => {
      // The recognised text only lands in the composer: the user reads it,
      // edits it and sends it. Nothing is sent here (spec §15.4).
      setInput((current) => insertTranscript(current, text));
    },
  });
  const speech = useSpeech();
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [input, setInput] = useState('');
  const [title, setTitle] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [approveCloud, setApproveCloud] = useState(false);
  /** The mode that was shown before (the agent has its own default). */
  const previousMode = useRef<'chat' | 'agent'>('chat');

  // The agent uses its own default model. It is only applied when the
  // user switches to the agent, so a manual choice is never overwritten.
  useEffect(() => {
    if (previousMode.current !== 'agent' && mode === 'agent') {
      const preferred = ai.defaultAgentModel;
      if (
        preferred.length > 0 &&
        ai.models.some((entry) => entry.id === preferred)
      ) {
        ai.selectModel(preferred);
      }
    }
    previousMode.current = mode;
  }, [ai, mode]);

  // The title of the open conversation is shown in the field.
  useEffect(() => {
    setTitle(conversations.current?.title ?? '');
  }, [conversations.current?.title]);

  // The messages of the open conversation are shown.
  useEffect(() => {
    const current = conversations.current;
    if (current === null) {
      return;
    }
    if (current.messages.length !== ai.messages.length) {
      ai.setMessages(current.messages);
    }
  }, [ai, conversations.current]);

  // The provider and the model of the conversation are restored when
  // another conversation is opened.
  useEffect(() => {
    const conversation = conversations.current;
    if (conversation === null) {
      return;
    }
    if (
      conversation.providerId.length > 0 &&
      conversation.providerId !== ai.providerId &&
      ai.providers.some((entry) => entry.id === conversation.providerId)
    ) {
      ai.selectProvider(conversation.providerId);
    }
    if (
      conversation.model.length > 0 &&
      conversation.model !== ai.model &&
      ai.models.some((entry) => entry.id === conversation.model)
    ) {
      ai.selectModel(conversation.model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.current?.id]);

  // The provider and the model are stored with the conversation.
  useEffect(() => {
    if (ai.providerId === null) {
      return;
    }
    conversations.setProvider(ai.providerId, ai.model);
  }, [ai.providerId, ai.model, conversations.setProvider]);

  // The conversation is stored when the answer is finished.
  useEffect(() => {
    if (!ai.streaming && ai.messages.length > 0) {
      conversations.save(ai.messages);
    }
  }, [ai.messages, ai.streaming, conversations]);

  const handleSend = useCallback(async (): Promise<void> => {
    const text = input;
    setInput('');
    await ai.send(text, approveCloud);
    setApproveCloud(false);
  }, [ai, approveCloud, input]);

  const handleOpenLink = useCallback((url: string): void => {
    void window.nova?.openExternal(url);
  }, []);

  const handleAttachFile = useCallback((): void => {
    if (activeFile === null) {
      return;
    }
    const attachment: Attachment = {
      path: activeFile.path,
      name: activeFile.name,
      sizeBytes: activeFile.sizeBytes,
      kind: 'file',
    };
    ai.attach(attachment);
  }, [activeFile, ai]);

  const handleAttachSelection = useCallback((): void => {
    if (selection === null) {
      return;
    }
    ai.attach({
      path: selection.path,
      name: selection.name,
      sizeBytes: selection.sizeBytes,
      kind: 'selection',
      startLine: selection.startLine,
      endLine: selection.endLine,
    });
  }, [ai, selection]);

  const provider: ProviderDescriptor | null =
    ai.providers.find((entry) => entry.id === ai.providerId) ?? null;
  const isCloud = provider?.kind === 'cloud';

  return (
    <aside className="ai-panel" aria-label="AI assistant">
      <div className="ai-panel__header">
        <div className="ai-panel__modes" role="tablist" aria-label="Mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'chat'}
            className={`ai-panel__mode${mode === 'chat' ? ' ai-panel__mode--active' : ''}`}
            onClick={() => setMode('chat')}
          >
            Chat
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'agent'}
            className={`ai-panel__mode${mode === 'agent' ? ' ai-panel__mode--active' : ''}`}
            onClick={() => setMode('agent')}
          >
            Agent
          </button>
        </div>
        {provider !== null ? (
          <span
            className={`ai-badge ai-badge--${provider.kind}`}
            title={
              provider.kind === 'local'
                ? 'The request stays on this machine'
                : 'The request is sent to an external service'
            }
          >
            {provider.kind === 'local' ? 'LOCAL' : 'CLOUD'}
          </span>
        ) : null}
        {ai.localOnly ? (
          <span
            className="ai-badge ai-badge--local-only"
            title="The local-only mode is switched on: no cloud provider and no cloud voice service may be used"
          >
            LOCAL ONLY
          </span>
        ) : null}
        <button
          type="button"
          className="ai-panel__settings-button"
          onClick={() => setShowSettings((current) => !current)}
          title="Provider settings"
          aria-expanded={showSettings}
        >
          Settings
        </button>
      </div>

      <div className="ai-panel__controls">
        <select
          className="ai-panel__select"
          aria-label="Provider"
          value={ai.providerId ?? ''}
          onChange={(event) => ai.selectProvider(event.target.value)}
        >
          {ai.providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <select
          className="ai-panel__select"
          aria-label="Model"
          value={ai.model}
          disabled={ai.models.length === 0}
          onChange={(event) => ai.selectModel(event.target.value)}
        >
          {ai.models.length === 0 ? (
            <option value="">No models</option>
          ) : null}
          {ai.models.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.sizeBytes !== undefined
                ? ` (${Math.round(entry.sizeBytes / 1024 / 1024 * 10) / 10} MB)`
                : ''}
            </option>
          ))}
        </select>
      </div>

      {ai.models.some((entry) => (entry.sizeBytes ?? 0) > 4_000_000_000) ? (
        <p className="ai-panel__notice">
          A large model needs a lot of memory and is slow on a machine
          without a dedicated GPU. A smaller model answers faster.
        </p>
      ) : null}

      {showSettings ? (
        <>
          <ProviderSettings
            providers={ai.providers}
            status={ai.status}
            onRefresh={ai.refresh}
            onModelsChanged={ai.refresh}
            localOnly={ai.localOnly}
            onLocalOnlyChange={ai.setLocalOnly}
          />
          <VoiceSettingsPanel
            state={voiceSettings}
            localOnly={ai.localOnly}
          />
        </>
      ) : null}

      <div className="ai-panel__conversations">
        <select
          className="ai-panel__select"
          aria-label="Conversation"
          value={conversations.current?.id ?? ''}
          onChange={(event) => conversations.open(event.target.value)}
        >
          {conversations.conversations.length === 0 ? (
            <option value="">No conversation yet</option>
          ) : null}
          {conversations.conversations.map((conversation) => (
            <option key={conversation.id} value={conversation.id}>
              {conversation.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ai-panel__action"
          onClick={() => conversations.create()}
          title="New conversation"
        >
          New
        </button>
        {conversations.current !== null ? (
          <>
            <input
              type="text"
              className="ai-panel__title"
              aria-label="Name of the conversation"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                if (title.trim().length > 0) {
                  conversations.rename(
                    conversations.current?.id ?? '',
                    title.trim(),
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              className="ai-panel__action"
              onClick={() => conversations.remove(conversations.current?.id ?? '')}
              title="Delete the conversation"
            >
              Delete
            </button>
          </>
        ) : null}
      </div>

      {mode === 'agent' ? (
        <AgentPanel
          providers={ai.providers}
          models={ai.models}
          providerId={ai.providerId}
          model={ai.model}
          onSelectProvider={ai.selectProvider}
          onSelectModel={ai.selectModel}
        />
      ) : (
        <>
          <div className="ai-panel__body">
            <MessageList
              messages={ai.messages}
              streaming={ai.streaming}
              onOpenLink={handleOpenLink}
              onReadAloud={speech.read}
              speakingIndex={speech.speakingIndex}
              onStopSpeech={speech.stop}
            />
          </div>
        </>
      )}

      {ai.error !== null ? (
        <p className="ai-panel__error" role="alert">
          {ai.error}
        </p>
      ) : null}

      {ai.attachments.length > 0 ? (
        <div
          className="ai-panel__context-preview"
          data-preview-count={ai.preview.length}
        >
          <p className="ai-panel__context-title">
            This will be sent with the next message:
          </p>
          <ul className="ai-panel__attachments" aria-label="Attached context">
            {ai.attachments.map((attachment) => {
              const preview = ai.preview.find(
                (entry) => entry.path === attachment.path,
              );
              return (
                <li
                  key={attachment.path}
                  className="ai-panel__attachment"
                  data-path={attachment.path}
                  title={
                    preview?.skipped ??
                    `${preview?.tokens ?? 0} tokens`
                  }
                >
                  <span>{attachment.name}</span>
                  {preview !== undefined ? (
                    <span className="ai-panel__attachment-size">
                      {preview.skipped !== undefined
                        ? 'not sent'
                        : `${preview.tokens} tokens`}
                    </span>
                  ) : null}
                  {preview?.truncated === true ? (
                    <span className="ai-panel__attachment-size ai-panel__attachment-size--warn">
                      shortened
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="ai-panel__attachment-remove"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => ai.detach(attachment.path)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="ai-panel__composer">
        <textarea
          className="ai-panel__input"
          placeholder="Ask a question about the code…"
          aria-label="Chat input"
          value={input}
          disabled={ai.streaming}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <div className="ai-panel__actions">
          <button
            type="button"
            className={`ai-panel__action ai-panel__action--mic${
              voice.recording ? ' ai-panel__action--recording' : ''
            }`}
            onClick={() => {
              if (voice.processing) {
                voice.cancel();
                return;
              }
              void voice.toggle();
            }}
            disabled={
              ai.streaming ||
              (voice.busy && !voice.recording && !voice.processing)
            }
            aria-pressed={voice.recording}
            title={
              voice.recording
                ? 'Stop the recording (the text is only placed in the input)'
                : voice.processing
                  ? 'Cancel the speech recognition'
                  : 'Record a message with the microphone'
            }
          >
            {voice.processing
              ? 'Cancel'
              : voice.recording
                ? `Stop (${Math.ceil(voice.elapsedSeconds)} s)`
                : 'Mic'}
          </button>
          <button
            type="button"
            className="ai-panel__action ai-panel__action--primary"
            onClick={() => void handleSend()}
            disabled={ai.streaming || input.trim().length === 0}
          >
            Send
          </button>
          <button
            type="button"
            className="ai-panel__action"
            onClick={ai.stop}
            disabled={!ai.streaming}
          >
            Stop
          </button>
          <button
            type="button"
            className="ai-panel__action"
            onClick={() => void ai.regenerate()}
            disabled={ai.streaming || ai.messages.length === 0}
          >
            Ask again
          </button>
          {speech.speaking ? (
            <button
              type="button"
              className="ai-panel__action"
              onClick={speech.stop}
              title="Stop reading the answer aloud"
            >
              Stop reading
            </button>
          ) : null}
        </div>
        {voice.notice !== null ? (
          <p className="ai-panel__voice-status" role="status">
            {voice.notice}
            <button
              type="button"
              className="ai-panel__voice-dismiss"
              aria-label="Dismiss the message"
              onClick={voice.clearNotice}
            >
              ×
            </button>
          </p>
        ) : null}
        {speech.notice !== null ? (
          <p className="ai-panel__voice-status" role="status">
            {speech.notice}
            <button
              type="button"
              className="ai-panel__voice-dismiss"
              aria-label="Dismiss the message"
              onClick={speech.clearNotice}
            >
              ×
            </button>
          </p>
        ) : null}
        <div className="ai-panel__context">
          <button
            type="button"
            className="ai-panel__action"
            onClick={handleAttachFile}
            disabled={!hasWorkspace || activeFile === null}
            title="Attach the current file as context"
          >
            Attach file
          </button>
          <button
            type="button"
            className="ai-panel__action"
            onClick={() => void ai.pickFiles()}
            disabled={!hasWorkspace}
            title="Choose the files that are attached as context"
          >
            Browse files
          </button>
          <button
            type="button"
            className="ai-panel__action"
            onClick={handleAttachSelection}
            disabled={!hasWorkspace || selection === null}
            title="Attach the selected code as context"
          >
            Attach selection
          </button>
          {isCloud && ai.attachments.length > 0 ? (
            <label className="ai-panel__approval">
              <input
                type="checkbox"
                checked={approveCloud}
                onChange={(event) => setApproveCloud(event.target.checked)}
              />
              Send the attached files to the cloud provider
            </label>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

/**
 * The AI assistant panel (spec §6.1, §9.1).
 *
 * Chat and Agent share one composer at the bottom of the panel. The mode
 * only changes what the composer submits to and what is shown above it —
 * there is never a second task box. Provider, model and privacy state live
 * in the compact controls row; the header stays limited to the two modes
 * and the settings action.
 *
 * The panel never writes the answer of a model into a file — that belongs
 * to the agent, which the user starts from the same composer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderDescriptor } from '../../../shared/ai-types';
import { Icon } from '../../components/ui/icons';
import { IconButton } from '../../components/ui/IconButton';
import { useTabs } from '../../stores/tabs';
import { AgentPanel } from '../agent/AgentPanel';
import { useAgent } from '../agent/useAgent';
import { useAiContext } from './AiContext';
import { MessageList } from './MessageList';
import { type Attachment } from './useAi';
import { useConversations } from './useConversations';
import { insertTranscript } from '../voice/composer';
import { useSpeech } from '../voice/useSpeech';
import { useVoiceInput } from '../voice/useVoiceInput';
import { useVoiceSettingsContext } from '../voice/VoiceSettingsContext';

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
  /** CSS-only visibility so conversations and voice state survive toggles. */
  visible: boolean;
}

export function AiPanel({
  hasWorkspace,
  activeFile,
  selection,
  visible,
}: AiPanelProps): React.JSX.Element {
  const ai = useAiContext();
  const agent = useAgent();
  const conversations = useConversations();
  const tabs = useTabs();
  const voiceSettings = useVoiceSettingsContext();
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [approveCloud, setApproveCloud] = useState(false);
  const [agentApproveCloud, setAgentApproveCloud] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  /** The mode that was shown before (the agent has its own default). */
  const previousMode = useRef<'chat' | 'agent'>('chat');
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const agentState = agent.state;
  const agentRunning =
    agentState.state === 'planning' ||
    agentState.state === 'waitingForPlan' ||
    agentState.state === 'running' ||
    agentState.state === 'waitingForApproval';
  const busy = mode === 'agent' ? agentRunning : ai.streaming;
  const composerDisabled = mode === 'agent' ? agentRunning || agentBusy : ai.streaming;

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

  /** Submits the one composer to the mode that is currently shown. */
  const handleSubmit = useCallback(async (): Promise<void> => {
    if (mode === 'agent') {
      if (ai.providerId === null || ai.model.length === 0) {
        agent.setError('Choose a provider and a model first.');
        return;
      }
      setAgentBusy(true);
      const runId = await agent.start(
        input,
        ai.providerId,
        ai.model,
        agentApproveCloud,
      );
      setAgentBusy(false);
      if (runId !== null) {
        setInput('');
        setAgentApproveCloud(false);
      }
      return;
    }
    const text = input;
    setInput('');
    await ai.send(text, approveCloud);
    setApproveCloud(false);
  }, [agent, agentApproveCloud, ai, approveCloud, input, mode]);

  /** Stops whichever operation the composer started. */
  const handleStop = useCallback((): void => {
    if (mode === 'agent') {
      void agent.stop();
    } else {
      ai.stop();
    }
  }, [agent, ai, mode]);

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
  const modelName =
    ai.models.find((entry) => entry.id === ai.model)?.name ??
    (ai.model.length > 0 ? ai.model : 'Choose a model');

  useEffect(() => {
    const closePopovers = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setHistoryOpen(false);
        setPickerOpen(false);
        setAttachOpen(false);
      }
    };
    document.addEventListener('keydown', closePopovers);
    return () => document.removeEventListener('keydown', closePopovers);
  }, []);

  useEffect(() => {
    const node = composerRef.current;
    if (node === null) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 220)}px`;
  }, [input]);

  return (
    <aside
      className={`ai-panel${visible ? '' : ' ai-panel--hidden'}`}
      aria-label="AI assistant"
      aria-hidden={!visible}
    >
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
        <div className="ai-panel__header-actions">
          <IconButton
            label="New chat"
            className="ai-panel__header-button"
            icon={<Icon name="plus" size={15} />}
            size="sm"
            onClick={() => {
              setHistoryOpen(false);
              conversations.create();
            }}
          />
          <IconButton
            label="History"
            className="ai-panel__header-button ai-panel__history-button"
            icon={<Icon name="history" size={15} />}
            size="sm"
            active={historyOpen}
            aria-expanded={historyOpen}
            onClick={() => {
              setPickerOpen(false);
              setAttachOpen(false);
              setHistoryOpen((open) => !open);
            }}
          />
          <IconButton
            label="Settings"
            className="ai-panel__settings-button"
            icon={<Icon name="settings" size={15} />}
            size="sm"
            onClick={tabs.openSettings}
          />
        </div>
      </div>

      {historyOpen ? (
        <div className="ai-panel__history" role="dialog" aria-label="Conversation history">
          <div className="ai-panel__history-title">Conversations</div>
          {conversations.conversations.length === 0 ? (
            <p className="ai-panel__history-empty">No conversations yet.</p>
          ) : (
            <ul className="ai-panel__history-list">
              {conversations.conversations.map((conversation) => (
                <li key={conversation.id} className="ai-panel__history-item">
                  <button
                    type="button"
                    className="ai-panel__history-open"
                    onClick={() => {
                      conversations.open(conversation.id);
                      setHistoryOpen(false);
                    }}
                  >
                    {conversation.title}
                  </button>
                  <IconButton
                    label={`Delete ${conversation.title}`}
                    className="ai-panel__history-delete"
                    icon={<Icon name="delete" size={12} />}
                    size="sm"
                    onClick={() => conversations.remove(conversation.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          {conversations.current !== null ? (
            <div className="ai-panel__history-rename">
              <input
                type="text"
                aria-label="Name of the conversation"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => {
                  if (title.trim().length > 0) {
                    conversations.rename(conversations.current?.id ?? '', title.trim());
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {ai.models.some((entry) => (entry.sizeBytes ?? 0) > 4_000_000_000) ? (
        <p className="ai-panel__notice">
          A large model needs a lot of memory and is slow on a machine
          without a dedicated GPU. A smaller model answers faster.
        </p>
      ) : null}

      {mode === 'agent' ? (
        <AgentPanel />
      ) : (
        <div className="ai-panel__body">
          <MessageList
            messages={ai.messages}
            streaming={ai.streaming}
            onOpenLink={handleOpenLink}
            onReadAloud={speech.read}
            speakingIndex={speech.speakingIndex}
            onStopSpeech={speech.stop}
            onRegenerate={() => void ai.regenerate()}
          />
        </div>
      )}

      {mode === 'chat' && ai.error !== null ? (
        <p className="ai-panel__error" role="alert">
          {ai.error}
        </p>
      ) : null}

      {mode === 'chat' && ai.attachments.length > 0 ? (
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
        <div className="ai-panel__composer-box">
        <textarea
          ref={composerRef}
          className="ai-panel__input"
          placeholder={
            mode === 'agent'
              ? 'Describe the task for the agent…'
              : 'Ask a question about the code…'
          }
          aria-label={mode === 'agent' ? 'Task for the agent' : 'Chat input'}
          value={input}
          disabled={composerDisabled}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <div className="ai-panel__composer-row">
          <IconButton
            label="Attach"
            className="ai-panel__attach-button"
            icon={<Icon name="plus" size={15} />}
            size="sm"
            active={attachOpen}
            aria-expanded={attachOpen}
            onClick={() => {
              setPickerOpen(false);
              setHistoryOpen(false);
              setAttachOpen((open) => !open);
            }}
          />
          <IconButton
            label={voice.recording ? 'Stop recording' : 'Microphone'}
            className={`ai-panel__mic-button${
              voice.recording ? ' ai-panel__action--recording' : ''
            }`}
            icon={<Icon name="mic" size={15} />}
            size="sm"
            active={voice.recording}
            aria-pressed={voice.recording}
            title={
              voice.processing
                ? 'Cancel the speech recognition'
                : voice.recording
                  ? 'Stop the recording (the text is only placed in the input)'
                  : 'Record a message with the microphone'
            }
            disabled={
              ai.streaming ||
              (voice.busy && !voice.recording && !voice.processing)
            }
            onClick={() => {
              if (voice.processing) {
                voice.cancel();
                return;
              }
              void voice.toggle();
            }}
          />
          <button
            type="button"
            className="ai-model-chip"
            title={modelName}
            aria-label={`Model: ${modelName}`}
            aria-expanded={pickerOpen}
            onClick={() => {
              setAttachOpen(false);
              setHistoryOpen(false);
              setPickerOpen((open) => !open);
            }}
          >
            <span className="ai-model-chip__name">{modelName}</span>
            {provider !== null ? (
              <span
                className={`ai-model-chip__marker ai-model-chip__marker--${provider.kind}`}
                title={
                  provider.kind === 'local'
                    ? 'The request stays on this machine'
                    : 'The request is sent to an external service'
                }
              >
                {provider.kind === 'local' ? 'LOCAL' : 'CLOUD'}
              </span>
            ) : null}
            <Icon name="chevronDown" size={10} />
          </button>
          <span className="ai-panel__composer-spacer" />
          <IconButton
            label={busy ? 'Stop' : 'Send'}
            className="ai-panel__send-button"
            icon={<Icon name={busy ? 'stop' : 'send'} size={15} />}
            size="sm"
            onClick={() => {
              if (busy) {
                handleStop();
                return;
              }
              void handleSubmit();
            }}
            disabled={!busy && (composerDisabled || input.trim().length === 0)}
          />
        </div>
        </div>

        {attachOpen ? (
          <div className="ai-panel__attach-menu" role="menu" aria-label="Attach context">
            <button type="button" role="menuitem" onClick={handleAttachFile} disabled={!hasWorkspace || activeFile === null}>Attach file</button>
            <button type="button" role="menuitem" onClick={() => void ai.pickFiles()} disabled={!hasWorkspace}>Browse files</button>
            <button type="button" role="menuitem" onClick={handleAttachSelection} disabled={!hasWorkspace || selection === null}>Attach selection</button>
          </div>
        ) : null}

        {pickerOpen ? (
          <div className="ai-panel__model-menu" role="dialog" aria-label="Choose provider and model">
            <div className="ai-panel__model-menu__label">Provider</div>
            {ai.providers.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className="ai-panel__model-menu__row"
                aria-pressed={entry.id === ai.providerId}
                onClick={() => ai.selectProvider(entry.id)}
              >
                {entry.name}
              </button>
            ))}
            <div className="ai-panel__model-menu__label">Model</div>
            {ai.models.length === 0 ? (
              <p className="ai-panel__model-menu__empty">No models available.</p>
            ) : (
              ai.models.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="ai-panel__model-menu__row"
                  aria-pressed={entry.id === ai.model}
                  onClick={() => {
                    ai.selectModel(entry.id);
                    setPickerOpen(false);
                  }}
                >
                  {entry.name}
                </button>
              ))
            )}
          </div>
        ) : null}

        {mode === 'chat' && voice.notice !== null ? (
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
        {mode === 'chat' && speech.notice !== null ? (
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
        {mode === 'chat' && isCloud && ai.attachments.length > 0 ? (
          <label className="ai-panel__approval">
            <input
              type="checkbox"
              checked={approveCloud}
              onChange={(event) => setApproveCloud(event.target.checked)}
            />
            Send the attached files to the cloud provider
          </label>
        ) : mode === 'agent' && isCloud ? (
          <label className="ai-panel__approval">
            <input
              type="checkbox"
              checked={agentApproveCloud}
              onChange={(event) => setAgentApproveCloud(event.target.checked)}
            />
            Allow this run to send the content of the workspace to the cloud provider
          </label>
        ) : null}
      </div>
    </aside>
  );
}

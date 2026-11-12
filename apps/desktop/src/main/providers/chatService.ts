/**
 * The chat service (spec §9.1, §10.2, §11).
 *
 * It turns a request of the renderer into a stream of a provider:
 *
 *  - it checks the provider (enabled, key) and the privacy gate,
 *  - it builds the context of the request (the files are read by the
 *    main process, through the workspace path check),
 *  - it starts the request on the router and forwards the events.
 *
 * The renderer never sends file content: it only names the files it
 * attached, and the main process decides what is really sent.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  AIStreamEvent,
  AiResult,
  ChatMessage,
} from '../../shared/ai-types';
import { parseGitignore, type GitignoreMatcher } from '../services/gitignore';
import type { CredentialStore } from './credentials';
import {
  buildContext,
  buildMessages,
  checkPrivacyGate,
  type ContextRequest,
} from './privacy';
import type { ProviderService } from './providerService';
import { ProviderRouter } from './router';

export interface ChatServiceOptions {
  /** The provider layer. */
  providers: ProviderService;
  /** The store of the API keys. */
  credentials: CredentialStore;
  /** Returns the canonical root of the active workspace (or null). */
  getRoot: () => string | null;
  /** Called for every event of every running request. */
  onEvent: (requestId: string, event: AIStreamEvent) => void;
}

export class ChatService {
  private readonly options: ChatServiceOptions;
  private readonly router: ProviderRouter;

  constructor(options: ChatServiceOptions) {
    this.options = options;
    this.router = new ProviderRouter({
      onEvent: options.onEvent,
      resolve: (providerId) => options.providers.resolve(providerId),
    });
  }

  /**
   * Starts a chat request.
   *
   * The request id comes from the renderer (so it can correlate the
   * events); it is validated before it is used.
   */
  async start(
    requestId: string,
    providerId: string,
    model: string,
    history: readonly ChatMessage[],
    attachments: readonly ContextRequest[],
    approveCloudContext: boolean,
  ): Promise<AiResult<{ requestId: string }>> {
    const provider = await this.options.providers.resolve(providerId);
    if (provider === null) {
      return {
        ok: false,
        error: {
          code: 'unknown',
          message: 'The selected provider is not available.',
        },
      };
    }

    const settings = await this.options.providers.settingsOf(providerId);
    const apiKey =
      provider.kind === 'cloud'
        ? await this.options.credentials.getKey(providerId)
        : null;

    const gate = checkPrivacyGate(
      provider.kind,
      settings.enabled,
      apiKey !== null,
      approveCloudContext,
      attachments.length > 0,
    );
    if (gate !== null) {
      return { ok: false, error: gate };
    }

    const context = await this.buildContext(attachments);
    const messages = buildMessages(history, context.attachments, context.text);

    return this.router.start(requestId, providerId, messages, { model });
  }

  /** Cancels a running request. */
  cancel(requestId: string): AiResult<void> {
    return this.router.cancel(requestId);
  }

  /** Cancels every running request (the application quits). */
  cancelAll(): void {
    this.router.cancelAll();
  }

  /** Reads the attached files through the workspace path check. */
  private async buildContext(
    attachments: readonly ContextRequest[],
  ): Promise<Awaited<ReturnType<typeof buildContext>>> {
    const root = this.options.getRoot();
    if (root === null || attachments.length === 0) {
      return { text: '', attachments: [], truncated: false, skipped: 0 };
    }
    const gitignore = await this.loadGitignore(root);
    return buildContext(root, attachments, gitignore);
  }

  /** The ignore rules of the workspace. */
  private async loadGitignore(root: string): Promise<GitignoreMatcher> {
    try {
      const raw = await readFile(path.join(root, '.gitignore'), 'utf8');
      return parseGitignore(raw);
    } catch {
      return parseGitignore('');
    }
  }
}

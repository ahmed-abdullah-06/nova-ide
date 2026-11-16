/**
 * The state of the model management (spec §11.3, §21).
 *
 * The renderer never talks to Ollama itself: it asks the main process
 * through the typed bridge and follows the progress of a download
 * through the push channel.
 *
 * The panel never shows a fact that the main process did not report.
 * A model that is not installed is not listed, a capability that
 * Ollama did not report is "unknown", and the fit of a model is
 * labelled as an estimate.
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  LocalDownloadProgress,
  LocalModelCatalog,
  LocalModelDefaults,
  LocalModelDetails,
} from '../../../shared/local-model-types';

export interface LocalModelsController {
  /** The catalog of the local models (null while it is loading). */
  catalog: LocalModelCatalog | null;
  /** The details of the model that the user opened (null when none). */
  details: LocalModelDetails | null;
  /** The last error (honest, never a placeholder). */
  error: string | null;
  /** The last message for the user. */
  message: string | null;
  /** True while an operation runs. */
  busy: boolean;
  /** The progress of the download that runs (null when none runs). */
  download: LocalDownloadProgress | null;
  /** The name the user typed into the download field. */
  downloadName: string;
  /** True when the user confirmed the download. */
  confirmed: boolean;
  /** The defaults of the chat and of the agent. */
  defaults: LocalModelDefaults;
  /**
   * What Ollama reports about the tool calls of the default agent model.
   *
   * `undefined` means that Ollama did not report it — the panel says
   * "unknown" instead of guessing.
   */
  agentToolSupport: boolean | undefined;
  /** Changes the name of the download. */
  setDownloadName: (name: string) => void;
  /** Changes the confirmation of the download. */
  setConfirmed: (confirmed: boolean) => void;
  /** Reads the catalog again. */
  refresh: () => void;
  /** Reads the details of a model. */
  showDetails: (model: string) => void;
  /** Closes the details of a model. */
  closeDetails: () => void;
  /** Starts the download of the model that is in the field. */
  startDownload: () => void;
  /** Stops the running download. */
  cancelDownload: () => void;
  /** Deletes a model. */
  remove: (model: string) => void;
  /** Unloads a model from the memory. */
  unload: (model: string) => void;
  /** Stores the default model of the chat. */
  setChatModel: (model: string) => void;
  /** Stores the default model of the agent. */
  setAgentModel: (model: string) => void;
  /**
   * Called when the list of the installed models changed, so the model
   * of the chat can be read again.
   */
  onModelsChanged?: () => void;
}

export function useLocalModels(
  onModelsChanged?: () => void,
  revision = 0,
): LocalModelsController {
  const [catalog, setCatalog] = useState<LocalModelCatalog | null>(null);
  const [details, setDetails] = useState<LocalModelDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [download, setDownload] = useState<LocalDownloadProgress | null>(null);
  const [downloadName, setDownloadName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [defaults, setDefaults] = useState<LocalModelDefaults>({
    chatModel: '',
    agentModel: '',
  });
  /** What Ollama reports about the tools of the default agent model. */
  const [agentToolSupport, setAgentToolSupport] = useState<
    boolean | undefined
  >(undefined);

  /** Reads the catalog of the models. */
  const refresh = useCallback((): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.localModels.catalog().then((result) => {
      if (result.ok) {
        setCatalog(result.value);
        setError(null);
        return;
      }
      setCatalog(null);
      setError(result.error.message);
    });
  }, []);

  // The catalog and the defaults are read when the panel opens.
  useEffect(() => {
    refresh();
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.localModels.defaults().then((stored) => {
      setDefaults(stored);
    });
  }, [refresh, revision]);

  // The progress of a download arrives through the push channel.
  useEffect(() => {
    const api = window.nova;
    if (!api) {
      return;
    }
    return api.localModels.onProgress((progress) => {
      setDownload(progress);
      if (progress.done) {
        setBusy(false);
        // A model that was downloaded is a new model of the chat.
        refresh();
        onModelsChanged?.();
      }
    });
  }, [onModelsChanged, refresh]);

  const showDetails = useCallback((model: string): void => {
    const api = window.nova;
    if (!api) {
      return;
    }
    void api.localModels.details(model).then((result) => {
      if (result.ok) {
        setDetails(result.value);
        setError(null);
        return;
      }
      setDetails(null);
      setError(result.error.message);
    });
  }, []);

  // The tool calls of the default agent model are read from Ollama, so
  // the panel can warn when the model does not report them.
  useEffect(() => {
    const api = window.nova;
    const model = defaults.agentModel;
    if (!api || model.length === 0) {
      setAgentToolSupport(undefined);
      return;
    }
    let cancelled = false;
    void api.localModels.details(model).then((result) => {
      if (cancelled) {
        return;
      }
      setAgentToolSupport(result.ok ? result.value.supportsToolCalls : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [defaults.agentModel]);

  const closeDetails = useCallback((): void => {
    setDetails(null);
  }, []);

  const startDownload = useCallback((): void => {
    const api = window.nova;
    const name = downloadName.trim();
    if (!api || name.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    void api.localModels.pull(name, confirmed).then((result) => {
      if (!result.ok) {
        setBusy(false);
        setError(result.error.message);
        return;
      }
      setMessage(`The download of "${name}" started.`);
    });
  }, [confirmed, downloadName]);

  const cancelDownload = useCallback((): void => {
    const api = window.nova;
    const current = download;
    if (!api || current === null || current.done) {
      return;
    }
    void api.localModels.cancelPull(current.downloadId).then((result) => {
      if (!result.ok) {
        setError(result.error.message);
      }
    });
  }, [download]);

  const remove = useCallback(
    (model: string): void => {
      const api = window.nova;
      if (!api) {
        return;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      void api.localModels.delete(model).then((result) => {
        setBusy(false);
        if (result.ok) {
          setMessage(`The model "${model}" was deleted.`);
          refresh();
          onModelsChanged?.();
          return;
        }
        setError(result.error.message);
      });
    },
    [onModelsChanged, refresh],
  );

  const unload = useCallback(
    (model: string): void => {
      const api = window.nova;
      if (!api) {
        return;
      }
      setBusy(true);
      setError(null);
      setMessage(null);
      void api.localModels.unload(model).then((result) => {
        setBusy(false);
        if (result.ok) {
          setMessage(`The model "${model}" was unloaded.`);
          refresh();
          return;
        }
        setError(result.error.message);
      });
    },
    [refresh],
  );

  /** Stores the defaults of the chat and of the agent. */
  const storeDefaults = useCallback(
    (next: LocalModelDefaults): void => {
      const api = window.nova;
      if (!api) {
        return;
      }
      void api.localModels.setDefaults(next).then((stored) => {
        setDefaults(stored);
      });
    },
    [],
  );

  const setChatModel = useCallback(
    (model: string): void => {
      storeDefaults({ ...defaults, chatModel: model });
    },
    [defaults, storeDefaults],
  );

  const setAgentModel = useCallback(
    (model: string): void => {
      storeDefaults({ ...defaults, agentModel: model });
    },
    [defaults, storeDefaults],
  );

  return {
    catalog,
    details,
    error,
    message,
    busy,
    download,
    downloadName,
    confirmed,
    defaults,
    agentToolSupport,
    setDownloadName,
    setConfirmed,
    refresh,
    showDetails,
    closeDetails,
    startDownload,
    cancelDownload,
    remove,
    unload,
    setChatModel,
    setAgentModel,
  };
}

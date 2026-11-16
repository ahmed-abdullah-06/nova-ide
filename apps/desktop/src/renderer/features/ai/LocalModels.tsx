/**
 * The management of the local models in the settings of the AI panel
 * (spec §11.3, §2.1, §21).
 *
 * The section shows the installed models, the models that are loaded in
 * the memory, the facts of the machine and the estimate whether a model
 * fits into the memory. A model can be downloaded, deleted and
 * unloaded.
 *
 * The panel never shows a fact that the main process did not report:
 * a missing capability is "unknown", a missing size is "unknown", and
 * the fit is labelled as an estimate. The download is a network action
 * that the user confirms explicitly.
 */
import { useState } from 'react';
import type {
  LocalModelEntry,
  ModelFit,
} from '../../../shared/local-model-types';
import { useLocalModels } from './useLocalModels';

/** The text of a fit. */
const FIT_TEXT: Record<ModelFit, string> = {
  'likely-fine': 'Likely fine',
  slow: 'Slow',
  'may-not-fit': 'May not fit',
  unknown: 'Unknown',
};

/** The text of the capabilities of a model. */
function capabilityText(
  reported: boolean | undefined,
): string {
  if (reported === undefined) {
    return 'unknown — Ollama did not report any capability';
  }
  return reported ? 'yes — reported by Ollama' : 'no — Ollama did not report it';
}

/** Formats a number of bytes for the panel. */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

export interface LocalModelsProps {
  /**
   * Called when the list of the installed models changed.
   *
   * The chat reads its models again, so a model that was just
   * downloaded appears in the list without a restart.
   */
  onModelsChanged?: () => void;
  /**
   * Counts the changes of the provider settings.
   *
   * The catalog is read again when the address of the provider changed:
   * a different service can offer other models.
   */
  revision?: number;
}

export function LocalModels({
  onModelsChanged,
  revision = 0,
}: LocalModelsProps): React.JSX.Element {
  const models = useLocalModels(onModelsChanged, revision);
  const catalog = models.catalog;
  const download = models.download;
  const running = download !== null && !download.done;
  /** The model whose deletion waits for the confirmation. */
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <section className="ai-models" aria-label="Local models">
      <div className="ai-models__header">
        <h4 className="ai-models__title">Models</h4>
        <button
          type="button"
          className="ai-settings__action ai-models__action"
          onClick={models.refresh}
          disabled={models.busy}
        >
          Refresh
        </button>
      </div>

      {catalog === null ? (
        models.error !== null ? (
          <p className="ai-settings__error" role="alert">
            {models.error}
          </p>
        ) : (
          <p className="ai-settings__message" role="status">
            The models are read from Ollama…
          </p>
        )
      ) : (
        <>
          <p className="ai-models__hardware">
            {formatBytes(catalog.hardware.totalRamBytes)} of memory,{' '}
            {formatBytes(catalog.hardware.freeRamBytes)} free,{' '}
            {catalog.hardware.cpuCores} processors
            {catalog.hardware.diskKnown
              ? `, ${formatBytes(catalog.hardware.diskFreeBytes)} free on the drive of the models`
              : ', the free space of the drive of the models is unknown'}
            .
          </p>
          {catalog.hardware.notes.map((note) => (
            <p className="ai-models__note" key={note}>
              {note}
            </p>
          ))}

          {catalog.tooManyLoaded ? (
            <p className="ai-panel__notice" role="status">
              Several large models are loaded at the same time. That uses a
              lot of memory — unload one of them.
            </p>
          ) : null}

          {catalog.installed.length === 0 ? (
            <p className="ai-settings__message" role="status">
              No model is installed. Download one below to chat locally.
            </p>
          ) : (
            <ul className="ai-models__list" aria-label="Installed models">
              {catalog.installed.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  busy={models.busy}
                  deleting={deleteTarget === model.id}
                  onDetails={() => models.showDetails(model.id)}
                  onUnload={() => models.unload(model.id)}
                  onDelete={() => setDeleteTarget(model.id)}
                  onCancelDelete={() => setDeleteTarget(null)}
                  onConfirmDelete={() => {
                    setDeleteTarget(null);
                    models.remove(model.id);
                  }}
                />
              ))}
            </ul>
          )}

          {catalog.truncated ? (
            <p className="ai-models__note">
              Only the first {catalog.installed.length} models are shown.
            </p>
          ) : null}

          {models.details !== null ? (
            <div className="ai-models__details" aria-label="Model details">
              <p className="ai-models__details-title">{models.details.name}</p>
              <dl className="ai-models__details-list">
                <dt>Size</dt>
                <dd>{formatBytes(models.details.sizeBytes)}</dd>
                <dt>Parameters</dt>
                <dd>{models.details.parameterSize ?? 'unknown'}</dd>
                <dt>Quantization</dt>
                <dd>{models.details.quantization ?? 'unknown'}</dd>
                <dt>Family</dt>
                <dd>{models.details.family ?? 'unknown'}</dd>
                <dt>Tool calls</dt>
                <dd>{capabilityText(models.details.supportsToolCalls)}</dd>
                <dt>Vision</dt>
                <dd>{capabilityText(models.details.supportsVision)}</dd>
                <dt>Context length</dt>
                <dd>
                  {models.details.contextLength !== undefined
                    ? String(models.details.contextLength)
                    : 'unknown'}
                </dd>
                <dt>License</dt>
                <dd>{models.details.license ?? 'unknown'}</dd>
              </dl>
              <p className="ai-models__note">
                The capabilities are what Ollama reports. The application does
                not guess them.
              </p>
              <button
                type="button"
                className="ai-settings__action ai-models__action"
                onClick={models.closeDetails}
              >
                Close
              </button>
            </div>
          ) : null}

          <div className="ai-models__defaults">
            <label className="ai-models__default">
              <span>Default chat model</span>
              <select
                className="ai-panel__select"
                aria-label="Default chat model"
                value={models.defaults.chatModel}
                onChange={(event) => models.setChatModel(event.target.value)}
              >
                <option value="">none</option>
                {catalog.installed.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ai-models__default">
              <span>Default agent model</span>
              <select
                className="ai-panel__select"
                aria-label="Default agent model"
                value={models.defaults.agentModel}
                onChange={(event) => models.setAgentModel(event.target.value)}
              >
                <option value="">none</option>
                {catalog.installed.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            </label>
            {models.defaults.agentModel.length > 0 ? (
              <AgentWarning
                model={models.defaults.agentModel}
                catalog={catalog}
                toolSupport={models.agentToolSupport}
              />
            ) : null}
          </div>

          <div className="ai-models__download">
            <h4 className="ai-models__title">Download a model</h4>
            <div className="ai-settings__row">
              <input
                type="text"
                className="ai-settings__key"
                placeholder="Name of the model (for example qwen2.5:7b)"
                aria-label="Name of the model"
                autoComplete="off"
                value={models.downloadName}
                disabled={running}
                onChange={(event) => models.setDownloadName(event.target.value)}
              />
              <button
                type="button"
                className="ai-settings__action ai-models__action"
                onClick={models.startDownload}
                disabled={
                  running ||
                  models.busy ||
                  models.downloadName.trim().length === 0 ||
                  !models.confirmed
                }
              >
                Download
              </button>
            </div>
            <label className="ai-models__confirm">
              <input
                type="checkbox"
                checked={models.confirmed}
                disabled={running}
                onChange={(event) => models.setConfirmed(event.target.checked)}
              />
              The model is fetched from the registry of Ollama over the
              internet. The size of the download is not known before it
              starts.
            </label>
            {catalog.hardware.diskKnown ? (
              <p className="ai-models__note">
                {formatBytes(catalog.hardware.diskFreeBytes)} are free on the
                drive of the models.
              </p>
            ) : null}

            {download !== null ? (
              <div className="ai-models__progress" aria-label="Download progress">
                <p className="ai-models__progress-text">
                  {download.model}: {download.message}
                  {download.percent !== undefined
                    ? ` — ${download.percent} %`
                    : ''}
                  {download.completedBytes !== undefined
                    ? ` — ${formatBytes(download.completedBytes)}`
                    : ''}
                  {download.totalBytes !== undefined
                    ? ` of ${formatBytes(download.totalBytes)}`
                    : ''}
                  {download.bytesPerSecond !== undefined
                    ? ` — ${formatBytes(download.bytesPerSecond)}/s`
                    : ''}
                </p>
                {running ? (
                  <button
                    type="button"
                    className="ai-settings__action ai-models__action"
                    onClick={models.cancelDownload}
                  >
                    Stop the download
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {models.message !== null ? (
            <p className="ai-settings__message" role="status">
              {models.message}
            </p>
          ) : null}
          {models.error !== null ? (
            <p className="ai-settings__error" role="alert">
              {models.error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One row of the list of the installed models. */
function ModelRow({
  model,
  busy,
  deleting,
  onDetails,
  onUnload,
  onDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  model: LocalModelEntry;
  busy: boolean;
  deleting: boolean;
  onDetails: () => void;
  onUnload: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}): React.JSX.Element {
  return (
    <li className="ai-models__item" data-model={model.id}>
      <div className="ai-models__item-head">
        <span className="ai-models__item-name">{model.name}</span>
        {model.loaded ? (
          <span className="ai-models__badge" title="The model is loaded in the memory">
            loaded
          </span>
        ) : null}
      </div>
      <p className="ai-models__item-facts">
        {formatBytes(model.sizeBytes)}
        {model.parameterSize !== undefined ? ` · ${model.parameterSize}` : ''}
        {model.quantization !== undefined ? ` · ${model.quantization}` : ''}
        {model.family !== undefined ? ` · ${model.family}` : ''}
        {model.modifiedAt !== undefined
          ? ` · changed ${model.modifiedAt.slice(0, 10)}`
          : ''}
      </p>
      <p className="ai-models__fit" data-fit={model.fit}>
        {FIT_TEXT[model.fit]} (estimate)
        {model.fitNote !== undefined ? ` — ${model.fitNote}` : ''}
      </p>
      {deleting ? (
        <div className="ai-models__confirm-delete" role="alertdialog">
          <p className="ai-models__confirm-text">
            Delete the model “{model.name}” ({formatBytes(model.sizeBytes)})?
            The files are removed from the disk.
          </p>
          <div className="ai-models__item-actions">
            <button
              type="button"
              className="ai-settings__action ai-models__action ai-models__delete"
              onClick={onConfirmDelete}
              disabled={busy}
            >
              Delete the model
            </button>
            <button
              type="button"
              className="ai-settings__action ai-models__action"
              onClick={onCancelDelete}
              disabled={busy}
            >
              Keep the model
            </button>
          </div>
        </div>
      ) : (
        <div className="ai-models__item-actions">
          <button
            type="button"
            className="ai-settings__action ai-models__action"
            onClick={onDetails}
            disabled={busy}
          >
            Details
          </button>
          {model.loaded ? (
            <button
              type="button"
              className="ai-settings__action ai-models__action"
              onClick={onUnload}
              disabled={busy}
            >
              Unload
            </button>
          ) : null}
          <button
            type="button"
            className="ai-settings__action ai-models__action ai-models__delete"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * The warning for the default model of the agent.
 *
 * A model is only called suitable for the agent when Ollama reports
 * that it can call tools. When Ollama does not report the capability,
 * the panel says so instead of guessing.
 */
function AgentWarning({
  model,
  catalog,
  toolSupport,
}: {
  model: string;
  catalog: { installed: LocalModelEntry[] };
  toolSupport: boolean | undefined;
}): React.JSX.Element {
  const entry = catalog.installed.find((item) => item.id === model);
  if (entry === undefined) {
    return (
      <p className="ai-models__note" role="status">
        The default model of the agent is not installed any more.
      </p>
    );
  }
  const small = (entry.sizeBytes ?? 0) > 0 && (entry.sizeBytes ?? 0) < 4_000_000_000;
  let capability: string;
  if (toolSupport === true) {
    capability = 'Ollama reports that this model can call tools.';
  } else if (toolSupport === false) {
    capability =
      'Ollama does not report that this model can call tools — the agent ' +
      'will not work well with it.';
  } else {
    capability =
      'Ollama did not report whether this model can call tools, so the ' +
      'agent may not work with it.';
  }
  return (
    <p className="ai-models__note" role="status">
      {capability}
      {small
        ? ' Small models are unreliable for agent work — a bigger model ' +
          'answers better, but it needs more memory.'
        : ''}
    </p>
  );
}

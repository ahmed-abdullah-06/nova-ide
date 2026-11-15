# Testing the AI features with a real model (manual)

The automated tests never call a real model. They use deterministic mock
servers (an Ollama-compatible stream and an OpenAI-compatible stream) so a
test run:

- costs nothing,
- works without a network connection,
- never downloads a model, and
- never sends the content of this repository to a third party.

Real-model behaviour still has to be checked by hand before a milestone is
accepted. This document is the procedure for that check. It is **manual**:
nothing in `pnpm test`, `pnpm verify`, `pnpm package` or `pnpm make` calls a
paid API.

> The automated suites that this procedure complements:
> `pnpm test` (unit and integration tests, mock providers only),
> `pnpm verify` (the packaged application against a mock provider),
> `pnpm verify:fuses` and `pnpm verify:quitcleanup`.

## 1. Safety and cost rules

- Use a throwaway workspace (for example an empty temporary folder with one
  `notes.txt`). The agent can propose changes to the files of the open
  workspace; do not open a repository you cannot afford to modify.
- Never paste a secret into a task, a file or the chat. The agent redacts
  tool output before it goes back to the model, but the best protection is
  not to put a secret in front of it at all.
- A cloud provider is only used after the key is saved and the context of
  the run is approved in the panel. Each approval is for **one** run and is
  never remembered.
- Prefer the smallest useful model and a short task. A cloud test can still
  cost money: keep it to one or two runs, and remove the key when finished
  (Provider settings → **Remove key**).
- The Ollama route does not need a key and stays on this machine. Start with
  it; only run the cloud checklist when the local checklist passes.

## 2. Prerequisites

| Item | Notes |
|---|---|
| The packaged application | `pnpm package`, then start `apps/desktop/out/NOVA IDE-win32-x64/NOVA IDE.exe` (or use `pnpm dev`) |
| Ollama | Installed and running (`ollama serve`), with one small model pulled by hand, for example `ollama pull qwen2.5-coder:7b` |
| A cloud key (optional) | An OpenAI-compatible service and a key you are allowed to spend. Never commit it. |
| A clean profile | The manual test may use your normal profile; the automated harness always uses a temporary one |

The application never pulls a model automatically and never turns a provider
on by itself.

## 3. Local model checklist (Ollama)

### 3.1 Configure the provider

1. In the AI panel, open the settings (the provider settings section,
   `Provider settings` for assistive technology).
2. Select **Ollama (local)**, keep the address at `http://127.0.0.1:11434`
   (or the address of the service on this machine), and click
   **Test connection**.
3. Click **Switch on** if the provider is off. The provider badge must read
   **LOCAL**.
4. Select the pulled model in the model list.

Expected: the model list contains the model you pulled; a wrong address or a
stopped Ollama reports a clear error instead of an empty list.

### 3.2 The agent checklist

Switch the AI panel to **Agent** and run the steps in order.

| # | What to do | Expected result |
|---|---|---|
| 1 | Enter a read-only task (for example "List the files in this folder and explain what they are"). Start the run. | A **plan** appears before the first tool call. Approve it unchanged. The timeline shows the read tools; the report lists the inspected files. No file changes. |
| 2 | Enter a task that creates a file (for example "Create hello.txt with a short greeting"). Start; edit one plan step description; click **Approve edited plan**. | The timeline says the edited plan was approved. A proposal with a diff appears; the file is **not** on disk yet. Accept it: the file appears and the report lists the change. |
| 3 | Run the same kind of task again and click **Reject** on the plan. | The run ends as cancelled before any tool call; the disk is untouched. |
| 4 | Accept a proposal, then edit that file outside the application (or in another editor) and click **Revert the changes of this run…**. | The revert dialog marks the file as a conflict, the primary button is disabled ("Revert 0 files") until the checkbox is ticked. Tick it and revert: the file returns to its previous content. |
| 5 | Start a run that needs a command (for example "Run the tests and report the result") and approve the command request. | The command runs with its working directory inside the workspace, its output is shown, and the exit code is in the report. A failing command is reported as a failure, never as success. |
| 6 | Narrow a permission (AI panel → **Permissions** → uncheck **Read the workspace**), then start a read-only run. | The run asks for approval before the read. This is the safe direction; widening asks for a native confirmation and cannot be done by the model. Re-enable the category afterwards. |
| 7 | Start a run and click **Stop** while the model or a command is working. | The state becomes cancelled, the in-flight request stops and no process is left behind (check the terminal and the task runner). |
| 8 | Give a long task (many reads or a long prompt) with the local model. | If the context has to be shortened, a visible notice appears and the summary lists it. The safety rules of the system prompt are never dropped. |
| 9 | Open **Audit** in the agent panel. | Entries for the run, the tool calls, the approvals, the commands and the permission changes — metadata only, no file content, no secret. |

### 3.3 Model-specific notes

- A model with native tool calling (the OpenAI-compatible path) uses the
  native `tool_call` stream; a model without it uses the JSON protocol
  (`{"thought","tool"}` / `{"thought","final"}`). Both are valid.
- A malformed answer is repaired once and then reported. It is never
  executed. If a model consistently fails, use a bigger model rather than
  loosening a limit.

## 4. Cloud checklist (OpenAI-compatible)

Only run this after the local checklist passes.

1. Provider settings → **OpenAI compatible**.
2. Set the address (for example `https://api.openai.com/v1` or the address
   of a compatible gateway), save it, and confirm the "not on this machine"
   notice when it appears.
3. Save the key, click **Test connection**, then **Switch on**. The badge
   must read **CLOUD**.
4. Select the smallest model that can follow the protocol.
5. Start one short read-only agent task.
   - A privacy gate asks for the approval of the **context of this run**;
     the provider, the model and the scope are shown.
   - Only after the approval does the request leave the machine.
   - The approval is not remembered for the next run.
6. Repeat steps 1–2 and 5–9 of the local checklist once, with one small
   change, to confirm the same plan/proposal/permission/revert behaviour.
7. Remove the key (Provider settings → **Remove key**) and switch the
   provider off when finished.

Expected: no key is ever shown in the panel after saving, in the audit log,
in an error message, or in the renderer console. A cloud provider that is
not enabled, has no key, or has no approval for the run cannot start a run.

## 5. What to record when something fails

Capture, in this order:

1. the state of the run (planning, waiting for the plan, running, waiting
   for approval, completed, failed, cancelled);
2. the timeline entry and the final report of the run;
3. the audit entries of the run (metadata only);
4. the console output of the main process, with the key removed;
5. the model name, the size if it is local, and whether native tool calls
   were used.

Do not attach the content of a private file or an API key to a report.
Reproduce the failure first with a mock-based test when possible; if the
behaviour is covered by a test, add the missing case there instead of
relying on the manual run.

## 6. Cleanup

- Restore any permission category you narrowed.
- Remove the cloud key and switch the cloud provider off.
- Delete the throwaway workspace.
- Stop `ollama serve` if you started it only for this check.

## 7. Automated coverage vs. this procedure

| Area | Automated test | Manual check |
|---|---|---|
| Plan protocol, repair, degraded plan, edits, deviation tracking | `pnpm test` (planner tests) | Steps 1–3 |
| Permission categories, forbidden tools, widening confirmation | `pnpm test` (permission and controller tests) | Step 6 |
| Proposal diff, accept, conflict, revert conflict | `pnpm test`, `pnpm verify` | Steps 2 and 4 |
| Native tool-call translation and the text-diff fallback | `pnpm test` (mock OpenAI server, injectable Monaco loader) | Step 3.3 |
| Context bounding and the safety rules | `pnpm test` (context manager and loop) | Step 8 |
| Verification engine, test execution, recovery, audit | `pnpm test`, `pnpm verify` | Steps 1, 5, 9 |
| End-to-end plan answer, settings change and revert conflict in the packaged app | `pnpm verify` (mock provider) | The whole checklist |

The manual procedure is the only place where a real network request and a
real model are used. Everything else must pass without a network and
without a paid call.

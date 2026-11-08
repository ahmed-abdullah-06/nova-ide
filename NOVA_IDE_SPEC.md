# NOVA IDE — Complete Project Specification
## Product Vision, Technical Architecture, Features, Security, and Development Roadmap

**Project Name:** NOVA IDE  
**Project Type:** AI-Powered Desktop Integrated Development Environment  
**Product Category:** Professional AI Coding IDE  
**Target Platforms:** Windows, Linux, macOS  
**Development Approach:** Milestone-Based Development  
**Primary Architecture:** Hybrid Local AI + Cloud AI  
**Project Status:** Initial Development

---

# 1. Project Overview

## 1.1 What is NOVA IDE?

NOVA IDE is a professional, cross-platform, AI-powered desktop Integrated Development Environment designed to help developers write, understand, debug, test, and manage software projects.

NOVA IDE combines the functionality of a traditional code editor with an intelligent autonomous AI coding agent.

It should provide an experience inspired by modern development environments and AI coding tools such as:

- Visual Studio Code
- Cursor
- OpenCode
- Kiro

However, NOVA IDE is its own independent product. It must have its own architecture, interface, branding, and implementation.

The goal is not simply to create another text editor with a chatbot.

The goal is to build a complete development environment in which AI can understand an entire project, plan changes, work with files, execute approved commands, identify errors, run tests, and help verify that its changes work.

## 1.2 Main Product Philosophy

NOVA IDE should follow these principles:

1. **AI-Native:** AI assistance should be integrated into the development workflow.
2. **Developer Control:** Users must remain in control of their files, terminal, and system.
3. **Hybrid Intelligence:** Support both local and cloud AI models.
4. **Project Awareness:** AI should understand the structure and context of the complete workspace.
5. **Security First:** AI must not receive unrestricted access to the user's computer.
6. **Professional Experience:** The interface should be clean, responsive, consistent, and suitable for daily development.
7. **Extensible Architecture:** New AI providers, tools, languages, and features should be addable without rewriting the application.

---

# 2. Target Hardware and Development Environment

The initial development machine has the following specifications:

| Component | Specification |
|---|---|
| Operating System | Windows 11 |
| Processor | Intel Core i5-1145G7, 11th Generation |
| CPU Cores | 4 |
| Logical Processors | 8 |
| RAM | 16 GB |
| GPU | Intel Integrated Graphics |
| Runtime | Node.js |
| Local AI Runtime | Ollama |
| Local AI Model | Qwen 3.5 4B, if supported by the installed Ollama version |

## 2.1 Hardware Constraints

Development must consider the limitations of the initial machine.

The application should:

- Avoid unnecessary background processes.
- Avoid loading multiple large AI models simultaneously.
- Support lightweight local AI models.
- Use streaming AI responses.
- Release unused resources when appropriate.
- Avoid excessive memory usage.
- Keep the editor responsive while AI operations run.
- Support cloud AI for tasks that exceed local hardware capabilities.

Do not assume the computer has a dedicated NVIDIA GPU.

Local inference may run primarily on the CPU and can therefore be slower.

## 2.2 Local AI Strategy

Use Ollama as the initial local AI runtime.

The first local model to test is:

**Qwen 3.5 4B**

The application must not permanently hardcode this model.

Users should be able to select a model that is actually installed in their Ollama environment.

Provide:

- Ollama connection status.
- Installed model discovery.
- Model selection.
- Model availability checks.
- Model download guidance.
- Connection error handling.
- Model switching.
- Generation cancellation.
- Configurable context limits.

Never assume a model is installed simply because its name appears in the application.

---

# 3. Technology Stack

Use the following technology stack unless a documented technical limitation requires a change.

## 3.1 Desktop Application

**Electron**

Responsibilities:

- Create the desktop application.
- Manage application windows.
- Access operating-system functionality through the main process.
- Handle native menus and application lifecycle.
- Manage secure communication between the renderer and main process.

## 3.2 Frontend

**React + TypeScript**

Responsibilities:

- Build the user interface.
- Manage application state.
- Display editor tabs.
- Display file explorer.
- Display terminal.
- Display AI conversations.
- Display agent execution progress.
- Manage settings and dialogs.

Use modern React practices and reusable components.

## 3.3 Styling

Use CSS with a centralized design system.

Requirements:

- CSS variables for colors.
- Consistent spacing.
- Consistent typography.
- Reusable UI components.
- Responsive layouts.
- Dark and light themes.
- Accessible contrast.
- Smooth but restrained animations.

Avoid unnecessary UI libraries.

## 3.4 Build System

**Vite**

Use Vite for the renderer and the appropriate Electron build integration.

## 3.5 Desktop Packaging

**Electron Forge**

Use Electron Forge for application packaging and distribution.

Check the current official Electron Forge documentation before configuring the build system. Its Vite integration has been documented as experimental in some releases, so verify the current status and compatibility before relying on it.

## 3.6 Package Management

**pnpm workspaces**

Use pnpm for dependency management and the monorepo.

Configure the repository appropriately for Electron Forge and its packaging requirements.

Do not mix npm, Yarn, and pnpm lockfiles.

## 3.7 Code Editor

**Monaco Editor**

Monaco is the editor component used by Visual Studio Code.

Features:

- Syntax highlighting.
- Line numbers.
- Code editing.
- Multiple tabs.
- IntelliSense integration where supported.
- Search and replace.
- Diagnostics.
- Code formatting integration.
- Keyboard shortcuts.
- Theme support.
- Editor settings.

Do not build a custom code editor from scratch.

## 3.8 Backend Runtime

Use Node.js through Electron's main process and dedicated application services.

Responsibilities:

- Filesystem operations.
- Terminal operations.
- Git operations.
- AI orchestration.
- Provider connections.
- Database operations.
- Secure IPC handling.

## 3.9 Database

**SQLite + Prisma**

SQLite is the initial local database.

Prisma manages the database schema and data access.

## 3.10 Testing

- Vitest for unit tests.
- Integration tests for application services.
- Playwright for end-to-end testing where appropriate.

## 3.11 Additional Libraries

Evaluate these libraries when their corresponding features are implemented:

| Library | Purpose |
|---|---|
| node-pty | Integrated terminal |
| simple-git | Git operations |
| Prisma | Database ORM |
| Ollama API | Local AI |
| Whisper.cpp | Speech-to-text |
| Piper | Text-to-speech |

Do not install every dependency immediately. Add dependencies when the corresponding milestone requires them.

---

# 4. Overall Application Architecture

NOVA IDE should use a modular monorepo architecture.

The application must separate the user interface, desktop functionality, AI logic, providers, tools, and data storage.

## 4.1 High-Level Architecture

The application consists of the following major layers:

1. Desktop Main Process
2. Preload and Secure IPC Layer
3. Renderer and User Interface
4. Core Application Services
5. Editor Services
6. AI Agent Engine
7. AI Provider Layer
8. Tool Execution Layer
9. Voice Services
10. Database Layer

### Architecture Flow

User Interface  
↓  
React Application  
↓  
Typed Preload API  
↓  
Electron IPC  
↓  
Electron Main Process  
↓  
Application Services  
↓  
AI Agent / Filesystem / Terminal / Git / Database  
↓  
Local AI or Cloud AI Provider

The renderer must not directly access Node.js, operating-system APIs, or privileged filesystem operations.

---

# 5. Repository Structure

Use the following structure as the intended architecture.

Do not create hundreds of empty files immediately. Build the structure gradually as features are implemented.

```text
nova-ide/
│
├── apps/
│   └── desktop/
│       │
│       ├── src/
│       │   │
│       │   ├── main/
│       │   │   ├── index.ts
│       │   │   ├── window.ts
│       │   │   ├── menu.ts
│       │   │   ├── application/
│       │   │   ├── ipc/
│       │   │   └── security/
│       │   │
│       │   ├── preload/
│       │   │   └── index.ts
│       │   │
│       │   └── renderer/
│       │       │
│       │       ├── index.html
│       │       │
│       │       └── src/
│       │           ├── app/
│       │           ├── components/
│       │           ├── layouts/
│       │           ├── features/
│       │           │   ├── explorer/
│       │           │   ├── editor/
│       │           │   ├── terminal/
│       │           │   ├── agent/
│       │           │   ├── voice/
│       │           │   ├── git/
│       │           │   └── settings/
│       │           │
│       │           ├── hooks/
│       │           ├── stores/
│       │           ├── styles/
│       │           ├── utils/
│       │           └── main.tsx
│       │
│       ├── resources/
│       └── package.json
│
├── packages/
│   │
│   ├── core/
│   │   ├── workspace/
│   │   ├── events/
│   │   ├── commands/
│   │   └── configuration/
│   │
│   ├── editor/
│   │   ├── monaco/
│   │   ├── tabs/
│   │   └── language-services/
│   │
│   ├── agent/
│   │   ├── planner/
│   │   ├── context/
│   │   ├── executor/
│   │   ├── permissions/
│   │   ├── memory/
│   │   └── verification/
│   │
│   ├── providers/
│   │   ├── interfaces/
│   │   ├── ollama/
│   │   ├── openai/
│   │   └── router/
│   │
│   ├── tools/
│   │   ├── filesystem/
│   │   ├── terminal/
│   │   ├── git/
│   │   └── testing/
│   │
│   ├── voice/
│   │   ├── speech-to-text/
│   │   ├── text-to-speech/
│   │   └── conversation/
│   │
│   ├── database/
│   │   ├── prisma/
│   │   ├── repositories/
│   │   └── migrations/
│   │
│   └── shared/
│       ├── types/
│       ├── constants/
│       └── validators/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── architecture/
│   ├── agent/
│   ├── security/
│   └── development/
│
├── scripts/
├── .github/
│   └── workflows/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .npmrc
├── .gitignore
├── .env.example
└── README.md
```

---

# 6. Main User Interface

NOVA IDE must have a professional developer-focused interface.

The design should be inspired by the usability of modern IDEs, not a direct copy of another product.

## 6.1 Main Layout

The main application window should contain:

1. Activity Bar
2. Sidebar
3. Editor Area
4. AI Assistant Panel
5. Integrated Terminal
6. Status Bar
7. Top Application Controls

### Activity Bar

A vertical navigation area for switching between:

- Explorer
- Search
- Source Control
- AI Agent
- Extensions (future)
- Settings

### Sidebar

The sidebar changes according to the selected activity.

Examples:

- Explorer displays the workspace files.
- Search displays project search.
- Source Control displays Git changes.
- AI Agent displays conversations and agent sessions.

### Editor Area

The editor should be the primary workspace.

It must support:

- Multiple tabs.
- Active tab indication.
- File editing.
- Syntax highlighting.
- Dirty-file indicators.
- Closing tabs.
- File switching.
- Split editors in a later milestone.

### AI Assistant Panel

The AI panel should support:

- Chat input.
- Conversation history.
- Model selection.
- Provider selection.
- Streaming responses.
- Code block rendering.
- Copy response.
- Stop generation.
- Clear conversation.
- Agent mode.
- Chat mode.

### Integrated Terminal

The terminal should support:

- Opening terminal sessions.
- Multiple terminal tabs.
- Command execution.
- Terminal output.
- Resizing.
- Closing sessions.
- Stopping running processes.

### Status Bar

Display useful information such as:

- Current file language.
- Cursor position.
- File encoding.
- Git branch.
- AI provider status.
- Application status.

## 6.2 Design System

Create centralized design tokens.

Example:

```css
:root {
  --color-background: #111318;
  --color-sidebar: #171a21;
  --color-panel: #1c2029;
  --color-border: #2b303b;
  --color-text: #e5e7eb;
  --color-muted: #9299a6;
  --color-accent: #7c6cff;

  --sidebar-width: 260px;
  --activitybar-width: 52px;
  --statusbar-height: 24px;
}
```

These are initial design examples, not permanent colors.

Requirements:

- Support dark and light themes.
- Store theme preferences.
- Maintain consistent component sizing.
- Avoid excessive borders and shadows.
- Avoid unnecessary animations.
- Ensure the application works at common laptop resolutions.

---

# 7. File Explorer and Workspace Management

NOVA IDE must allow users to open and work with real folders on their computers.

## 7.1 Workspace Features

- Open folder.
- Display folder structure.
- Expand and collapse directories.
- Open files.
- Create files.
- Create folders.
- Rename files.
- Delete files.
- Refresh explorer.
- Detect external file changes.
- Show common file icons.
- Support hidden files through a setting.

## 7.2 Workspace Context

The currently opened workspace is the boundary for project-aware operations.

AI tools must operate inside the selected workspace unless a specific operation has been explicitly authorized.

Never allow an AI-generated path to bypass workspace restrictions.

Validate canonical filesystem paths, including symbolic links and path traversal attempts.

---

# 8. Monaco Code Editor

Monaco is the central code editing component.

## 8.1 Initial Language Support

Prioritize:

- JavaScript
- TypeScript
- HTML
- CSS
- JSON
- Python
- Java
- C
- C++
- Markdown
- SQL

Language support should grow over time.

## 8.2 Editor Features

- Syntax highlighting.
- Line numbers.
- Word wrapping.
- Automatic indentation.
- Multiple tabs.
- Unsaved changes indicator.
- Find and replace.
- Keyboard shortcuts.
- Code formatting integration.
- Editor themes.
- Font-size settings.
- Minimap toggle.
- Read-only mode where appropriate.

## 8.3 File Saving

Support:

- Save.
- Save As.
- Save All.
- Dirty-file detection.
- Confirmation before discarding unsaved changes.

Do not silently overwrite user files.

---

# 9. AI System — Core Product Feature

The AI system is one of the most important parts of NOVA IDE.

It should be designed as a modular agent architecture rather than a single chat component.

## 9.1 AI Operating Modes

Implement three modes.

### Mode 1: Chat Mode

The AI answers questions and explains code.

It can:

- Explain code.
- Suggest improvements.
- Generate snippets.
- Help debug errors.
- Answer programming questions.
- Discuss architecture.

Chat mode must not execute filesystem or terminal operations.

### Mode 2: Assistant Mode

The AI can work with selected code and available workspace context.

It can:

- Read selected files.
- Explain project structure.
- Suggest code modifications.
- Generate proposed changes.
- Prepare diffs.

Any modification to files must be presented for review or handled under the configured approval policy.

### Mode 3: Agent Mode

The AI can plan and execute multi-step development tasks using registered tools.

Example request:

"Create a login page, connect it to the existing authentication API, and test the implementation."

The agent should:

1. Understand the request.
2. Inspect the workspace.
3. Identify relevant files.
4. Prepare an implementation plan.
5. Explain the planned changes.
6. Request approval when required.
7. Execute authorized operations.
8. Review modified files.
9. Run relevant tests.
10. Report the outcome.

The agent must not claim that a task is complete if it has not verified the result.

---

# 10. AI Agent Architecture

Implement the agent as separate modules.

## 10.1 Planner

Responsibilities:

- Understand user instructions.
- Break complex tasks into smaller steps.
- Identify dependencies.
- Decide which tools are needed.
- Produce an execution plan.

## 10.2 Context Manager

Responsibilities:

- Collect relevant workspace information.
- Read requested files.
- Retrieve relevant code.
- Maintain conversation context.
- Avoid sending the entire workspace unnecessarily.
- Track context size and token limits.

Use selective retrieval rather than blindly loading every file.

Respect ignore files and configurable exclusions.

## 10.3 Model Router

Responsibilities:

- Select the appropriate AI provider.
- Choose local or cloud models.
- Check provider availability.
- Handle provider errors.
- Support user-selected models.
- Allow fallback only according to user settings.

Never silently upload private source code to a cloud provider.

The user must know when workspace content is being sent to an external service.

## 10.4 Tool Registry

All agent tools must be registered through a central registry.

Each tool should define:

- Unique ID.
- Name.
- Description.
- Input schema.
- Validation.
- Permission category.
- Execution handler.
- Result format.
- Error format.

## 10.5 Execution Engine

Responsibilities:

- Execute approved tool calls.
- Track task progress.
- Handle errors.
- Enforce timeouts.
- Support cancellation.
- Limit execution loops.
- Record execution results.

## 10.6 Verification Engine

Responsibilities:

- Inspect changes.
- Run appropriate checks.
- Compare expected and actual outcomes.
- Detect failed commands.
- Report unverified work honestly.

## 10.7 Conversation Manager

Responsibilities:

- Store conversations.
- Manage messages.
- Associate sessions with workspaces.
- Restore previous conversations.
- Track agent runs.
- Preserve useful task context.

---

# 11. AI Provider Architecture

NOVA IDE must support multiple AI providers through a common interface.

## 11.1 Initial Providers

### Local Provider

Ollama.

The user can run models locally without sending prompts to an external AI provider.

### Cloud Providers

Initially plan for:

- OpenAI-compatible APIs.
- OpenAI.
- Additional providers through independent adapters.

Do not assume every provider supports identical features.

Capabilities such as streaming, tool calling, vision, and structured output must be represented explicitly.

## 11.2 Provider Interface

Use a shared TypeScript interface.

Example:

```ts
interface AIProvider {
  id: string;
  name: string;

  getCapabilities(): ProviderCapabilities;

  chat(
    messages: ChatMessage[],
    options?: ChatOptions
  ): AsyncIterable<AIStreamEvent>;

  checkConnection(): Promise<ProviderStatus>;
}
```

Define shared types for:

- ChatMessage
- ChatOptions
- AIStreamEvent
- ProviderCapabilities
- ProviderStatus
- ToolCall
- ToolResult

Do not force providers to pretend they support capabilities they do not actually implement.

## 11.3 Ollama Integration

Use the official Ollama API.

Requirements:

- Detect Ollama availability.
- Retrieve installed models.
- Select the active model.
- Send chat messages.
- Stream responses.
- Support tool calls where the selected model supports them.
- Handle model errors.
- Handle connection failures.
- Stop generation when possible.

Do not assume all Ollama models support tool calling equally well.

Verify model capabilities before enabling agent mode.

## 11.4 Cloud AI Integration

Cloud providers should be implemented independently.

Requirements:

- Provider settings.
- API key management.
- Model selection.
- Streaming.
- Error handling.
- Rate-limit handling.
- Usage information where available.

Store credentials in operating-system secure credential storage.

Never save plaintext API keys in SQLite, logs, source files, or frontend state persisted to disk.

---

# 12. Agent Tools

The AI agent should interact with the computer only through controlled application tools.

Initial tool list:

| Tool | Purpose |
|---|---|
| read_file | Read workspace files |
| write_file | Create or update files |
| search_files | Search workspace content |
| list_directory | List directory contents |
| run_command | Execute an approved command |
| git_status | Inspect Git status |
| git_diff | Inspect code changes |
| run_tests | Execute project tests |

## 12.1 Filesystem Tools

All filesystem tools must:

- Validate workspace boundaries.
- Reject unauthorized paths.
- Handle missing files.
- Handle file permissions.
- Avoid accidental overwrites.
- Return structured errors.

## 12.2 Terminal Tool

The agent must never have unrestricted shell access.

Terminal execution must support:

- Command validation.
- User approval.
- Working-directory validation.
- Timeouts.
- Output limits.
- Cancellation.
- Process tracking.
- Exit-code reporting.

Commands that can delete files, change permissions, install software, modify system configuration, or access sensitive locations require explicit authorization.

## 12.3 Tool Permission Levels

Use at least these permission levels:

**Level 1 — Read Only**

Examples:

- Read files.
- Search files.
- List directories.
- Inspect Git status.

**Level 2 — Workspace Modification**

Examples:

- Create files.
- Edit files.
- Rename files.
- Delete workspace files.

**Level 3 — Command Execution**

Examples:

- Run tests.
- Execute scripts.
- Install dependencies.
- Start development servers.

**Level 4 — Sensitive or System-Level Operations**

Examples:

- Delete large directory trees.
- Modify files outside the workspace.
- Change system settings.
- Execute privileged commands.

Level 4 operations must never happen silently.

The user must be able to approve, reject, or cancel operations.

---

# 13. AI Planning and Execution Experience

The agent should display its activity transparently.

Example:

User request:

"Build a registration form with validation."

The interface should show:

1. Understanding the task.
2. Inspecting workspace.
3. Planning implementation.
4. Reading relevant files.
5. Preparing changes.
6. Waiting for approval if required.
7. Applying approved changes.
8. Running tests.
9. Reviewing results.
10. Final report.

Display:

- Current task.
- Current action.
- Tool being executed.
- Tool result.
- Approval requests.
- Errors.
- Cancellation control.

Do not expose private chain-of-thought reasoning. Display concise plans, actions, decisions, and execution summaries instead.

---

# 14. Hybrid AI Architecture

NOVA IDE must support both local and cloud AI.

## 14.1 Local AI

Advantages:

- Local processing.
- No external API key required for local models.
- Better privacy when prompts remain local.
- Useful for simple programming tasks.

Limitations:

- Hardware-dependent speed.
- Limited model size.
- Possible weaker reasoning and coding ability.
- Model-specific tool-calling limitations.

## 14.2 Cloud AI

Advantages:

- Access to more capable models.
- Better performance on complex tasks depending on the provider.
- No requirement to run large models locally.

Limitations:

- Internet required.
- API costs may apply.
- Rate limits.
- Source code may be sent externally.

## 14.3 Model Selection

The user should be able to select:

- Provider.
- Model.
- Mode.
- Context settings.
- Fallback preferences.

Possible future routing:

| Task | Suggested Route |
|---|---|
| Simple explanation | Local |
| Small code generation | Local |
| Basic debugging | Local |
| Complex architecture | Cloud |
| Large refactoring | Cloud |
| Long multi-step agent task | Cloud or capable local model |

This routing must remain configurable.

Do not automatically switch to cloud if the user selected local-only mode.

---

# 15. Voice Assistant

Voice interaction is a planned major feature.

It should be implemented after the core editor and AI agent are stable.

## 15.1 Speech-to-Text

Use Whisper.cpp as the initial local speech recognition option.

Responsibilities:

- Capture microphone audio after permission.
- Convert speech into text.
- Display recognized text.
- Allow correction before sending.
- Handle microphone errors.

## 15.2 Text-to-Speech

Use Piper as the initial local text-to-speech option.

Responsibilities:

- Convert AI responses into speech.
- Allow voice selection.
- Control speech speed.
- Start and stop playback.

## 15.3 Voice Interaction Flow

Microphone  
↓  
Speech-to-Text  
↓  
Recognized User Instruction  
↓  
AI Agent  
↓  
Response  
↓  
Text-to-Speech  
↓  
Speaker

## 15.4 Voice Features

Future capabilities:

- Push-to-talk.
- Continuous conversation.
- Voice-based coding instructions.
- Spoken task progress.
- Interruption.
- Stop speaking.
- Microphone controls.
- Voice settings.

Voice input must not automatically authorize destructive operations.

A spoken command to delete or modify important files must follow the same permission rules as typed instructions.

---

# 16. Git Integration

Use simple-git or another appropriate Git integration library.

Initial functionality:

- Detect Git repositories.
- Show current branch.
- Show modified files.
- Show staged files.
- Display Git status.
- Display diffs.
- Stage changes.
- Unstage changes.
- Commit changes.
- Switch branches.

Future functionality:

- Branch management.
- Merge support.
- Conflict resolution assistance.
- AI-generated commit messages.
- AI-assisted code review.

The AI agent must not automatically commit or push changes without appropriate user authorization.

---

# 17. Integrated Terminal

Use node-pty for terminal process management.

Requirements:

- Terminal panel.
- Multiple terminal sessions.
- Session creation.
- Session termination.
- Output streaming.
- Resizing.
- Current working directory.
- Command history where appropriate.

The terminal must work across supported operating systems.

Account for differences between:

- Windows PowerShell.
- Windows Command Prompt.
- Linux shells.
- macOS shells.

Do not assume every shell command is portable.

Do not expose unrestricted terminal access to the renderer.

---

# 18. Database Architecture

Use SQLite with Prisma.

The database should store local application information.

Initial entities:

## 18.1 Workspaces

Store:

- Workspace ID.
- Workspace path.
- Workspace name.
- Creation date.
- Last opened date.

## 18.2 Conversations

Store:

- Conversation ID.
- Workspace ID when applicable.
- Conversation title.
- Provider information.
- Creation date.
- Last updated date.

## 18.3 Messages

Store:

- Message ID.
- Conversation ID.
- Role.
- Content.
- Timestamp.
- Associated metadata.

## 18.4 Agent Runs

Store:

- Run ID.
- Conversation ID.
- Task description.
- Status.
- Start time.
- End time.

## 18.5 Tool Executions

Store:

- Execution ID.
- Agent run ID.
- Tool name.
- Input metadata.
- Result metadata.
- Status.
- Execution time.

Do not store secrets or sensitive raw command data unnecessarily.

## 18.6 Settings

Store:

- Theme.
- Editor preferences.
- Selected provider.
- Selected model.
- Application preferences.
- User-configurable agent permissions.

## 18.7 AI Providers

Store:

- Provider ID.
- Provider name.
- Configuration metadata.
- Enabled status.
- Selected model.

API secrets must be stored separately in secure operating-system credential storage.

## 18.8 Permissions

Store user-defined permission preferences and approval settings.

Never treat a previous approval as unlimited permission for unrelated future operations.

---

# 19. Security Architecture

Security is a core requirement, not a feature to add at the end.

Electron applications have access to powerful operating-system capabilities, so strict separation is essential.

## 19.1 Electron Security

Use:

- nodeIntegration: false
- contextIsolation: true
- sandbox: true

Use a secure preload bridge with contextBridge.

Expose only the specific APIs required by the renderer.

Never expose the complete Node.js API.

## 19.2 IPC Security

All IPC handlers must:

- Validate input schemas.
- Validate the sender.
- Validate permissions.
- Return structured results.
- Reject unexpected operations.
- Avoid exposing privileged internal objects.

## 19.3 Filesystem Security

Prevent:

- Path traversal.
- Unauthorized directory access.
- Unsafe symbolic-link traversal.
- Accidental deletion.
- Unauthorized external file modifications.

## 19.4 AI Security

Treat all model output as untrusted input.

This applies to:

- Local models.
- Cloud models.
- Tool-call arguments.
- Generated code.
- Suggested commands.
- Retrieved project content.

The agent must not follow instructions embedded in untrusted files that attempt to override the application's security policies.

Project instructions can guide coding behavior, but they cannot override permission checks or system security restrictions.

## 19.5 Secret Protection

Never:

- Hardcode API keys.
- Commit API keys.
- Print credentials in logs.
- Store API keys in plaintext SQLite.
- Expose API keys to the renderer.

## 19.6 Cancellation and Recovery

Provide:

- Stop generation.
- Cancel agent runs.
- Terminate running processes.
- Handle application crashes.
- Preserve safe task history.
- Report incomplete operations.

For important multi-file changes, use recoverable writes or a reviewable patch workflow.

---

# 20. Settings System

Create a dedicated settings area.

Initial categories:

**Appearance**
- Theme.
- Font size.
- Interface preferences.

**Editor**
- Tab size.
- Word wrap.
- Minimap.
- Auto-save.
- Formatting preferences.

**AI Providers**
- Ollama connection.
- Cloud provider configuration.
- Model selection.
- Default provider.

**AI Agent**
- Permission preferences.
- Maximum execution steps.
- Tool approval settings.
- Context limits.

**Terminal**
- Default shell.
- Font size.
- Terminal behavior.

**Voice**
- Microphone.
- Speech model.
- Voice model.
- Speaking speed.

**Privacy and Security**
- Local-only mode.
- Cloud sharing preferences.
- Logs.
- Credential management.

Only implement settings that have working functionality. Do not create decorative settings that do nothing.

---

# 21. Performance Requirements

NOVA IDE should remain usable on a laptop with 16 GB RAM and integrated graphics.

Requirements:

- Lazy-load heavy interface modules.
- Avoid unnecessary React re-renders.
- Stream AI responses.
- Avoid loading large project files into memory unnecessarily.
- Use background operations for expensive work.
- Provide progress indicators.
- Limit terminal output retained in memory.
- Support cancellation.
- Avoid unnecessary local model loading.
- Release resources when sessions are closed.

The application should remain responsive while AI generation, indexing, or terminal operations are running.

---

# 22. Cross-Platform Requirements

NOVA IDE must ultimately support:

- Windows
- Linux
- macOS

Do not write platform-specific functionality without an abstraction layer.

Pay particular attention to:

- Filesystem paths.
- Terminal shells.
- File permissions.
- Native dialogs.
- Packaging.
- Native dependencies.
- node-pty binaries.
- Credential storage.
- Microphone permissions.

Initial development and testing will happen on Windows.

Linux and macOS packaging and testing should be added in later milestones.

Do not claim cross-platform compatibility until it has been tested on the relevant operating systems.

---

# 23. Development Roadmap

Development must follow milestones.

Do not attempt to build the entire application at once.

## Milestone 1 — Desktop Foundation and Editor

Goal: Build the initial desktop application.

Tasks:

- Initialize monorepo.
- Configure Electron.
- Configure React.
- Configure TypeScript.
- Configure Vite.
- Configure pnpm.
- Create secure preload architecture.
- Create the initial application window.
- Build the main interface layout.
- Integrate Monaco Editor.
- Implement basic editor tabs.
- Configure basic themes.
- Create initial tests.
- Verify production build.

Definition of Done:

- Desktop application launches.
- Main interface renders.
- Monaco editor works.
- Code can be edited.
- Multiple tabs work.
- Security settings are correct.
- Application builds successfully.

## Milestone 2 — File Explorer and Workspace

Tasks:

- Open workspace.
- Display file tree.
- Expand and collapse folders.
- Open files.
- Create files.
- Create directories.
- Rename files.
- Delete files with confirmation.
- Save files.
- Validate workspace paths.

Definition of Done:

Users can open and manage a real project folder.

## Milestone 3 — Tabs, Search, Terminal, and Git

Tasks:

- Improve editor tabs.
- Add project-wide search.
- Integrate terminal.
- Support multiple terminal sessions.
- Integrate Git.
- Display source-control changes.
- Display diffs.

Definition of Done:

Users can perform normal development tasks without leaving NOVA IDE for basic editing, terminal, and Git workflows.

## Milestone 4 — AI Provider Integration

Tasks:

- Create AI provider interface.
- Integrate Ollama.
- Detect installed models.
- Add model selector.
- Implement streaming chat.
- Add conversation management.
- Add provider settings.
- Add cloud provider adapter.
- Add error handling.

Definition of Done:

Users can chat with local and supported cloud models.

## Milestone 5 — AI Agent and Tools

Tasks:

- Implement agent architecture.
- Implement context manager.
- Implement planner.
- Implement tool registry.
- Add filesystem tools.
- Add terminal tools.
- Add Git tools.
- Add execution tracking.
- Add cancellation.

Definition of Done:

The agent can perform controlled, multi-step workspace operations.

## Milestone 6 — Planning, Permissions, and Verification

Tasks:

- Display task plans.
- Add approval interface.
- Add permission categories.
- Add execution limits.
- Add verification engine.
- Add test execution.
- Add error recovery.
- Add audit history.

Definition of Done:

The agent can safely execute approved tasks and report verified results.

## Milestone 7 — Local AI and Model Management

Tasks:

- Improve Ollama integration.
- Improve model discovery.
- Add model capability detection.
- Add model management guidance.
- Improve local resource handling.
- Add local-only mode.
- Improve model routing.

Definition of Done:

Users can configure and use local AI effectively.

## Milestone 8 — Voice Assistant

Tasks:

- Integrate speech-to-text.
- Integrate text-to-speech.
- Add microphone controls.
- Add push-to-talk.
- Connect voice with AI conversations.
- Add stop and interruption controls.

Definition of Done:

Users can interact with the AI through voice.

## Milestone 9 — Advanced Computer-Control Agent

Tasks:

- Expand the controlled tool system.
- Add advanced application workflows.
- Improve task planning.
- Add better progress reporting.
- Improve recovery and verification.
- Add optional user-approved computer interaction.

All computer-control operations must remain permission-controlled.

Definition of Done:

The agent can perform more advanced development workflows while keeping the user in control.

## Milestone 10 — Extensions, Packaging, and Release

Tasks:

- Create extension architecture.
- Improve plugin management.
- Configure Windows packaging.
- Configure Linux packaging.
- Configure macOS packaging.
- Add update strategy.
- Add release documentation.
- Add automated CI.
- Perform security testing.
- Perform performance testing.

Definition of Done:

NOVA IDE has a stable, tested release process for its supported platforms.

---

# 24. Testing Strategy

Every milestone must include appropriate tests.

## Unit Tests

Test:

- Utility functions.
- Validators.
- Provider adapters.
- Agent components.
- Permission checks.
- Filesystem path validation.
- Shared types and transformations.

## Integration Tests

Test:

- IPC communication.
- Filesystem services.
- Database repositories.
- Ollama connections.
- Provider streaming.
- Agent tool execution.

## End-to-End Tests

Test:

- Application startup.
- Opening a workspace.
- Opening and editing a file.
- Saving changes.
- Switching tabs.
- Opening terminal.
- AI conversation.
- Agent approval.
- Cancellation.

## Security Tests

Test:

- Unauthorized IPC access.
- Path traversal.
- Invalid tool arguments.
- Unapproved command execution.
- Secret leakage.
- Renderer privilege isolation.

---

# 25. Documentation Requirements

Maintain project documentation as the application grows.

Required documents:

- README.md
- Architecture overview.
- Development setup.
- Environment configuration.
- AI provider integration guide.
- Agent architecture.
- Tool permission model.
- Database documentation.
- Security documentation.
- Testing guide.
- Build and packaging guide.
- Troubleshooting guide.

Update documentation when implementation changes.

Do not document features as completed unless they actually exist and have been tested.

---

# 26. OpenCode Development Instructions

This section is especially important.

OpenCode must use this document as the primary product specification for NOVA IDE.

## 26.1 First Action: Inspect the Project

Before modifying anything:

1. Inspect the existing repository.
2. Identify installed tools.
3. Inspect package files.
4. Inspect existing application structure.
5. Identify completed work.
6. Identify missing work.
7. Check compatibility between dependencies.
8. Report the current project state.

Do not assume the repository is empty.

Do not overwrite existing working code without a reason.

## 26.2 Work One Milestone at a Time

Start with Milestone 1.

Do not start implementing Milestones 2–10 until the earlier foundation is working.

Within a milestone, break work into small tasks.

For each task:

1. Explain what will be implemented.
2. Identify the files that need changes.
3. Implement the feature.
4. Run relevant checks.
5. Fix errors.
6. Summarize changes.
7. Update documentation where needed.

## 26.3 Code Quality

Follow these rules:

- Use TypeScript.
- Avoid unnecessary `any`.
- Prefer small, focused modules.
- Keep UI components reusable.
- Separate business logic from UI.
- Use clear naming.
- Validate external inputs.
- Handle errors properly.
- Avoid duplicated logic.
- Avoid unnecessary dependencies.
- Avoid huge single-file implementations.
- Use environment configuration appropriately.
- Keep code maintainable.

## 26.4 Dependency Management

Use pnpm workspaces.

Before adding dependencies:

1. Check whether the functionality already exists.
2. Check package compatibility.
3. Prefer maintained packages.
4. Avoid unnecessary dependencies.
5. Explain why the dependency is needed.

Do not mix lockfiles.

## 26.5 Research Before Implementation

When a library or API has changed, check its latest official documentation.

Prioritize official documentation for:

- Electron.
- Electron Forge.
- React.
- Vite.
- TypeScript.
- Monaco Editor.
- Ollama.
- Prisma.
- node-pty.

Do not invent APIs or use deprecated examples without explaining why.

## 26.6 Security Rules

Never weaken Electron security to make a feature work quickly.

Never set `nodeIntegration: true` as a shortcut.

Never expose unrestricted filesystem or terminal access to the renderer.

Never allow the agent to silently execute destructive commands.

Never put API keys in frontend code.

Never assume AI-generated code is safe.

## 26.7 Avoid Fake Implementations

Do not create buttons that do nothing.

Do not create decorative features and describe them as functional.

Do not use fake AI responses.

Do not simulate filesystem operations.

Do not mark a feature complete before testing it.

If a feature is not implemented, label it clearly as planned or unavailable.

## 26.8 Resource Awareness

Remember that the development machine has:

- 16 GB RAM.
- Intel Core i5-1145G7.
- Integrated Intel graphics.

Avoid unnecessarily large dependencies and resource-intensive background processes.

Do not require large local AI models for the application to start.

## 26.9 Progress Tracking

Maintain a development checklist.

For every milestone, track:

- Not Started.
- In Progress.
- Implemented.
- Tested.
- Completed.

Keep a CHANGELOG or development progress document.

A task should be marked completed only after its acceptance criteria have passed.

---

# 27. Milestone 1 — Immediate Implementation Instructions

After inspecting the repository, begin Milestone 1.

The immediate objective is to produce a working desktop IDE foundation.

Implement in this order:

1. Verify Node.js, pnpm, and Git.
2. Initialize the monorepo if it does not already exist.
3. Configure Electron Forge.
4. Configure Vite and React.
5. Configure TypeScript.
6. Configure secure Electron main and preload processes.
7. Create the application window.
8. Create the initial NOVA IDE interface.
9. Integrate Monaco Editor.
10. Implement editor tabs.
11. Add basic styling and themes.
12. Add basic tests.
13. Run the application.
14. Run the production build.
15. Verify the security configuration.

Do not implement AI agents, voice, terminal, Git, or database functionality during the first milestone unless a minimal dependency is genuinely required by the foundation.

The first milestone must produce a working application, not just a folder structure.

---

# 28. Final Product Vision

The long-term goal is to make NOVA IDE a complete AI-powered development environment.

A developer should eventually be able to:

- Open a software project.
- Explore its complete structure.
- Edit code.
- Use an integrated terminal.
- Manage Git.
- Ask AI questions.
- Understand unfamiliar codebases.
- Request complex changes.
- Allow AI to plan tasks.
- Review proposed changes.
- Approve file modifications.
- Execute controlled commands.
- Run tests.
- Verify results.
- Speak to the AI assistant.
- Use local or cloud AI models.
- Manage development workflows in one application.

NOVA IDE should combine the control and flexibility of a traditional IDE with the intelligence and automation of an AI coding agent.

**The central objective is not to build everything quickly. It is to build a reliable, secure, modular, professional product that can grow into a complete AI development environment.**

---

# 29. Official Technical References

Use these official sources when implementing the project:

- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron Forge: https://www.electronforge.io/
- Electron Forge Vite + TypeScript Template: https://www.electronforge.io/templates/vite-+-typescript
- React: https://react.dev/
- Vite: https://vite.dev/
- TypeScript: https://www.typescriptlang.org/docs/
- Monaco Editor: https://microsoft.github.io/monaco-editor/
- Ollama: https://docs.ollama.com/
- Ollama API: https://docs.ollama.com/api
- Prisma: https://www.prisma.io/docs
- Vitest: https://vitest.dev/
- Playwright: https://playwright.dev/

**End of NOVA IDE Project Specification.**
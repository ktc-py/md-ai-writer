# NoteCraft AI

NoteCraft AI is an Obsidian plugin for AI-assisted Markdown writing, vault search, and note editing.

Plugin id: `md-ai-writer`

## Features

- Chat, Edit, Search, and New modes in a compact command composer.
- Slash mode switches: `/chat`, `/edit`, `/search`, and `/new`.
- DeepSeek and custom OpenAI-compatible API endpoints.
- Multiple saved custom providers and models.
- AI file actions for creating, replacing, appending, and rewriting Markdown notes through Obsidian's Vault API.
- Folder-scoped vault search with local prefiltering, optional Voyage rerank, and capped chat payloads.
- Multiple Markdown notes and previous chat sessions can be attached as context.
- Command to reference the current Markdown note, with default hotkey `Ctrl/Cmd+Shift+R`.
- Saved chat history can be opened back into the chat panel as a session.
- File creation uses sanitized vault-relative paths and automatically picks a numbered filename when a create target already exists.
- Failed file actions and chat workflow errors are appended to `notecraft-ai/bug-log.md`.
- User-managed quick prompts through `/`.
- Chinese and English UI language setting.
- Configurable interface font.
- Conversation memory file.
- Markdown-based settings profile import/export.
- Mobile-compatible core workflow. Obsidian CLI helpers are desktop-only.

## BRAT Installation

1. Install BRAT from Obsidian's community plugin browser.
2. Enable BRAT and open BRAT settings.
3. Click `Add beta plugin`.
4. Enter this repository URL:

```text
https://github.com/ktc-py/md-ai-writer
```

5. Enable the plugin after installation.

## Manual Installation

1. Download or clone this repository.
2. Copy these files into your vault plugin folder:

```text
.obsidian/plugins/md-ai-writer/manifest.json
.obsidian/plugins/md-ai-writer/main.js
.obsidian/plugins/md-ai-writer/styles.css
```

3. Enable `NoteCraft AI` in Obsidian community plugins.

## Development

```powershell
npm.cmd install
npm.cmd run build
npm.cmd exec tsc -- --noEmit
```

The built plugin files used by Obsidian are:

- `manifest.json`
- `main.js`
- `styles.css`

## Settings Notes

The plugin stores local settings in Obsidian's plugin data file, normally:

```text
.obsidian/plugins/md-ai-writer/data.json
```

This file can contain API keys and is intentionally ignored by Git.

Settings can also be exported to a private Markdown profile from inside the plugin. The default vault folder for user-facing NoteCraft AI files is `notecraft-ai/`.

The technical plugin id and Obsidian installation folder remain `md-ai-writer` for compatibility. User-facing vault files use the `notecraft-ai` name.

## Privacy

Do not commit local `data.json` files or exported settings profiles that contain API keys.

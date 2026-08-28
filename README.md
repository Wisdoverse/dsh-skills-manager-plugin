# dsh-skills-manager

[简体中文](README.zh-CN.md) | **English**

A skill management plugin for DeepSeek Harness that makes skills **proactively used**. It supports **skill-level hook declarations**, **GitHub synchronization and updates**, and a **Settings management UI**. Its design is aligned with Claude Code (SKILL.md + hooks + plugin marketplace) and the OpenAI Codex skill system.

## Background

DSH's built-in `skill` tool has only one usage path: after seeing the `<available_skills>` summary, the model **decides on its own** whether to call the `skill` tool and load the full instructions. As a result:

- Models often do not call the tool, leaving many skills unused.
- SKILL.md cannot declare activation conditions and has no hook integration point—nothing in a skill file can be executed.
- Skills are scattered across local directories and cannot be updated from GitHub with one click.

The DSH host already provides a complete event hook system (`agent/pre-step`, `tools/pre-execute`, `tools/post-execute`, `tools/result`, `system-prompt/assemble`, `skills/change`, and more), equivalent to Claude Code's UserPromptSubmit, PreToolUse, and PostToolUse events, but nothing connects skill declarations to those hooks. This plugin provides that missing integration.

## Features

### 1. Proactive activation (`agent/pre-step` hook)

Before every step, the plugin matches the user's message against every skill and injects matches at one of two levels:

| Level | Condition | Injected content |
| --- | --- | --- |
| **Automatic loading (`auto`)** | A skill declares triggers (or `metadata.activation: auto`) and matches | Full `<skill_content>` plus a reminder that the skill is already loaded and the model should not call the `skill` tool again |
| **Suggested loading (`suggest`)** | The description or `whenToUse` has high token overlap | A lightweight `<system-reminder>` listing matching skills and reasons, prompting the model to call the `skill` tool when appropriate |

Match scoring: explicit skill-name mention (+12) > trigger phrase or regular expression (+7) > description token overlap (+4–6). By default, each turn loads at most two skills automatically and suggests three; both limits are configurable.

**Deduplication and context:** activation markers are stored in conversation history as `skill-manager` source messages. As long as a marker remains visible in the context surface, the same skill's full content is not injected again. After compaction removes it, the skill can be injected again automatically. Within the same message batch, an existing injection is also skipped.

### 2. Skill-level hooks (aligned with Claude Code and Codex)

The DSH host already exposes the necessary hook events. This plugin connects skill declarations to those events with a one-to-one mapping to Claude Code hook names:

| Claude Code hook | DSH host event | Plugin implementation |
| --- | --- | --- |
| `UserPromptSubmit` | `agent/pre-step` | ✅ When the skill is active in the session, injects `hooks.UserPromptSubmit.inject` on every submission |
| `PreToolUse` | `tools/pre-execute` | ✅ Returns **allow / deny / ask** (`decision` + `reason`) based on tool name and argument patterns |
| `PostToolUse` | `tools/post-execute` | ✅ When a tool result matches `when`, immediately appends the skill instructions to the next step (`activate`) |
| `PostToolUseFailure` | `tools/post-execute` (errors arrive through the same event) | ✅ Same as PostToolUse; `when: "re:exit code [1-9]"` triggers on failure |
| `SessionStart` | `agent/session-start` | ✅ Loads on the first step without matching (`SessionStart.activate`) |
| `SessionEnd` / `Stop` | `agent/disposed` / `agent/turn-stopping` | ⚠️ Observable through `skill-manager/hook`, with no content injection |
| `PreCompact` | No corresponding core event | ⚠️ Not implemented; activation markers disappear after compaction, allowing automatic reinjection |

Codex terminology is supported through aliases: `manual` and `disabled` are equivalent to this plugin's `off` mode and require explicit invocation. Codex's `auto` (the model may invoke a skill when needed) corresponds to this plugin's `suggest` mode.

**Declarations in SKILL.md** (implemented entirely through `metadata`, with no DSH core changes):

```yaml
---
name: repo-hardening
description: Review and harden a repository with build/test gates.
metadata:
  activation: auto             # auto | suggest | off (manual/disabled aliases are supported)
  triggers:
    - "harden"
    - "build fails"
    - "re:exit code \\d+"
  hooks:
    UserPromptSubmit:          # Injected every turn while this skill is active
      inject: "Hard requirement: run build and tests before reaching a conclusion."
    PreToolUse:                # Tool-call gate
      - tool: bash
        when: "git push"       # Substring or re:<pattern>; omitted means all calls
        decision: deny         # allow | deny | ask
        reason: "Direct pushes are not allowed"
    PostToolUse:               # Tool result immediately activates this skill
      - tool: bash
        when: "re:exit code [1-9]"
        action: activate
    SessionStart:              # Activate at session start without matching
      activate: true
---
```

- `triggers`: an array of strings. Plain entries are case-insensitive substring matches; entries starting with `re:` are regular expressions. Invalid regular expressions are ignored.
- `activation`: the default level when the skill matches. If omitted, skills with triggers use `auto`; all others use `suggest`.
- `hooks`: Claude Code event names plus structured actions. `PreToolUse.tool` accepts `*` as a wildcard for all tools.

**Host-level observable events:** in addition to `skills/change`, the plugin emits:

- `skill-manager/hook` — `{ event, skill, action, detail, at }`, for events such as PreToolUse denial or PostToolUse activation.
- `skill-manager/update` — synchronization results after install, update, or uninstall operations.

**User-side overrides (recommended for third-party repositories):** because upstream updates overwrite `metadata`, triggers and hooks can also be stored in plugin state. Stored settings are merged with declarations, or replace them per event:

```sh
# Use the trigger input in Settings, or ask the model to call:
skill_manager set-triggers ponytail-review triggers=["review this diff","over-engineering"]
skill_manager set-hooks repo-hardening hooks={ "PostToolUse": [{ "tool": "bash", "when": "re:exit code [1-9]", "action": "activate" }] }
```

### 3. Install and update from GitHub

- **Install:** `install <owner/repo|git-url> [ref]` accepts either the `owner/repo` shorthand used by Claude/Codex marketplaces or a full Git URL. It performs a shallow, single-branch clone into `<DSH_HOME>/skill-sources/<slug>`, discovers directories containing `SKILL.md` up to depth 3 (excluding `.git`, `node_modules`, `dist`, and `build`), and copies each skill directory into `<DSH_HOME>/skills/<name>`. Skill names come from the frontmatter `name` field.
- **Plugin packages:** `.codex-plugin/plugin.json` is preferred, followed by `.claude-plugin/plugin.json`. The management page displays the plugin name, version, skills, and hook count. Node lifecycle hooks referenced by the manifest can run for `SessionStart` and `UserPromptSubmit`; other events or command-based hook types are marked unsupported.
- **Update:** for every source, `update` runs `git fetch --depth 1 origin <ref>` followed by `git reset --hard FETCH_HEAD`, then performs an **authoritative sync** by deleting old copies and recopying installed skills. The result reports commit changes for each skill (old → new).
- No manual refresh is needed after an update. The filesystem skill provider invalidates its cache through file watching, re-emits `skills/change`, and refreshes the model's skill catalog.
- State is stored in `<DSH_HOME>/skill-manager.json`, including sources, refs, commits, install paths, user mode overrides, and the 50 most recent operations.

Security: Git sources are restricted to an allowlist (`owner/repo`, `https://`, `git@`, and `ssh://`), arguments are passed directly to `git` as an array, and hooks never run through a shell. Only Node scripts referenced by a manifest and located inside the repository can be executed. Installing a plugin that contains hooks means trusting its code.

### Project-specific workspace skills

The filesystem provider scans multiple roots based on `cwd`, ordered from highest to lowest priority:

| Root | Path | `source` value |
| --- | --- | --- |
| Project-specific | `<project>/.dsh/skills` | `project-dsh` |
| Project-specific | `<project>/.agents/skills` | `project-agents` |
| Custom | Host-configured directory | `custom` |
| User-level | `<DSH_HOME>/skills` | `user-dsh` |
| User-level | `<agentsHome>/skills` | `user-agents` |
| Built-in | Bundled | `bundled` |

The plugin handles project skills as follows:

- **Proactive matching and automatic activation:** pre-step calls `ctx.skills.snapshot({cwd, scope})` for each session. Project and user-level skills participate equally in scoring and injection; for duplicate names, the project root wins automatically because it has a lower rank.
- **Isolated override scopes:** `set-mode`, `set-triggers`, and `set-hooks` records are stored by `scope` (`user` or `project`) plus `cwd`. A project skill's same-name settings apply only to that workspace and never leak into user-level settings, or vice versa.
- **Management UI:** Settings → Skill Management includes a “Project workspace cwd” field. Leaving it blank lists user-level and built-in skills; entering a path also lists that project's skills. Each row shows the source badge and allows editing the name, triggers, hooks, and mode. Web Settings has no agent preset, so the manager directly merges first-level valid skills from `<DSH_HOME>/skills`; if a project skill has the same name, its catalog entry remains authoritative.
- **Model tool:** `skill_manager status|set-*` supports `scope: project` plus `cwd: <path>`. Project records must include `cwd`.
- **Hook indexes are built per cwd:** every workspace gets an independent PreToolUse, PostToolUse, and SessionStart hook index. The same project session uses the same index; directory changes invalidate it through `skills/change`.
- **Update model:** project skills are managed by the project's own Git repository. The manager's `update` operation synchronizes only user-level sources, while the watcher refreshes project-local changes automatically.

### 4. Settings UI and model tool

- **Settings → “Skill Management”:** master switch for proactive usage, maximum automatic loads per turn, “Update from GitHub” button, Git repository installation form, mode selector (`auto` / `suggest` / `off`) for each skill, trigger display, Git source and commit details, uninstall button, and recent history.
- **Model tool `skill_manager`:** `status`, `install <url>`, `update`, `uninstall <name>`, `set-mode <name> <mode>`, and `set-config`. Saying “update skills from GitHub” is enough to trigger it.

## Installation

```sh
# 1. Link the plugin directory into the web profile (or use the dsh plugin command)
cd /data/dsh/profiles/web
pnpm add link:/data/dsh/home/dsh-skills-manager

# 2. Add the package name to dsh.profile.bundles in the profile's package.json:
#    "dsh-skills-manager"
# 3. Restart the web profile so the host-side plugin takes effect;
#    the client bundle will rebuild automatically.
```

The plugin adds a `skill-manager` entry to the composition through its own `cordis.patch.yml` and applies at the host level to **all sessions**.

## Skill directory conventions

- Managed skills live in `<DSH_HOME>/skills`, the filesystem provider's user root.
- Locally authored skills are not managed by Git. Only skills installed from a source can be updated or removed.
- `set-mode off` disables automatic participation, but the model can still invoke the skill manually through the `skill` tool.

## Extension: connect more input sources to the matcher

Tool-output activation is built in through the `PostToolUse` hook. Other plugins can still contribute inputs through host events, for example by adding an external notification to the prompt:

```js
ctx.on("agent/pre-step", async (payload, next) => {
  const decision = await next();
  if (decision.kind !== "enter") return decision;
  // Append custom context to this step
  return { kind: "enter", messages: [...decision.messages, extra] };
});
```

## Development and testing

```sh
pnpm test      # node --test test.mjs; 18 pure-logic test cases
pnpm lint      # node --check
```

`lib.js` (matching, scoring, state, and manifest handling) contains pure functions and can be tested directly. `index.js` is responsible only for integration: events, tools, RPC, and Git.

## License

MIT

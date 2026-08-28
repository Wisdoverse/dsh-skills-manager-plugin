/**
 * dsh-skills-manager — host half.
 *
 * Gives DSH skills what Claude Code / Codex skills get from a plugin host:
 *
 * 1. **Proactive activation (agent/pre-step hook).** Every proposed step the
 *    manager inspects the user text, matches it against each skill's declared
 *    `metadata.triggers` / `metadata.activation` (or its description and
 *    `whenToUse`), and injects either the full `<skill_content>` (auto mode)
 *    or a lightweight match notice (suggest mode) into the step — so skills
 *    are actually used instead of waiting for the model to remember the
 *    `skill` tool. Skills stay active while their activation marker is in the
 *    visible surface; compaction causes a clean re-injection.
 *
 * 2. **Skill-level hooks.** A skill declares its hooks declaratively in
 *    SKILL.md frontmatter (`metadata.triggers`, `metadata.activation`) — the
 *    equivalent of Claude Code's settings hooks — and the manager connects
 *    them to the host event seam. Manager lifecycle emits
 *    `skill-manager/update` so other plugins can hook into sync results.
 *
 * 3. **GitHub source sync.** Skills can be installed from any git repository
 *    (cloned once into `<DSH_HOME>/skill-sources`, skill directories copied
 *    into `<DSH_HOME>/skills`), and updated in place with `git fetch` +
 *    `reset --hard`; the filesystem skill provider watcher then republishes
 *    the model catalog automatically. A manifest at
 *    `<DSH_HOME>/skill-manager.json` records sources, commits, modes, and a
 *    sync history.
 *
 * 4. **Model tool + Settings RPC.** The `skill_manager` tool lets the agent
 *    itself run status / install / update / set-mode; the web client settings
 *    section drives the same host actions over a private RPC channel.
 *
 * Security: git URLs are protocol-allowlisted and passed to `git` as plain
 * argv (no shell); skill directories are never executed; sync uses fetch +
 * reset over the recorded ref, so a skill's instructions alone cannot escape
 * their own content.
 *
 * @module dsh-skills-manager
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile, rename, cp, stat } from "node:fs/promises";
import { basename, join, dirname } from "node:path";

import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { renderSkillContent, isModelInvocable, isSkillName } from "@deepseek-ai/dsh-skill";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

import {
  ACTIVATION_MODES,
  defaultState,
  parseStateText,
  serializeState,
  validateState,
  rankSkills,
  selectActivations,
  activationStateOf,
  batchHasInjection,
  renderActivationReminder,
  renderSuggestionNotice,
  normalizeGitSourceUrl,
  findSkillDirs,
  readPluginPackage,
  shortCommit,
  pushEvent,
  mergeTriggers,
  resolveActivationMode,
  normalizeHooks,
  hookCount,
  matchHookWhen,
  toolCallText,
  resultText,
  activeSkillNames,
  sanitizeHooks,
  recordMatches,
  scopeOfRecord,
} from "./lib.js";

export const name = "dsh-skills-manager";
export const inject = ["skills", "tools"];

const CHANNEL = "/skill-manager";
const GIT_TIMEOUT_MS = 180_000;
const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_HOOK_BYTES = 256 * 1024;
const SKIP_COPY_SEGMENTS = new Set([".git", "node_modules", "dist", "build"]);

/** Model tool action set. */
const ACTIONS = ["status", "install", "update", "uninstall", "set-mode", "set-triggers", "set-hooks", "set-config", "refresh"];

function success(value) {
  return { ok: true, value };
}

function failure(message, code = "internal") {
  return { ok: false, error: { code, message, details: {} } };
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function runGit(cwd, args, signal) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_LOG_BYTES, encoding: "utf8", signal },
      (error, stdout, stderr) => {
        if (error) {
          const detail = String(stderr || "").trim() || String(stdout || "").trim() || messageOf(error);
          reject(new Error(detail || "git failed"));
          return;
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

async function hasGit() {
  try {
    await runGit(process.cwd(), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function sourceSlug(url, index) {
  const clean = url.replace(/\.git$/i, "").replace(/\/+$/, "");
  const last = clean.split("/").pop() || "repo";
  const safe = last.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 64);
  return `${safe}-${index}`;
}

function pluginHookContext(stdout) {
  const text = String(stdout ?? "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const context = parsed?.hookSpecificOutput?.additionalContext ?? parsed?.additionalContext;
    return typeof context === "string" ? context : "";
  } catch {
    return text;
  }
}

function copyFilter(source) {
  const segment = basename(source);
  return !SKIP_COPY_SEGMENTS.has(segment);
}

export function apply(ctx) {
  const home = resolveDshHome();
  const stateFile = join(home, "skill-manager.json");
  const sourcesRoot = join(home, "skill-sources");
  const skillsRoot = join(home, "skills");
  const pluginDataRoot = join(home, "plugin-data");

  /** @type {ReturnType<typeof defaultState> | null} */
  let state = null;

  async function loadState() {
    if (state !== null) return state;
    try {
      state = parseStateText(await readFile(stateFile, "utf8"));
    } catch (error) {
      state = defaultState();
      state.events = pushEvent(state, "state", `state read failed, using defaults: ${messageOf(error)}`);
    }
    if (state === null) {
      state = defaultState();
      pushEvent(state, "state", "state file was unreadable; using defaults");
    }
    return state;
  }

  async function saveState() {
    const current = await loadState();
    await mkdir(dirname(stateFile), { recursive: true });
    const temp = `${stateFile}.tmp`;
    await writeFile(temp, serializeState(current), "utf8");
    await rename(temp, stateFile);
  }

  function applyState(patch) {
    state = validateState({ ...state, ...patch });
    return state;
  }

  function notifyUpdate(detail) {
    const payload = { at: new Date().toISOString(), ...detail };
    Promise.resolve(ctx.events.dispatch("emit", ["skill-manager/update", payload])).catch((error) => {
      ctx.logger.warn(`skill-manager/update listener rejected: ${messageOf(error)}`);
    });
  }

  /** Current state file is authoritative; write helpers below. */

  // -------------------------------------------------------------------------
  // Claude Code / Codex parity hook layer.
  // -------------------------------------------------------------------------
  /** Sessions with skills marked active in-memory (WeakMap: session → Set<name>). */
  const activeSessions = new WeakMap();
  /** Sessions with skills pending activation from `hooks.SessionStart`. */
  const sessionStarts = new WeakMap();
  /** Per-cwd hook index rebuilt lazily; cleared on `skills/change`. */
  const hookIndex = new Map();
  /** Plugin command hooks run once per session/turn, like their host events. */
  const pluginSessions = new WeakSet();
  const pluginTurns = new WeakMap();

  ctx.on("skills/change", () => {
    hookIndex.clear();
  });

  function sessionActiveSet(agent) {
    const session = agent && agent.session;
    if (session === undefined) return new Set();
    return activeSessions.get(session) ?? new Set();
  }

  function sessionActiveOf(agent, name) {
    const session = agent && agent.session;
    if (session === undefined) return false;
    const set = activeSessions.get(session);
    return set !== undefined && set.has(name);
  }

  function markSessionActive(agent, name) {
    const session = agent && agent.session;
    if (session === undefined) return;
    let set = activeSessions.get(session);
    if (set === undefined) {
      set = new Set();
      activeSessions.set(session, set);
    }
    set.add(name);
  }

  function emitHook(event, skill, action, detail = "") {
    const payload = { at: new Date().toISOString(), event, skill, action, detail };
    Promise.resolve(ctx.events.dispatch("emit", ["skill-manager/hook", payload])).catch((error) => {
      ctx.logger.warn(`skill-manager/hook listener rejected: ${messageOf(error)}`);
    });
  }

  async function runPluginHook(source, hook, payload, signal) {
    const pluginRoot = source.clonePath;
    const dataDir = join(pluginDataRoot, basename(pluginRoot));
    await mkdir(dataDir, { recursive: true });
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [join(pluginRoot, hook.script)],
        {
          cwd: pluginRoot,
          env: {
            ...process.env,
            CLAUDE_PLUGIN_ROOT: pluginRoot,
            CODEX_PLUGIN_ROOT: pluginRoot,
            PLUGIN_ROOT: pluginRoot,
            PLUGIN_DATA: dataDir,
          },
          timeout: Math.min(30_000, Math.max(1_000, Number(hook.timeoutMs) || 5_000)),
          maxBuffer: MAX_HOOK_BYTES,
          encoding: "utf8",
          signal,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(String(stderr || "").trim() || messageOf(error)));
            return;
          }
          resolve(String(stdout ?? ""));
        },
      );
      child.stdin?.end(JSON.stringify(payload));
    });
  }

  async function pluginHookInjections(current, agent, prompt, turn, step, signal) {
    const session = agent?.session;
    if (!session) return [];
    const events = [];
    if (!pluginSessions.has(session)) {
      pluginSessions.add(session);
      events.push("SessionStart");
    }
    if (!pluginTurns.has(session) || pluginTurns.get(session) !== turn) {
      pluginTurns.set(session, turn);
      events.push("UserPromptSubmit");
    }
    const injections = [];
    for (const event of events) {
      const payload = event === "UserPromptSubmit"
        ? { hook_event_name: event, prompt, cwd: session.header?.cwd }
        : { hook_event_name: event, source: "startup", cwd: session.header?.cwd };
      for (const source of current.skillSources) {
        for (const hook of source.plugin?.hooks ?? []) {
          if (hook.event !== event) continue;
          try {
            const context = pluginHookContext(await runPluginHook(source, hook, payload, signal));
            emitHook(event, source.plugin.name, "command", hook.script);
            if (!context) continue;
            injections.push(createUserMessage({
              content: [{ type: "text", text: `[plugin hook · ${source.plugin.name}]\n${context}` }],
              source: {
                kind: "skill-manager",
                form: "plugin-hook",
                name: source.plugin.name,
                event,
                turn,
                step,
              },
            }));
          } catch (error) {
            ctx.logger.warn(`plugin hook ${source.plugin.name}/${event} skipped: ${messageOf(error)}`);
          }
        }
      }
    }
    return injections;
  }

  function pushHook(map, tool, entry) {
    const list = map.get(tool);
    if (list === undefined) map.set(tool, [entry]);
    else list.push(entry);
  }

  /** Build (and cache) the per-agent scope hook index from full skill definitions. */
  async function hookIndexFor(cwd, scope) {
    const key = scope ?? cwd ?? "";
    const cached = hookIndex.get(key);
    if (cached !== undefined) return cached;
    const current = await loadState();
    const lookup = { cwd, scope };
    const snapshot = await ctx.skills.snapshot(lookup);
    const index = { pre: new Map(), post: new Map(), userPrompt: [], sessionStart: [] };
    if (snapshot.complete) {
      for (const summary of snapshot.skills) {
        const def = await ctx.skills.get(summary.name, lookup);
        if (def === undefined || !def.metadata) continue;
        const record = current.skills[summary.name];
        const overrides = recordMatches(record, summary.source, cwd) ? record : undefined;
        const hooks = normalizeHooks(def.metadata, overrides?.hooks);
        if (hookCount(hooks) === 0) continue;
        const base = { name: summary.name, hooks };
        for (const hook of hooks.preToolUse) pushHook(index.pre, hook.tool, { ...base, hook });
        for (const hook of hooks.postToolUse) pushHook(index.post, hook.tool, { ...base, hook });
        if (hooks.inject !== undefined) index.userPrompt.push(base);
        if (hooks.sessionStartActivate) index.sessionStart.push(base);
      }
    }
    hookIndex.set(key, index);
    return index;
  }

  // Hook: SessionStart — queue skills whose SessionStart hook asks to activate.
  ctx.on("agent/session-start", ({ agent }) => {
    void (async () => {
      try {
        const index = await hookIndexFor(agent.session?.header?.cwd, agent);
        if (index.sessionStart.length === 0) return;
        let set = sessionStarts.get(agent.session);
        if (set === undefined) {
          set = new Set();
          sessionStarts.set(agent.session, set);
        }
        for (const item of index.sessionStart) set.add(item.name);
      } catch (error) {
        ctx.logger.warn(`skill-manager SessionStart hook skipped: ${messageOf(error)}`);
      }
    })();
  });

  // Hook: PreToolUse — skills may allow/deny/ask for tool dispatch.
  ctx.on("tools/pre-execute", async (exec, next) => {
    const decision = await next();
    if (decision.kind !== "allow") return decision;
    try {
      const index = await hookIndexFor(exec.agent?.session?.header?.cwd, exec.agent);
      const entries = [...(index.pre.get("*") ?? []), ...(index.pre.get(exec.name) ?? [])];
      if (entries.length === 0) return decision;
      const text = toolCallText(exec.name, exec.arguments);
      for (const { name, hook } of entries) {
        if (!matchHookWhen(hook.when, text)) continue;
        emitHook("PreToolUse", name, hook.decision, exec.name);
        if (hook.decision === "allow") continue;
        const reason = hook.reason ?? `skill hook "${name}" blocks ${exec.name}`;
        return hook.decision === "deny" ? { kind: "deny", reason } : { kind: "ask", reason };
      }
      return decision;
    } catch (error) {
      ctx.logger.warn(`skill-manager PreToolUse hook skipped: ${messageOf(error)}`);
      return decision;
    }
  });

  // Hook: PostToolUse — a matching tool result activates the skill for the
  // next request by attaching its instructions as additional context.
  ctx.on("tools/post-execute", async (exec, result, next) => {
    const decision = await next();
    try {
      const agent = exec.agent;
      const index = await hookIndexFor(agent?.session?.header?.cwd, agent);
      const entries = [...(index.post.get("*") ?? []), ...(index.post.get(exec.name) ?? [])];
      if (entries.length === 0) return decision;
      const text = resultText(result.content);
      const contexts = [];
      const seen = new Set();
      for (const { name, hook } of entries) {
        if (seen.has(name) || !matchHookWhen(hook.when, text)) continue;
        seen.add(name);
        if (sessionActiveOf(agent, name) || activationStateOf(agent?.session?.events ?? [], agent?.session?.surface?.nodes, name).active) continue;
        const skill = await ctx.skills.get(name, { cwd: agent?.session?.header?.cwd, signal: exec.signal });
        if (skill === undefined || !isModelInvocable(skill)) continue;
        markSessionActive(agent, name);
        emitHook("PostToolUse", name, "activate", exec.name);
        contexts.push(createUserMessage({
          content: [{
            type: "text",
            text: `${renderActivationReminder([{ skill: { name }, reasons: [`PostToolUse:${exec.name}`] }])}\n\n${renderSkillContent(skill)}`,
          }],
          source: {
            kind: "skill-manager",
            form: "hook-activate",
            name,
            tool: exec.name,
          },
        }));
      }
      if (contexts.length === 0) return decision;
      return {
        ...decision,
        additionalContexts: [...(decision.additionalContexts ?? []), ...contexts],
      };
    } catch (error) {
      ctx.logger.warn(`skill-manager PostToolUse hook skipped: ${messageOf(error)}`);
      return decision;
    }
  });

  async function managerView(cwd, scope) {
    const current = await loadState();
    const lookup = { cwd, scope };
    const snapshot = await ctx.skills.snapshot(lookup);
    const git = await hasGit();
    const enriched = [];
    for (const summary of snapshot.skills) {
      const full = await ctx.skills.get(summary.name, lookup);
      enriched.push({
        ...summary,
        metadata: full?.metadata,
        whenToUse: full?.whenToUse ?? summary.whenToUse,
      });
    }
    // Web Settings has no agent preset, so its host catalog intentionally has
    // no filesystem provider. Merge the manager-owned user root for display;
    // preset/project catalog entries keep precedence by name.
    const seen = new Set(enriched.map((skill) => skill.name));
    for (const candidate of await findSkillDirs(skillsRoot, 1)) {
      if (!candidate.name || !candidate.description || !isSkillName(candidate.name) || seen.has(candidate.name)) continue;
      seen.add(candidate.name);
      enriched.push({
        name: candidate.name,
        description: candidate.description,
        provider: "filesystem",
        source: "user-dsh",
        invocation: { modelInvocable: true, userInvocable: true },
        path: join(skillsRoot, candidate.relPath, "SKILL.md"),
      });
    }
    const skills = enriched.map((skill) => {
      const record = recordMatches(current.skills[skill.name], skill.source, cwd)
        ? current.skills[skill.name]
        : undefined;
      return {
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        provider: skill.provider,
        source: skill.source,
        scope: record === undefined ? "user" : scopeOfRecord(record),
        cwd,
        modelInvocable: skill.invocation?.modelInvocable !== false,
        triggers: mergeTriggers(skill.metadata, record?.triggers),
        userTriggers: Array.isArray(record?.triggers) ? record.triggers : [],
        activationMode: resolveActivationMode(skill.metadata, record?.mode),
        hooksCount: hookCount(normalizeHooks(skill.metadata, record?.hooks)),
        modeOverride: record?.mode,
        git: record?.sourceId
          ? {
              sourceUrl: record.sourceUrl,
              ref: record.ref,
              commit: record.commit,
              installedAt: record.installedAt,
            }
          : null,
      };
    });
    return {
      config: current.config,
      skills,
      skillSources: current.skillSources,
      events: current.events.slice(-12).reverse(),
      meta: {
        version: "1.0.0",
        hasGit: git,
        home,
        skillsRoot,
      },
    };
  }

  async function syncSource(source, signal) {
    const dir = source.clonePath;
    await runGit(dir, ["fetch", "--depth", "1", "origin", source.ref], signal);
    await runGit(dir, ["reset", "--hard", "FETCH_HEAD"], signal);
    const { stdout } = await runGit(dir, ["rev-parse", "HEAD"], signal);
    const commit = stdout.trim();
    const plugin = await readPluginPackage(dir);
    const found = await findSkillDirs(dir);
    const installed = [];
    for (const candidate of found) {
      if (!candidate.name || !isSkillName(candidate.name)) continue;
      const name = candidate.name;
      await installSkillFromSource(name, source, commit, candidate.relPath, signal);
      installed.push(name);
    }
    return { commit, installed, plugin };
  }

  async function installSkillFromSource(name, source, commit, relPath, signal) {
    const existing = state.skills[name];
    if (existing && existing.sourceId && existing.sourceId !== source.id) {
      throw new Error(`skill "${name}" already belongs to another source (${existing.sourceUrl})`);
    }
    const target = join(skillsRoot, name);
    try {
      const info = await stat(target);
      if (info.isDirectory() && (!existing || existing.sourceId !== source.id)) {
        throw new Error(`skill "${name}" already exists in ${skillsRoot} (not from this source); remove it first or pick another name`);
      }
    } catch (error) {
      if (!(error && error.code === "ENOENT")) throw error;
    }
    const candidateDir = join(source.clonePath, relPath === "." ? "" : relPath);
    await mkdir(skillsRoot, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await cp(candidateDir, target, {
      recursive: true,
      filter: copyFilter,
      force: true,
      errorOnExist: false,
    });
    state.skills[name] = {
      sourceId: source.id,
      sourceUrl: source.url,
      ref: source.ref,
      commit,
      relPath,
      installedAt: new Date().toISOString(),
      mode: existing && existing.mode ? existing.mode : undefined,
      triggers: existing && Array.isArray(existing.triggers) ? existing.triggers : undefined,
      hooks: existing && existing.hooks ? existing.hooks : undefined,
    };
    applyState({ skills: state.skills, skillSources: state.skillSources });
    return name;
  }

  async function installSource(url, ref, signal) {
    const cloneUrl = normalizeGitSourceUrl(url);
    if (!cloneUrl) throw new Error("unsupported git source (use owner/repo, https://, or git@)");
    const index = state.skillSources.length + 1;
    const slug = sourceSlug(cloneUrl, index);
    const clonePath = join(sourcesRoot, slug);
    await mkdir(sourcesRoot, { recursive: true });
    const args = ["clone", "--depth", "1"];
    if (ref) args.push("--branch", ref);
    args.push(cloneUrl, clonePath);
    await runGit(sourcesRoot, args, signal);
    const { stdout } = await runGit(clonePath, ["rev-parse", "HEAD"], signal);
    const commit = stdout.trim();
    const sourceRef = ref || (await runGit(clonePath, ["branch", "--show-current"], signal)).stdout.trim();
    if (!sourceRef) throw new Error("cannot determine cloned repository branch; pass ref explicitly");
    const source = {
      id: `gh:${cloneUrl}`,
      url: cloneUrl,
      ref: sourceRef,
      clonePath,
      commit,
      installedAt: new Date().toISOString(),
      plugin: await readPluginPackage(clonePath),
      skills: [],
    };
    const found = await findSkillDirs(clonePath);
    if (found.length === 0) {
      await rm(clonePath, { recursive: true, force: true });
      throw new Error(`no skill directories (SKILL.md) found at ${url}`);
    }
    const installed = [];
    const errors = [];
    for (const candidate of found) {
      if (!candidate.name || !isSkillName(candidate.name)) {
        errors.push(`${candidate.relPath}: missing/empty frontmatter name`);
        continue;
      }
      try {
        await installSkillFromSource(candidate.name, { ...source, clonePath }, commit, candidate.relPath, signal);
        installed.push(candidate.name);
      } catch (error) {
        errors.push(`${candidate.name}: ${messageOf(error)}`);
      }
    }
    if (installed.length === 0) {
      await rm(clonePath, { recursive: true, force: true });
      throw new Error(`install failed: ${errors.join("; ") || "no installable skills"}`);
    }
    source.skills = installed.map((skillName) => ({
      name: skillName,
      relPath: state.skills[skillName].relPath,
    }));
    applyState({ skillSources: [...state.skillSources, source], skills: state.skills });
    return { installed, errors };
  }

  async function updateSources(signal) {
    const before = await loadState();
    const updated = [];
    const removed = [];
    const errors = [];
    let unchangedCount = 0;
    for (const source of before.skillSources) {
      try {
        const previous = source.commit;
        const { commit, installed, plugin } = await syncSource(source, signal);
        const installedNames = new Set(installed);
        for (const entry of source.skills ?? []) {
          if (installedNames.has(entry.name)) continue;
          const record = state.skills[entry.name];
          if (!record || record.sourceId !== source.id) continue;
          await rm(join(skillsRoot, entry.name), { recursive: true, force: true });
          delete state.skills[entry.name];
          removed.push(entry.name);
        }
        if (commit !== previous) {
          for (const name of installed) {
            const entry = state.skills[name];
            updated.push({
              name,
              from: shortCommit(previous),
              to: shortCommit(commit),
              source: source.url,
            });
          }
        } else {
          unchangedCount += installed.length || 1;
        }
        applyState({
          skillSources: state.skillSources.map((entry) => (entry.id === source.id ? {
            ...entry,
            commit,
            plugin,
            skills: installed.map((name) => ({ name, relPath: state.skills[name].relPath })),
          } : entry)),
          skills: state.skills,
        });
      } catch (error) {
        errors.push(`${source.url}: ${messageOf(error)}`);
      }
    }
    return { updated, removed, unchangedCount, errors };
  }

  async function uninstallSkill(name) {
    const record = state.skills[name];
    if (!record || !record.sourceId) {
      throw new Error(`skill "${name}" is not managed by a git source; remove it directly in ${skillsRoot}`);
    }
    await rm(join(skillsRoot, name), { recursive: true, force: true });
    const skillSources = state.skillSources.map((source) => ({
      ...source,
      skills: (source.skills ?? []).filter((entry) => entry.name !== name),
    }));
    const skills = { ...state.skills };
    delete skills[name];
    applyState({ skillSources, skills });
    return name;
  }

  async function runAction(args, signal, scope) {
    await loadState();
    switch (args.action) {
      case "status": {
        const cwd = typeof args.cwd === "string" ? args.cwd : scope?.session?.header?.cwd;
        const view = await managerView(cwd, scope);
        const lines = [
          `skill manager ${view.meta.hasGit ? "ready" : "ready (git unavailable)"} — ${view.skills.length} skills`,
          `auto-activation: ${view.config.enabled ? "on" : "off"}`,
        ];
        for (const skill of view.skills) {
          const trigger = skill.triggers.length > 0 ? ` [${skill.triggers.slice(0, 3).join(", ")}]` : "";
          lines.push(`- ${skill.name}: ${skill.activationMode}${trigger}${skill.git ? ` (${shortCommit(skill.git.commit)})` : ""}`);
        }
        return { ok: true, message: lines.join("\n") };
      }
      case "install":
        if (typeof args.url !== "string") throw new Error("install requires url");
        {
          const { installed, errors } = await installSource(args.url, typeof args.ref === "string" ? args.ref : undefined, signal);
          pushEvent(state, "install", `installed from ${args.url}: ${installed.join(", ")}`);
          await saveState();
          notifyUpdate({ kind: "install", skills: installed });
          return {
            ok: true,
            message: `installed: ${installed.join(", ")}${errors.length ? `\nwarnings:\n${errors.join("\n")}` : ""}`,
          };
        }
      case "update": {
        const result = await updateSources(signal);
        if (result.updated.length > 0) pushEvent(state, "update", result.updated.map((u) => `${u.name} ${u.from}→${u.to}`).join(", "));
        if (result.removed.length > 0) pushEvent(state, "update", `removed: ${result.removed.join(", ")}`);
        if (result.errors.length > 0) pushEvent(state, "update-error", result.errors.join("; "));
        await saveState();
        notifyUpdate({ kind: "update", updated: result.updated, removed: result.removed, errors: result.errors });
        const lines = [];
        if (result.updated.length > 0) lines.push(`updated: ${result.updated.map((u) => `${u.name} (${u.from} → ${u.to})`).join(", ")}`);
        if (result.removed.length > 0) lines.push(`removed: ${result.removed.join(", ")}`);
        if (result.unchangedCount > 0) lines.push(`unchanged: ${result.unchangedCount} skill(s)`);
        for (const error of result.errors) lines.push(`error: ${error}`);
        return { ok: true, message: lines.join("\n") || "no changes" };
      }
      case "uninstall": {
        const removed = await uninstallSkill(String(args.name));
        pushEvent(state, "uninstall", removed);
        await saveState();
        notifyUpdate({ kind: "uninstall", skills: [removed] });
        return { ok: true, message: `uninstalled ${removed}` };
      }
      case "set-mode": {
        const skillName = String(args.name);
        const mode = String(args.mode);
        if (!ACTIVATION_MODES.includes(mode)) throw new Error(`mode must be one of ${ACTIVATION_MODES.join("/")}`);
        const entry = state.skills[skillName] ?? newSkillRecord();
        applyRecordScope(entry, args);
        entry.mode = mode;
        applyState({ skills: { ...state.skills, [skillName]: entry } });
        pushEvent(state, "set-mode", `${skillName} → ${mode}`);
        await saveState();
        return { ok: true, message: `${skillName} → ${mode}` };
      }
      case "set-triggers": {
        const skillName = String(args.name);
        const raw = args.triggers;
        if (!Array.isArray(raw)) throw new Error("set-triggers requires a triggers array");
        const triggers = raw
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0 && item.length <= 200)
          .slice(0, 32);
        const entry = state.skills[skillName] ?? newSkillRecord();
        applyRecordScope(entry, args);
        entry.triggers = triggers;
        applyState({ skills: { ...state.skills, [skillName]: entry } });
        pushEvent(state, "set-triggers", `${skillName}: ${triggers.join(", ") || "(none)"}`);
        await saveState();
        return { ok: true, message: `${skillName} triggers: ${triggers.join(", ") || "(none)"}` };
      }
      case "set-hooks": {
        const skillName = String(args.name);
        const entry = state.skills[skillName] ?? newSkillRecord();
        applyRecordScope(entry, args);
        entry.hooks = sanitizeHooks(args.hooks);
        applyState({ skills: { ...state.skills, [skillName]: entry } });
        pushEvent(state, "set-hooks", `${skillName}: ${JSON.stringify(entry.hooks).slice(0, 300)}`);
        await saveState();
        hookIndex.clear();
        return { ok: true, message: `${skillName} hooks updated` };
      }
      case "set-config": {
        const config = args.config;
        if (!config || typeof config !== "object") throw new Error("set-config requires config");
        const next = { ...state.config };
        if (typeof config.enabled === "boolean") next.enabled = config.enabled;
        if (Number.isInteger(config.maxAuto)) next.maxAuto = Math.min(8, Math.max(0, config.maxAuto));
        if (Number.isInteger(config.maxSuggest)) next.maxSuggest = Math.min(8, Math.max(0, config.maxSuggest));
        applyState({ config: next });
        pushEvent(state, "set-config", `enabled=${next.enabled} maxAuto=${next.maxAuto} maxSuggest=${next.maxSuggest}`);
        await saveState();
        return { ok: true, message: "config updated" };
      }
      case "refresh":
        return { ok: true, message: "skill catalog refreshed by watcher" };
      default:
        throw new Error(`unknown action "${args.action}"`);
    }
  }

  // ---- Hook 1: proactive activation on every proposed step ----------------
  ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => {
    const decision = await next();
    if (decision.kind === "reject") return decision;
    try {
      const current = await loadState();
      if (!current.config.enabled) return decision;
      if (batchHasInjection(messages)) return decision;
      const text = userText(messages);
      if (!text.trim()) return decision;
      const injections = await pluginHookInjections(current, agent, text, turn, step, signal);
      const lookup = {
        cwd: agent.session?.header?.cwd,
        signal,
        scope: agent,
      };
      const snapshot = await ctx.skills.snapshot(lookup);
      if (!snapshot.complete) {
        return injections.length === 0 ? decision : {
          kind: "enter",
          messages: [...decision.messages, ...injections],
        };
      }
      signal.throwIfAborted();
      // ponytail: O(n) skill reads per prompt; index metadata if catalogs become large.
      const enriched = [];
      const fullBy = new Map();
      for (const summary of snapshot.skills) {
        const full = await ctx.skills.get(summary.name, lookup);
        signal.throwIfAborted();
        if (full === undefined) continue;
        fullBy.set(summary.name, full);
        enriched.push({
          ...summary,
          metadata: full.metadata,
          whenToUse: full.whenToUse ?? summary.whenToUse,
        });
      }
      const ranked = rankSkills(enriched, text, current, lookup.cwd);
      const { auto, suggest } = selectActivations(ranked, current.config);

      const events = agent.session?.events ?? [];
      const nodes = agent.session?.surface?.nodes;
      const sessionActive = sessionActiveSet(agent);
      const committed = new Set(activeSkillNames(events));
      for (const name of sessionActive) if (committed.has(name)) sessionActive.delete(name);
      const inContext = (name) =>
        activationStateOf(events, nodes, name).active || sessionActive.has(name);

      // Hook: SessionStart — skills declaring `hooks.SessionStart.activate`
      // load on the session's first step, no match required.
      const pendingStarts = sessionStarts.get(agent.session);
      if (pendingStarts !== undefined) {
        for (const name of [...pendingStarts]) {
          pendingStarts.delete(name);
          if (inContext(name)) continue;
          const skill = await ctx.skills.get(name, lookup);
          signal.throwIfAborted();
          if (skill === undefined || !isModelInvocable(skill)) continue;
          markSessionActive(agent, name);
          emitHook("SessionStart", name, "activate");
          injections.push(createUserMessage({
            content: [{
              type: "text",
              text: `${renderActivationReminder([{ skill: { name }, reasons: ["SessionStart"] }])}\n\n${renderSkillContent(skill)}`,
            }],
            source: {
              kind: "skill-manager",
              form: "activation",
              name,
              turn,
              step,
              reason: "SessionStart",
            },
          }));
        }
      }

      for (const entry of auto) {
        if (inContext(entry.skill.name)) continue;
        const skill = fullBy.get(entry.skill.name);
        if (skill === undefined) continue;
        if (!isModelInvocable(skill)) continue;
        markSessionActive(agent, entry.skill.name);
        injections.push(createUserMessage({
          content: [{
            type: "text",
            text: `${renderActivationReminder([entry])}\n\n${renderSkillContent(skill)}`,
          }],
          source: {
            kind: "skill-manager",
            form: "activation",
            name: entry.skill.name,
            turn,
            step,
          },
        }));
      }
      const suggestions = suggest.filter((entry) => !inContext(entry.skill.name));
      if (suggestions.length > 0) {
        injections.push(createUserMessage({
          content: [{ type: "text", text: renderSuggestionNotice(suggestions) }],
          source: {
            kind: "skill-manager",
            form: "suggestion",
            names: suggestions.map((entry) => entry.skill.name),
            turn,
            step,
          },
        }));
      }

      // Hook: UserPromptSubmit — skills that are active this session may
      // attach extra context to every submitted prompt.
      try {
        const promptHooks = (await hookIndexFor(agent.session?.header?.cwd, agent)).userPrompt;
        const activeNames = new Set([...activeSkillNames(events), ...(sessionActiveSet(agent))]);
        let injected = 0;
        for (const item of promptHooks) {
          if (!activeNames.has(item.name)) continue;
          if (injected >= 3) break;
          injections.push(createUserMessage({
            content: [{ type: "text", text: `[skill hook · ${item.name}]\n${item.hooks.inject}` }],
            source: {
              kind: "skill-manager",
              form: "hook-inject",
              name: item.name,
              turn,
              step,
            },
          }));
          emitHook("UserPromptSubmit", item.name, "inject");
          injected += 1;
        }
      } catch (error) {
        ctx.logger.warn(`skill-manager UserPromptSubmit hook skipped: ${messageOf(error)}`);
      }

      if (injections.length === 0) return decision;
      return {
        kind: "enter",
        messages: [...decision.messages, ...injections],
      };
    } catch (error) {
      ctx.logger.warn(`skill-manager activation skipped: ${messageOf(error)}`);
      return decision;
    }
  });

  // ---- Model tool ---------------------------------------------------------
  ctx.tools.register(defineTool({
    name: "skill_manager",
    description:
      "Manage the skill library: status (list skills and their activation modes), install <owner/repo|git-url> (install skills from a GitHub/git repository), update (pull all installed sources from git), uninstall <name>, set-mode <name> <auto|suggest|off>, set-triggers <name> triggers=[...], set-hooks <name> hooks={...}, set-config. Skills may declare Claude-Code-style hooks (UserPromptSubmit/PreToolUse/PostToolUse/SessionStart) in their metadata; set-hooks overrides them per skill.",
    parameters: {
      action: { type: "string", required: true, enum: ACTIONS },
      url: { type: "string", description: "Git source (owner/repo, https://, or git@) for install" },
      ref: { type: "string", description: "Optional branch/tag for install" },
      name: { type: "string", description: "Skill name for uninstall/set-mode/set-triggers" },
      mode: { type: "string", enum: ACTIVATION_MODES, description: "Activation mode for set-mode" },
      scope: { type: "string", enum: ["user", "project"], description: "Override scope for set-*: user (DSH home skills, default) or project (.dsh/skills of the given cwd)" },
      cwd: { type: "string", description: "Workspace path; required for project-scoped set-* and for listing project skills" },
      triggers: { type: "array", items: { type: "string" }, description: "User-side trigger strings for set-triggers (substring or re:<pattern>)" },
      hooks: { type: "object", additionalProperties: true, description: "Hook overrides for set-hooks, Claude Code event names: UserPromptSubmit {inject}, PreToolUse [{tool,when,decision,reason}], PostToolUse [{tool,when,action:'activate'}], SessionStart {activate}" },
      config: {
        type: "object",
        additionalProperties: false,
        description: "Partial config for set-config: enabled (boolean), maxAuto/maxSuggest (number)",
        properties: {
          enabled: { type: "boolean" },
          maxAuto: { type: "number" },
          maxSuggest: { type: "number" },
        },
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          message: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.message }],
    },
    async execute(args, exec) {
      try {
        const result = await runAction(args, exec.signal, exec.agent);
        return { ok: true, message: result.message };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    presentCall(args) {
      return {
        card: "generic",
        title: `Skill manager: ${args.action}`,
        kind: "read",
        rawInput: args.action,
      };
    },
  }));

  // ---- Settings RPC -------------------------------------------------------
  ctx.inject(["connection", "agentPresets"], (connectionCtx) => {
    async function settingsView(payload) {
      const cwd = typeof payload?.cwd === "string" ? payload.cwd : undefined;
      // ponytail: Settings has no session context; expose the default preset until the UI offers preset selection.
      const scope = cwd === undefined ? undefined : await connectionCtx.agentPresets.standingKeyFor();
      return managerView(cwd, scope);
    }
    connectionCtx.effect(() => {
      const dispose = connectionCtx.connection.rpc.handle(
        CHANNEL,
      async (endpoint, payload, signal) => {
        try {
          switch (endpoint) {
            case "list":
              return success(await settingsView(payload));
            case "set-mode":
              return success((await runAction({ action: "set-mode", name: payload?.name, mode: payload?.mode, scope: payload?.scope, cwd: payload?.cwd }, signal)).message);
            case "set-triggers":
              return success((await runAction({ action: "set-triggers", name: payload?.name, triggers: payload?.triggers, scope: payload?.scope, cwd: payload?.cwd }, signal)).message);
            case "set-hooks":
              return success((await runAction({ action: "set-hooks", name: payload?.name, hooks: payload?.hooks, scope: payload?.scope, cwd: payload?.cwd }, signal)).message);
            case "set-config":
              return success((await runAction({ action: "set-config", config: payload?.config }, signal)).message);
            case "install":
              return success((await runAction({ action: "install", url: payload?.url, ref: payload?.ref }, signal)).message);
            case "update":
              return success((await runAction({ action: "update" }, signal)).message);
            case "uninstall":
              return success((await runAction({ action: "uninstall", name: payload?.name }, signal)).message);
            case "refresh":
              return success(await settingsView(payload));
            default:
              return failure(`unknown endpoint "${endpoint}"`, "not-found");
          }
        } catch (error) {
          return failure(messageOf(error));
        }
      },
      { authority: "trusted-host" },
    );
      return () => {
        void dispose();
      };
    }, "skill-manager: rpc");
  });

  // Kick the state file into existence at boot so the UI never races it.
  void loadState().then(() => saveState()).catch(() => {});
}

/** Fresh state record for a skill the user configured but did not install. */
function newSkillRecord() {
  return {
    sourceId: "",
    sourceUrl: "",
    ref: "",
    commit: "",
    relPath: "",
    installedAt: "",
    scope: undefined,
    cwd: undefined,
  };
}

/**
 * Apply the scope/cwd of a mutation to a record: project-scoped records carry
 * their workspace cwd and never apply to user-root skills of the same name.
 */
function applyRecordScope(entry, args) {
  const scope = args.scope === "project" ? "project" : "user";
  if (scope === "project") {
    if (typeof args.cwd !== "string" || args.cwd === "") {
      throw new Error('project-scoped overrides require a "cwd" argument');
    }
    entry.scope = "project";
    entry.cwd = args.cwd;
  } else {
    entry.scope = undefined;
    entry.cwd = undefined;
  }
}

/** Text of the direct user messages in a claimed step batch. */
function userText(messages) {
  const blocks = [];
  for (const message of messages) {
    if (message.source?.kind !== "user") continue;
    for (const block of message.content ?? []) {
      if (block.type === "text" && typeof block.text === "string") blocks.push(block.text);
    }
  }
  return blocks.join("\n");
}

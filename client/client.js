window.__ModuleLoader__.load({
  id: "@wisdoverse/dsh-skills-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useRef, useState } = React;

    const CHANNEL = "/skill-manager";
    const MODES = ["auto", "suggest", "off"];
    const MODE_KEYS = { auto: "modeAuto", suggest: "modeSuggest", off: "modeOff" };
    const SOURCE_KEYS = {
      "user-dsh": "sourceUserDsh",
      "user-agents": "sourceUserAgents",
      "project-dsh": "sourceProjectDsh",
      "project-agents": "sourceProjectAgents",
      custom: "sourceCustom",
      bundled: "sourceBundled",
    };
    const EVENT_KEYS = {
      install: "eventInstall",
      update: "eventUpdate",
      "update-error": "eventUpdateError",
      uninstall: "eventUninstall",
      "set-mode": "eventSetMode",
      "set-triggers": "eventSetTriggers",
      "set-hooks": "eventSetHooks",
      "set-config": "eventSetConfig",
    };

    const DICT = {
      zh: {
        nav: "Skill 管理",
        intro: "管理 Skill 的主动加载、触发词、Git 来源与项目级覆盖。界面会跟随 DSH 的显示语言。",
        skillsRoot: "Skill 目录",
        workspaceLabel: "项目工作区（cwd）",
        workspacePlaceholder: "留空显示用户级 Skill；填写后同时显示项目 .dsh/skills 与 .agents/skills",
        enabled: "启用主动使用",
        enabledHint: "关闭后仅保留手动调用。",
        maxAuto: "每轮最多自动加载",
        maxAutoHint: "0–8；超出部分转为建议加载。",
        update: "从 GitHub 更新",
        updating: "正在同步…",
        refresh: "刷新",
        refreshing: "正在刷新…",
        gitUnavailable: "未检测到 Git。",
        installTitle: "从 Git 仓库安装 Plugin / Skills",
        urlPlaceholder: "owner/repo 或 https://github.com/owner/repo.git",
        refPlaceholder: "分支/标签（可选）",
        installBtn: "安装并发现",
        installing: "正在安装…",
        installHint: "识别 Codex/Claude plugin manifest、skills 与仓库内 node lifecycle hooks；其他命令 hook 不执行。",
        modeAuto: "自动加载",
        modeSuggest: "建议加载",
        modeOff: "关闭",
        triggerLabel: "触发词",
        triggerPlaceholder: "触发词（逗号分隔，支持 re:正则）",
        localSkill: "本地 Skill（非 Git 管理）",
        uninstall: "移除",
        uninstalling: "移除中…",
        confirmUninstall: "确认从本地 Skills 目录移除该 Skill？",
        skillsCount: "Skills",
        hooksCount: "Hooks",
        unsupportedHooksCount: "不支持的 Hooks",
        managedSources: "已管理 Plugin / Git 来源",
        noSources: "尚未通过管理器安装 Plugin 来源。",
        localProjectSkills: "本地 / 项目 Skills",
        recentLabel: "最近记录",
        noSkills: "未发现 Skill。",
        loading: "正在加载…",
        errorTitle: "加载失败",
        rpcFailed: "请求失败",
        actionFailed: "操作失败",
        installDone: "安装完成",
        updateDone: "同步完成",
        uninstallDone: "移除完成",
        modeSaved: "模式已保存",
        triggersSaved: "触发词已保存",
        configSaved: "设置已保存",
        refreshDone: "列表已刷新",
        warnings: "警告",
        updated: "已更新",
        removed: "已移除",
        unchanged: "无变化",
        error: "错误",
        noChanges: "没有变化",
        sourceUserDsh: "用户级 DSH",
        sourceUserAgents: "用户级 Agents",
        sourceProjectDsh: "项目级 DSH",
        sourceProjectAgents: "项目级 Agents",
        sourceCustom: "自定义来源",
        sourceBundled: "内置来源",
        eventInstall: "安装",
        eventUpdate: "更新",
        eventUpdateError: "更新错误",
        eventUninstall: "移除",
        eventSetMode: "设置模式",
        eventSetTriggers: "设置触发词",
        eventSetHooks: "设置 Hooks",
        eventSetConfig: "设置配置",
      },
      en: {
        nav: "Skill manager",
        intro: "Manage proactive loading, triggers, Git sources, and project-scoped overrides. The UI follows the DSH display language.",
        skillsRoot: "Skills directory",
        workspaceLabel: "Project workspace (cwd)",
        workspacePlaceholder: "Leave blank for user skills; enter a path to include project .dsh/skills and .agents/skills",
        enabled: "Enable proactive usage",
        enabledHint: "When disabled, only manual invocation remains.",
        maxAuto: "Max auto-loads per turn",
        maxAutoHint: "0–8; overflow becomes suggestions.",
        update: "Update from GitHub",
        updating: "Syncing…",
        refresh: "Refresh",
        refreshing: "Refreshing…",
        gitUnavailable: "Git was not detected.",
        installTitle: "Install plugins / skills from a Git repository",
        urlPlaceholder: "owner/repo or https://github.com/owner/repo.git",
        refPlaceholder: "Branch/tag (optional)",
        installBtn: "Install & discover",
        installing: "Installing…",
        installHint: "Discovers Codex/Claude plugin manifests, skills, and in-repo Node lifecycle hooks; other command hooks stay disabled.",
        modeAuto: "Auto-load",
        modeSuggest: "Suggest",
        modeOff: "Off",
        triggerLabel: "Triggers",
        triggerPlaceholder: "Triggers (comma-separated; re:regex supported)",
        localSkill: "Local skill (not Git-managed)",
        uninstall: "Remove",
        uninstalling: "Removing…",
        confirmUninstall: "Remove this skill from the local skills directory?",
        skillsCount: "Skills",
        hooksCount: "Hooks",
        unsupportedHooksCount: "Unsupported hooks",
        managedSources: "Managed plugins / Git sources",
        noSources: "No plugin source has been installed through the manager.",
        localProjectSkills: "Local / project skills",
        recentLabel: "Recent activity",
        noSkills: "No skills found.",
        loading: "Loading…",
        errorTitle: "Load failed",
        rpcFailed: "Request failed",
        actionFailed: "Action failed",
        installDone: "Installation complete",
        updateDone: "Sync complete",
        uninstallDone: "Removal complete",
        modeSaved: "Mode saved",
        triggersSaved: "Triggers saved",
        configSaved: "Settings saved",
        refreshDone: "List refreshed",
        warnings: "Warnings",
        updated: "Updated",
        removed: "Removed",
        unchanged: "Unchanged",
        error: "Error",
        noChanges: "No changes",
        sourceUserDsh: "User DSH",
        sourceUserAgents: "User Agents",
        sourceProjectDsh: "Project DSH",
        sourceProjectAgents: "Project Agents",
        sourceCustom: "Custom source",
        sourceBundled: "Bundled source",
        eventInstall: "Install",
        eventUpdate: "Update",
        eventUpdateError: "Update error",
        eventUninstall: "Remove",
        eventSetMode: "Set mode",
        eventSetTriggers: "Set triggers",
        eventSetHooks: "Set hooks",
        eventSetConfig: "Set configuration",
      },
    };

    const styles = {
      section: { width: "100%" },
      intro: { color: "var(--dsw-alias-label-secondary)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.6 },
      row: {
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        margin: "10px 0",
      },
      label: { fontSize: 13 },
      hint: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12 },
      input: {
        background: "var(--dsw-alias-bg-layer-2)",
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 8,
        color: "inherit",
        font: "inherit",
        maxWidth: 260,
        padding: "6px 10px",
      },
      select: {
        background: "var(--dsw-alias-bg-layer-2)",
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 8,
        color: "inherit",
        font: "inherit",
        padding: "4px 8px",
      },
      button: {
        background: "var(--dsw-alias-interactive-bg-hover)",
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 8,
        color: "inherit",
        cursor: "pointer",
        font: "inherit",
        padding: "6px 14px",
      },
      card: {
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 12,
        margin: "8px 0",
        padding: "10px 12px",
      },
      skillItem: {
        borderTop: "1px solid var(--dsw-alias-border-l3)",
        marginTop: 10,
        paddingTop: 10,
      },
      skillLine: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 },
      skillName: { fontWeight: 600, minWidth: 140 },
      skillDesc: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, flexBasis: "100%", marginTop: 4 },
      chip: {
        background: "var(--dsw-alias-bg-layer-2)",
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 999,
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 11,
        padding: "1px 8px",
      },
      git: { color: "var(--dsw-alias-label-tertiary)", fontSize: 11 },
      meta: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, margin: "4px 0 0" },
      notice: {
        border: "1px solid var(--dsw-alias-border-l3)",
        borderRadius: 8,
        fontSize: 12,
        marginTop: 10,
        padding: "8px 10px",
        whiteSpace: "pre-wrap",
      },
      noticeError: { color: "#e5484d" },
      noticeOk: { color: "var(--dsw-alias-label-primary)" },
    };

    function ManagerSection({ connection, t }) {
      const [view, setView] = useState(null);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [noticeOk, setNoticeOk] = useState(true);
      const [busy, setBusy] = useState(null);
      const [url, setUrl] = useState("");
      const [ref, setRef] = useState("");
      const [cwd, setCwd] = useState("");

      const modeLabel = (mode) => MODE_KEYS[mode] ? t(MODE_KEYS[mode]) : mode;
      const sourceLabel = (source) => SOURCE_KEYS[source] ? t(SOURCE_KEYS[source]) : source;
      const eventLabel = (kind) => EVENT_KEYS[kind] ? t(EVENT_KEYS[kind]) : kind;

      const translatedDetail = (value) => {
        if (typeof value !== "string") return "";
        return value
          .replace(/^installed:/gm, `${t("installDone")}:`)
          .replace(/^warnings:/gm, `${t("warnings")}:`)
          .replace(/^updated:/gm, `${t("updated")}:`)
          .replace(/^removed:/gm, `${t("removed")}:`)
          .replace(/^unchanged:/gm, `${t("unchanged")}:`)
          .replace(/^error:/gm, `${t("error")}:`)
          .replace(/^no changes$/gm, t("noChanges"));
      };

      const successNotice = (label, value, payload) => {
        if (label === "install") return translatedDetail(value) || t("installDone");
        if (label === "update") return translatedDetail(value) || t("updateDone");
        if (label === "uninstall") return `${t("uninstallDone")}: ${payload?.name ?? ""}`.trim();
        if (label === "set-mode") return `${t("modeSaved")}: ${modeLabel(payload?.mode ?? "")}`;
        if (label === "set-triggers") return t("triggersSaved");
        if (label === "set-config") return t("configSaved");
        if (label === "refresh") return t("refreshDone");
        return translatedDetail(value) || t("refreshDone");
      };

      const call = useCallback(async (endpoint, payload, signal) => {
        const result = await connection.rpc.call(CHANNEL, endpoint, payload ?? {}, signal);
        if (!result.ok) throw new Error((result.error && result.error.message) || t("rpcFailed"));
        return result.value;
      }, [connection, t]);

      const scopeOf = (skill) =>
        skill.source === "project-dsh" || skill.source === "project-agents" ? "project" : "user";

      const targetOf = (skill) => ({ scope: scopeOf(skill), cwd: skill.cwd });

      const cwdRef = useRef("");
      const reload = useCallback(async (signal) => {
        const value = await call("list", { cwd: cwdRef.current.trim() || undefined }, signal);
        setView(value);
        setError(null);
      }, [call]);

      useEffect(() => {
        const controller = new AbortController();
        reload(controller.signal).catch((reason) => {
          if (controller.signal.aborted) return;
          setError((reason && reason.message) || String(reason));
        });
        return () => controller.abort();
      }, [reload]);

      const run = async (label, endpoint, payload) => {
        setBusy(label);
        setNotice(null);
        try {
          const message = await call(endpoint, payload);
          setNoticeOk(true);
          setNotice(successNotice(label, message, payload));
          await reload();
        } catch (reason) {
          setNoticeOk(false);
          setNotice(`${t("actionFailed")}: ${(reason && reason.message) || String(reason)}`);
        } finally {
          setBusy(null);
        }
      };

      const commitTriggers = (skill, raw) => {
        const triggers = String(raw || "").split(",").map((item) => item.trim()).filter((item) => item);
        run("set-triggers", "set-triggers", { name: skill.name, triggers, ...targetOf(skill) });
      };

      if (error) {
        return h("section", { style: styles.section },
          h("p", { style: { ...styles.notice, ...styles.noticeError } },
            h("strong", null, `${t("errorTitle")}: `),
            error));
      }
      if (!view) return h("section", { style: styles.section }, t("loading"));

      const config = view.config || {};
      const skills = view.skills || [];
      const plugins = view.skillSources || [];
      const events = view.events || [];
      const hasGit = view.meta && view.meta.hasGit;

      const changeConfig = (field, value) => {
        const next = { ...config, [field]: value };
        setView({ ...view, config: next });
        run("set-config", "set-config", { config: next }).catch(() => {
          setView({ ...view, config });
        });
      };

      const skillCard = (skill, grouped = false) => {
        const managed = skill.git !== null;
        const modeSelect = h("select", {
          value: skill.activationMode,
          disabled: busy !== null,
          onChange: (event) => run("set-mode", "set-mode", { name: skill.name, mode: event.target.value, ...targetOf(skill) }),
          style: styles.select,
        }, MODES.map((mode) => h("option", { key: mode, value: mode }, modeLabel(mode))));
        const removeButton = managed
          ? h("button", {
              type: "button",
              disabled: busy !== null,
              onClick: () => {
                if (!window.confirm(t("confirmUninstall"))) return;
                run("uninstall", "uninstall", { name: skill.name });
              },
              style: styles.button,
            }, busy === "uninstall" ? t("uninstalling") : t("uninstall"))
          : null;
        const sourceText = grouped ? null : (managed ? `${skill.git.sourceUrl} @ ${skill.git.commit.slice(0, 7)}` : t("localSkill"));
        const triggersInput = h("input", {
          type: "text",
          key: `${skill.name}-${(skill.userTriggers || []).join(",")}`,
          defaultValue: (skill.triggers || []).join(", "),
          placeholder: t("triggerPlaceholder"),
          disabled: busy !== null,
          onBlur: (event) => commitTriggers(skill, event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter" && event.currentTarget.blur) event.currentTarget.blur();
          },
          style: { ...styles.input, maxWidth: 380 },
        });
        return h("div", { key: `${skill.cwd ?? ""}:${skill.name}`, style: grouped ? styles.skillItem : styles.card },
          h("div", { style: styles.skillLine },
            h("span", { style: styles.skillName }, skill.name),
            h("span", { style: styles.chip }, sourceLabel(skill.source)),
            modeSelect,
            removeButton,
            sourceText && h("span", { style: styles.git }, sourceText),
            (skill.hooksCount || 0) > 0 && h("span", { style: styles.chip }, `${t("hooksCount")}: ${skill.hooksCount}`)),
          h("p", { style: styles.skillDesc }, skill.description || "—"),
          h("div", { style: styles.row }, triggersInput));
      };

      const groupedUrls = new Set(plugins.map((source) => source.url));
      const otherSkills = skills.filter((skill) => !skill.git || !groupedUrls.has(skill.git.sourceUrl));
      const pluginCards = plugins.map((source) => {
        const plugin = source.plugin || {};
        const hooks = (plugin.hooks || []).length;
        const unsupported = (plugin.unsupportedHooks || []).length;
        const sourceSkills = skills.filter((skill) => skill.git && skill.git.sourceUrl === source.url);
        return h("div", { key: source.id, style: styles.card },
          h("div", { style: styles.skillLine },
            h("span", { style: styles.skillName }, plugin.name || source.url),
            plugin.version && h("span", { style: styles.chip }, `v${plugin.version}`),
            h("span", { style: styles.chip }, `${t("skillsCount")}: ${sourceSkills.length}`),
            h("span", { style: styles.chip }, `${t("hooksCount")}: ${hooks}`),
            unsupported > 0 && h("span", { style: styles.chip }, `${t("unsupportedHooksCount")}: ${unsupported}`)),
          plugin.description && h("p", { style: styles.skillDesc }, plugin.description),
          h("p", { style: styles.meta }, `${source.url} @ ${(source.commit || "").slice(0, 7)}`),
          sourceSkills.map((skill) => skillCard(skill, true)));
      });

      const eventItems = events.map((event, index) => {
        const when = new Date(event.at).toLocaleString();
        return h("p", {
          key: `${event.at}-${index}`,
          style: styles.meta,
        }, `[${when}] ${eventLabel(event.kind)}: ${event.detail}`);
      });

      return h("section", { style: styles.section },
        h("p", { style: styles.intro }, t("intro")),
        h("p", { style: styles.meta }, `${t("skillsRoot")}: ${view.meta.skillsRoot || ""}`),
        h("label", { style: styles.row },
          t("workspaceLabel"),
          h("input", {
            type: "text",
            placeholder: t("workspacePlaceholder"),
            value: cwd,
            onChange: (event) => {
              setCwd(event.target.value);
              cwdRef.current = event.target.value;
            },
            onBlur: () => void reload(),
            onKeyDown: (event) => {
              if (event.key === "Enter") void reload();
            },
            style: { ...styles.input, flex: 1 },
          })),
        h("label", { style: styles.row },
          h("input", {
            type: "checkbox",
            checked: config.enabled !== false,
            onChange: (event) => changeConfig("enabled", event.target.checked),
          }),
          t("enabled"),
          h("span", { style: styles.hint }, t("enabledHint"))),
        h("label", { style: styles.row },
          t("maxAuto"),
          h("input", {
            type: "number",
            min: 0,
            max: 8,
            step: 1,
            value: String(config.maxAuto ?? 2),
            onChange: (event) => changeConfig("maxAuto", Number(event.target.value)),
            style: { ...styles.input, maxWidth: 90 },
          }),
          h("span", { style: styles.hint }, t("maxAutoHint"))),
        h("div", { style: styles.row },
          h("button", {
            type: "button",
            disabled: busy !== null || !hasGit,
            onClick: () => run("update", "update"),
            style: styles.button,
          }, busy === "update" ? t("updating") : t("update")),
          h("button", {
            type: "button",
            disabled: busy !== null,
            onClick: () => run("refresh", "refresh"),
            style: styles.button,
          }, busy === "refresh" ? t("refreshing") : t("refresh")),
          !hasGit && h("span", { style: styles.hint }, t("gitUnavailable"))),
        h("div", { style: styles.card },
          h("div", { style: { fontWeight: 600, marginBottom: 6 } }, t("installTitle")),
          h("div", { style: styles.row },
            h("input", {
              type: "text",
              placeholder: t("urlPlaceholder"),
              value: url,
              onChange: (event) => setUrl(event.target.value),
              style: { ...styles.input, flex: 1 },
            }),
            h("input", {
              type: "text",
              placeholder: t("refPlaceholder"),
              value: ref,
              onChange: (event) => setRef(event.target.value),
              style: { ...styles.input, maxWidth: 160 },
            }),
            h("button", {
              type: "button",
              disabled: busy !== null || !url.trim(),
              onClick: () => {
                const target = url.trim();
                const branch = ref.trim() || undefined;
                setUrl("");
                setRef("");
                run("install", "install", { url: target, ref: branch });
              },
              style: styles.button,
            }, busy === "install" ? t("installing") : t("installBtn"))),
          h("p", { style: styles.hint }, t("installHint"))),
        notice !== null && h("pre", {
          style: { ...styles.notice, ...(noticeOk ? styles.noticeOk : styles.noticeError) },
        }, notice),
        h("div", { style: { marginTop: 14 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, `${t("managedSources")} (${plugins.length})`),
          plugins.length === 0 && h("p", { style: styles.hint }, t("noSources")),
          pluginCards),
        skills.length === 0 && h("p", { style: styles.hint }, t("noSkills")),
        otherSkills.length > 0 && h("div", { style: { marginTop: 14 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, `${t("localProjectSkills")} (${otherSkills.length})`),
          otherSkills.map((skill) => skillCard(skill))),
        events.length > 0 && h("div", { style: { marginTop: 12 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, t("recentLabel")),
          eventItems));
    }

    const name = "dsh-skills-manager";
    const inject = ["slots", "connection", "locale"];

    function apply(ctx) {
      const t = ctx.locale ? ctx.locale.bind("skillManager") : (key) => DICT.en[key] ?? key;
      ctx.effect(() => {
        const dispose = ctx.locale.register("skillManager", DICT);
        return () => void dispose();
      }, "skill-manager: dictionaries");
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      const connection = ctx.get("connection");
      if (connection === undefined) return;
      slots.inject("settings.section", () => slots.register({
        name: "settings.section",
        id: "skill-manager",
        order: 45,
        label: () => t("nav"),
        locale: "skillManager",
        inject: () => ({ connection }),
      }, ManagerSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});

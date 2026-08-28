window.__ModuleLoader__.load({
  id: "dsh-skills-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useRef, useState } = React;

    const CHANNEL = "/skill-manager";
    const MODES = ["auto", "suggest", "off"];
    const MODE_LABELS = { auto: "自动加载", suggest: "建议加载", off: "关闭" };

    const DICT = {
      zh: {
        nav: "Skill 管理",
        intro: "管理 Skill 的主动使用、触发 hook 与 GitHub 同步。自动加载会在任务匹配 skill 声明时直接把完整指令注入对话;建议加载只提示模型去加载;关闭则不参与。",
        enabled: "启用主动使用",
        enabledHint: "关闭后 skill 管理完全旁路,仅保留手动调用。",
        maxAuto: "每轮最多自动加载",
        maxAutoHint: "0–8;超出部分转为建议。",
        update: "从 GitHub 更新",
        updating: "正在同步…",
        refresh: "刷新列表",
        installTitle: "从 Git 仓库安装 skill",
        urlPlaceholder: "owner/repo 或 https://github.com/owner/repo.git",
        refPlaceholder: "分支/标签(可选)",
        installBtn: "安装并发现",
        installHint: "识别 Codex/Claude plugin manifest、skills 与仓库内 node lifecycle hooks；其他命令 hook 不执行。",
        modeLabel: "模式",
        triggerLabel: "触发词",
        sourceLabel: "来源",
        localSkill: "本地(非 git 管理)",
        notManaged: "非 git 管理的 skill 请直接修改技能目录。",
        uninstall: "移除",
        uninstalling: "移除中…",
        actionsLabel: "操作",
        recentLabel: "最近记录",
        noSkills: "未发现 skill。",
        errorTitle: "加载失败",
        emptyTrigger: "—",
        confirmUninstall: "确认从本地 skills 目录移除该 skill?",
        saveFail: "修改未保存",
        syncDone: "同步完成",
      },
      en: {
        nav: "Skill manager",
        intro: "Manage proactive skill usage, trigger hooks, and GitHub sync. Auto mode injects the full instructions when a task matches the skill's declared triggers; suggest only prompts the model; off disables participation.",
        enabled: "Enable proactive usage",
        enabledHint: "When off, the manager bypasses every step and only manual invocation remains.",
        maxAuto: "Max auto-loads per turn",
        maxAutoHint: "0–8; overflow becomes suggestions.",
        update: "Update from GitHub",
        updating: "Syncing…",
        refresh: "Refresh",
        installTitle: "Install skills from a git repository",
        urlPlaceholder: "owner/repo or https://github.com/owner/repo.git",
        refPlaceholder: "Branch/tag (optional)",
        installBtn: "Install & discover",
        installHint: "Discovers Codex/Claude plugin manifests, skills, and in-repo Node lifecycle hooks; other command hooks stay disabled.",
        modeLabel: "Mode",
        triggerLabel: "Triggers",
        sourceLabel: "Source",
        localSkill: "local (not git-managed)",
        notManaged: "Edit the skills directory directly for non-git skills.",
        uninstall: "Remove",
        uninstalling: "Removing…",
        actionsLabel: "Actions",
        recentLabel: "Recent activity",
        noSkills: "No skills found.",
        errorTitle: "Load failed",
        emptyTrigger: "—",
        confirmUninstall: "Remove this skill from the local skills directory?",
        saveFail: "Change not saved",
        syncDone: "Sync finished",
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

    function ManagerSection({ connection }) {
      const [view, setView] = useState(null);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [noticeOk, setNoticeOk] = useState(true);
      const [busy, setBusy] = useState(null);
      const [url, setUrl] = useState("");
      const [ref, setRef] = useState("");
      const [cwd, setCwd] = useState("");

      const call = useCallback(async (endpoint, payload, signal) => {
        const result = await connection.rpc.call(CHANNEL, endpoint, payload ?? {}, signal);
        if (!result.ok) throw new Error((result.error && result.error.message) || "rpc failed");
        return result.value;
      }, [connection]);

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
          setNotice(message);
          await reload();
        } catch (reason) {
          setNoticeOk(false);
          setNotice((reason && reason.message) || String(reason));
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
          h("p", { style: { ...styles.notice, ...styles.noticeError } }, error));
      }
      if (!view) return h("section", { style: styles.section }, "…");

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
        }, MODES.map((mode) => h("option", { key: mode, value: mode }, MODE_LABELS[mode])));
        const removeButton = managed
          ? h("button", {
              type: "button",
              disabled: busy !== null,
              onClick: () => run("uninstall", "uninstall", { name: skill.name }),
              style: styles.button,
            }, "移除")
          : null;
        const sourceText = grouped ? null : (managed ? `${skill.git.sourceUrl} @ ${skill.git.commit.slice(0, 7)}` : "本地 skill");
        const triggersInput = h("input", {
          type: "text",
          key: `${skill.name}-${(skill.userTriggers || []).join(",")}`,
          defaultValue: (skill.triggers || []).join(", "),
          placeholder: "触发词(逗号分隔,支持 re:正则)",
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
            h("span", { style: styles.chip }, skill.source),
            modeSelect,
            removeButton,
            sourceText && h("span", { style: styles.git }, sourceText),
            (skill.hooksCount || 0) > 0 && h("span", { style: styles.chip }, `hooks: ${skill.hooksCount}`)),
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
            h("span", { style: styles.chip }, `skills: ${sourceSkills.length}`),
            h("span", { style: styles.chip }, `hooks: ${hooks}`),
            unsupported > 0 && h("span", { style: styles.chip }, `unsupported hooks: ${unsupported}`)),
          plugin.description && h("p", { style: styles.skillDesc }, plugin.description),
          h("p", { style: styles.meta }, `${source.url} @ ${(source.commit || "").slice(0, 7)}`),
          sourceSkills.map((skill) => skillCard(skill, true)));
      });

      const eventItems = events.map((event, index) => {
        const when = new Date(event.at).toLocaleString();
        return h("p", {
          key: `${event.at}-${index}`,
          style: styles.meta,
        }, `[${when}] ${event.kind}: ${event.detail}`);
      });

      return h("section", { style: styles.section },
        h("p", { style: styles.intro }, `Skill 管理 · ${view.meta.skillsRoot || ""}`),
        h("label", { style: styles.row },
          "项目 workspace cwd",
          h("input", {
            type: "text",
            placeholder: "留空 = 用户级 skill;填写后显示项目 .dsh/skills、.agents/skills",
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
          "启用主动使用",
          h("span", { style: styles.hint }, "关闭后仅保留手动调用。")),
        h("label", { style: styles.row },
          "每轮最多自动加载",
          h("input", {
            type: "number",
            min: 0,
            max: 8,
            step: 1,
            value: String(config.maxAuto ?? 2),
            onChange: (event) => changeConfig("maxAuto", Number(event.target.value)),
            style: { ...styles.input, maxWidth: 90 },
          })),
        h("div", { style: styles.row },
          h("button", {
            type: "button",
            disabled: busy !== null || !hasGit,
            onClick: () => run("update", "update"),
            style: styles.button,
          }, busy === "update" ? "正在同步…" : "从 GitHub 更新"),
          h("button", {
            type: "button",
            disabled: busy !== null,
            onClick: () => run("refresh", "refresh"),
            style: styles.button,
          }, "刷新"),
          !hasGit && h("span", { style: styles.hint }, "未检测到 git。")),
        h("div", { style: styles.card },
          h("div", { style: { fontWeight: 600, marginBottom: 6 } }, "从 Git 仓库安装 plugin / skills"),
          h("div", { style: styles.row },
            h("input", {
              type: "text",
              placeholder: "owner/repo 或 https://github.com/owner/repo.git",
              value: url,
              onChange: (event) => setUrl(event.target.value),
              style: { ...styles.input, flex: 1 },
            }),
            h("input", {
              type: "text",
              placeholder: "分支/标签(可选)",
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
            }, "安装并发现")),
          h("p", { style: styles.hint }, "识别 Codex/Claude plugin manifest、skills 与仓库内 node lifecycle hooks；其他命令 hook 不执行。")),
        notice !== null && h("pre", {
          style: { ...styles.notice, ...(noticeOk ? styles.noticeOk : styles.noticeError) },
        }, notice),
        h("div", { style: { marginTop: 14 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, `已管理插件 / Git 来源 (${plugins.length})`),
          plugins.length === 0 && h("p", { style: styles.hint }, "尚未通过 manager 安装插件来源。"),
          pluginCards),
        skills.length === 0 && h("p", { style: styles.hint }, "未发现 skill。"),
        otherSkills.length > 0 && h("div", { style: { marginTop: 14 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, `本地 / 项目 skills (${otherSkills.length})`),
          otherSkills.map((skill) => skillCard(skill))),
        events.length > 0 && h("div", { style: { marginTop: 12 } },
          h("div", { style: { fontWeight: 600, marginBottom: 4 } }, "最近记录"),
          eventItems));
    }

    const name = "dsh-skills-manager";
    const inject = ["slots", "connection", "locale"];

    function apply(ctx) {
      const t = ctx.locale ? ctx.locale.bind("skillManager") : (key) => DICT.zh[key] ?? key;
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
        inject: () => ({ connection }),
      }, ManagerSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});

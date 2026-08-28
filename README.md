# dsh-skills-manager

DeepSeek Harness 的 Skill 管理插件:让 skill **真正被主动使用**,支持 **skill 级 hook 声明**、**GitHub 同步更新** 和 **Settings 管理界面**。设计对标 Claude Code (SKILL.md + hooks + plugin marketplace) 与 OpenAI Codex 的 skill 机制。

## 问题背景

DSH 内置的 `skill` 工具只有一种使用路径:模型看到 `<available_skills>` 摘要后**自己决定**调用 `skill` 工具加载全文。结果:

- 模型经常不调用 → 大量 skill 闲置("没有主动使用");
- SKILL.md 无法声明触发条件,也没有任何 hook 接缝(技能文件里没有能被执行的东西);
- skill 分散在本地目录,无法从 GitHub 一键更新。

DSH 宿主层有完整的事件 hook(`agent/pre-step`、`tools/pre-execute`、`tools/post-execute`、`tools/result`、`system-prompt/assemble`、`skills/change`…,等价于 Claude Code 的 UserPromptSubmit / PreToolUse / PostToolUse),**但没有任何东西把 skill 声明接上去**。本插件就是那个接缝。

## 功能

### 1. 主动激活(agent/pre-step hook)

每步请求之前,插件把用户消息与每个 skill 匹配,按命中强度分两档注入:

| 档位 | 条件 | 注入内容 |
| --- | --- | --- |
| **自动加载 (auto)** | skill 声明了触发词(或 `metadata.activation: auto`)且命中 | 完整 `<skill_content>` + 激活提醒(告诉模型"已自动加载,不要再调用 skill 工具") |
| **建议加载 (suggest)** | 描述/`whenToUse` 有较高词元重合 | 一条轻量 `<system-reminder>`:列出匹配的 skill 和命中原因,提示模型按需调用 `skill` 工具 |

匹配打分:skill 名提及 (+12) > 触发词/正则 (+7) > 描述词元重合 (+4~6)。默认每轮最多自动加载 2 个、建议 3 个,可配置。

**去重与上下文**:激活标记作为 `skill-manager` 源消息写进会话历史;只要标记仍在可见 surface 内,同一 skill 不会重复注入全文(压缩后会自动重新注入)。规则:同一批消息里已有注入 → 跳过;已激活且仍可见 → 跳过。

### 2. Skill 级 hook(对标 Claude Code / Codex)

DSH 宿主层事件(hook 接缝)早已齐全,本插件把 **skill 声明**接到这些事件上,命名与 Claude Code 的 hook 事件一一对应:

| Claude Code hook | DSH 宿主事件 | 插件实现 |
| --- | --- | --- |
| `UserPromptSubmit` | `agent/pre-step` | ✅ skill 在会话中处于激活态时,每次提交注入 `hooks.UserPromptSubmit.inject` 文本 |
| `PreToolUse` | `tools/pre-execute` | ✅ 按工具名 + 参数模式返回 **allow / deny / ask**(decision+reason) |
| `PostToolUse` | `tools/post-execute` | ✅ 工具结果命中 `when` → 立即把该 skill 指令附加到下一步(`activate`) |
| `PostToolUseFailure` | `tools/post-execute`(错误结果一样到达) | ✅ 同 PostToolUse,`when: "re:exit code [1-9]"` 即失败触发 |
| `SessionStart` | `agent/session-start` | ✅ 首个步骤无需匹配即加载(`SessionStart.activate`) |
| `SessionEnd` / `Stop` | `agent/disposed` / `agent/turn-stopping` | ⚠️ 以 `skill-manager/hook` 事件观察,无内容注入 |
| `PreCompact` | (核心无对应事件) | ⚠️ 未实现;压缩后激活标记失效会自动重新注入 |

Codex 侧对标:skill 模式采用 Codex 词汇的别名(`manual`/`disabled` 等价于本插件的 `off`,仅显式调用;`auto` 语义对比见下表)。Codex 的 `auto`(模型可按需调用)= 本插件的 `suggest`;

**SKILL.md 中的声明**(全部通过 `metadata`,不改 DSH 核心):

```yaml
---
name: repo-hardening
description: Review and harden a repository with build/test gates.
metadata:
  activation: auto             # auto | suggest | off (兼容 manual/disabled)
  triggers:
    - "harden"
    - "build fails"
    - "re:exit code \\d+"
  hooks:
    UserPromptSubmit:          # 仅当本 skill 在会话中激活时,每轮注入这段上下文
      inject: "硬性要求:先跑 build 与 test,再下结论。"
    PreToolUse:                # 工具调用门禁
      - tool: bash
        when: "git push"       # 子串或 re:<pattern>,省略 = 全部
        decision: deny         # allow | deny | ask
        reason: "不允许直接 push"
    PostToolUse:               # 工具结果 → 立即激活本 skill
      - tool: bash
        when: "re:exit code [1-9]"
        action: activate
    SessionStart:              # 会话开始即激活(无需匹配)
      activate: true
---
```

- `triggers`:字符串数组。普通条目 = 大小写不敏感的子串匹配;`re:<pattern>` = 正则(不合法正则会被忽略)。
- `activation`:该 skill 在匹配时的默认档位。未声明时:有 triggers → `auto`,否则 `suggest`。
- `hooks`:Claude Code 事件名 + 结构化动作;`PreToolUse` 的 `tool` 可用 `*` 通配所有工具。

**hook 事件(宿主级可监听)**:除 `skills/change` 外,插件在每个 hook 执行时派发:
- `skill-manager/hook`(emit)— `{ event, skill, action, detail, at }`,例如 PreToolUse deny、PostToolUse activate。
- `skill-manager/update`(emit)— 安装/更新/卸载后的同步结果。

**用户侧覆盖(第三方仓库推荐)**:`metadata` 是上游文件、update 会覆盖,所以触发词与 hook 都可以放在插件状态里(与声明合并/按事件替换):

```sh
# Settings 界面每个 skill 行有"触发词"输入框(逗号分隔),或者让模型调用:
skill_manager set-triggers ponytail-review triggers=["review this diff","过度设计"]
skill_manager set-hooks repo-hardening hooks={ "PostToolUse": [{ "tool": "bash", "when": "re:exit code [1-9]", "action": "activate" }] }
```

### 3. 从 GitHub 安装与更新

- **安装**:`install <owner/repo|git-url> [ref]` — 接受 Claude/Codex marketplace 的 `owner/repo` 简写或完整 Git URL，浅克隆(single-branch)到 `<DSH_HOME>/skill-sources/<slug>`,自动发现仓库里的 `SKILL.md` 目录(深度 ≤3,跳过 .git/node_modules/dist/build),把每个 skill 目录拷贝进 `<DSH_HOME>/skills/<name>`。skill 名取自 frontmatter `name`。
- **插件包**:优先读取 `.codex-plugin/plugin.json`,其次读取 `.claude-plugin/plugin.json`;管理页显示插件名、版本、skills 与 hook 数量。manifest 指向仓库内的 Node lifecycle hook 可运行 `SessionStart` / `UserPromptSubmit`;其他事件或命令类型标记为 unsupported。
- **更新**:`update` — 对每个来源 `git fetch --depth 1 origin <ref>` + `git reset --hard FETCH_HEAD`,然后**权威同步**(删除旧拷贝、重新拷贝已安装的 skill)。返回每个 skill 的 commit 变化(旧 → 新)。
- 更新后无需手动刷新:filesystem skill provider 的文件监视器会自动失效缓存并重发 `skills/change`,模型目录随之更新。
- 状态记录在 `<DSH_HOME>/skill-manager.json`:来源、ref、commit、每个 skill 的安装路径、用户模式覆盖、最近操作历史(50 条)。

安全:git 来源白名单(`owner/repo`、https://、git@、ssh://),参数数组直传 `git`;hook 不经 shell,只执行 manifest 中指向仓库内部的 `node` 脚本。安装含 hook 的插件等同于信任其代码。

### 项目 workspace 专属 skill

filesystem provider 按 `cwd` 扫描多个根,优先级从高到低(高覆盖低):

| 根 | 路径 | source 值 |
| --- | --- | --- |
| 项目专属 | `<项目>/.dsh/skills` | `project-dsh` |
| 项目专属 | `<项目>/.agents/skills` | `project-agents` |
| 自定义 | 宿主配置的目录 | `custom` |
| 用户级 | `<DSH_HOME>/skills` | `user-dsh` |
| 用户级 | `<agentsHome>/skills` | `user-agents` |
| 内置 | bundled | `bundled` |

本插件对项目 skill 的处理:

- **主动匹配与自动激活**:pre-step 按会话 `cwd` 调用 `ctx.skills.snapshot({cwd, scope})`,项目 skill 与用户级 skill 同等参与打分/注入,同名时项目根自动胜出(rank 更小)。
- **覆盖作用域隔离(重要)**:`set-mode` / `set-triggers` / `set-hooks` 的记录按 `scope`(user|project)+ `cwd` 存储。项目 skill 的同名记录**只在自己的 workspace 生效**,绝不会被用户级的同名配置污染,反之亦然。
- **管理界面**:Settings → Skill 管理 顶部有"项目 workspace cwd"输入框,留空列出用户级+内置 skill,填写后列出该项目的专属 skill(每行显示 `source` 徽标,包含其名字/触发词/hook/模式编辑)。
  Web Settings 没有 agent preset,因此 manager 会直接合并 `<DSH_HOME>/skills` 的一级有效 skill;若与项目 skill 同名,项目 catalog 项保持优先。
- **模型工具**:`skill_manager status|set-*` 支持 `scope: project` + `cwd: <路径>`(项目记录必须带 cwd)。
- **hook 索引按 cwd 建立**:每个 workspace 的 PreToolUse/PostToolUse/SessionStart hook 独立解析,同一项目会话用同一索引(目录变更经 `skills/change` 自动失效)。
- **更新模型**:项目 skill 由项目的 git 仓库管理(它们本就在项目里),manager 的 `update` 只同步用户级来源;项目内改动由 watcher 自动刷新目录。

### 4. Settings 管理界面 + 模型工具

- **Settings → "Skill 管理"**:总开关(启用主动使用)、每轮最大自动加载数、"从 GitHub 更新"按钮、Git 仓库安装表单、每个 skill 的模式下拉(auto/suggest/off)、触发词展示、git 来源与 commit、卸载按钮、最近记录。
- **模型工具 `skill_manager`**:`status` / `install <url>` / `update` / `uninstall <name>` / `set-mode <name> <mode>` / `set-config`。说一句"从 GitHub 更新 skill"即可触发。

## 安装

```sh
# 1. 把插件目录 link 进 web profile(或使用 dsh plugin 子命令)
cd /data/dsh/profiles/web
pnpm add link:/data/dsh/home/dsh-skills-manager

# 2. 把包名加入 profile package.json 的 dsh.profile.bundles:
#    "dsh-skills-manager"
# 3. 重启 web profile 使宿主侧生效;客户端 bundle 会自动重建
```

插件通过自身的 `cordis.patch.yml` 向 composition 插入一行 `skill-manager`(宿主级),对**所有会话**生效。

## Skill 目录约定

- 管理对象是 `<DSH_HOME>/skills`(filesystem provider 的 user root)。
- 本地手写的 skill 不受 git 管理;只有从来源安装的 skill 才能被"更新"和"移除"。
- `set-mode off` 只关掉自动参与,模型仍可手动调用 `skill` 工具。

## 扩展:给匹配器接更多输入源

"工具输出触发"现在内置为 `PostToolUse` hook;任何插件仍可在宿主事件上补充来源,例如把外部通知加入提示词:

```js
ctx.on("agent/pre-step", async (payload, next) => {
  const decision = await next();
  if (decision.kind !== "enter") return decision;
  // 把自定义上下文拼进该步骤
  return { kind: "enter", messages: [...decision.messages, extra] };
});
```

## 开发与测试

```sh
pnpm test      # node --test test.mjs,纯逻辑 18 个用例
pnpm lint      # node --check
```

`lib.js`(匹配/打分/状态/manifest)为纯函数,可直接单测;`index.js` 只承担接线(事件、工具、RPC、git)。

## License

MIT

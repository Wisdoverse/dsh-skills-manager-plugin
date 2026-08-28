# Contributing

Thanks for helping improve `dsh-skills-manager`.

## Prerequisites

- Node.js `^22.19.0 || >=24.0.0`;
- pnpm 11;
- Git;
- DeepSeek Harness `0.1.1-rc.2` for integration smoke tests.

## Setup

```sh
git clone https://github.com/Wisdoverse/dsh-skills-manager-plugin.git
cd dsh-skills-manager-plugin
pnpm install --frozen-lockfile
```

## Required checks

Run all repository gates before opening a pull request:

```sh
pnpm lint
pnpm test
pnpm pack --dry-run
```

The test suite includes a package-contract check for `dsh.bundle`, `cordis.patch.yml`, exports, and packaged files. CI runs the same gates on Ubuntu and Windows with the supported Node.js versions.

For changes to the bundle or host wiring, also install the checkout into a disposable DSH Home and verify the composed configuration contains the plugin layer:

```sh
dsh plugin --profile web add .
dsh --profile web --dump-config
```

Do not use a production profile for destructive installation experiments.

## Code boundaries

- Keep matching, scoring, state, manifest, and normalization logic in `lib.js` so it remains directly testable.
- Keep DSH lifecycle wiring, RPC, process execution, and filesystem effects in `index.js`.
- Normalize persisted repository-relative paths to `/` on every platform.
- Pass Git arguments as an array; do not introduce shell interpolation.
- Validate repository-contained hook paths before execution and preserve existing time and output limits.
- Add the smallest regression test that proves a bug fix.

## Documentation

`README.md` is the default English page and `README.zh-CN.md` is its Simplified Chinese mirror. User-facing behavior, installation steps, compatibility claims, permissions, and security boundaries must stay synchronized between them.

## Pull requests

- Keep each commit focused and explain the user-visible outcome.
- Avoid unrelated formatting or refactors.
- Include the exact validation commands and results.
- Call out compatibility, security, data, or migration effects explicitly.
- Never commit credentials, private skill sources, generated package archives, or a local DSH Home.

## 中文说明

提交前请运行 `pnpm lint`、`pnpm test` 与 `pnpm pack --dry-run`。涉及宿主接线时，还应在隔离的 DSH Home 中执行安装与 `--dump-config` 烟测。中英文 README 的功能、安装、兼容性、权限和安全说明必须同步更新。

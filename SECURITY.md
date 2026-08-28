# Security Policy

## Supported versions

Security fixes are applied to the latest `1.0.x` release and the current `main` branch.

## Reporting a vulnerability

Please use [GitHub's private vulnerability reporting](https://github.com/Wisdoverse/dsh-skills-manager-plugin/security/advisories/new) when it is available. Include:

- the affected version or commit;
- the trust boundary involved;
- reproduction steps or a minimal proof of concept;
- expected and observed behavior;
- any suggested mitigation.

Do not publish exploit details, secrets, or user data in a public issue. If private reporting is unavailable, open a public issue that asks the maintainers for a private contact channel without including sensitive details.

## Security boundaries

This plugin runs inside the DSH host process and therefore inherits that process's filesystem and network authority. Its main privileged operations are:

- invoking `git` for user-requested skill-source installation and updates;
- copying or removing manager-owned skill directories under `DSH_HOME`;
- executing Node lifecycle hooks explicitly declared by an installed plugin manifest.

Installing a third-party skill source that declares executable hooks is a code-trust decision. Review and pin the source before installation when the environment contains sensitive data or credentials.

## 安全问题报告

请优先使用 GitHub Private Vulnerability Reporting 私密提交漏洞，并提供受影响版本、复现步骤、影响范围和缓解建议。不要在公开 Issue 中提交利用细节、密钥或用户数据；如果私密报告不可用，请只在公开 Issue 中请求维护者提供私密联系渠道。

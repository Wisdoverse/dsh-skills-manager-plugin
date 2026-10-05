# Agent instructions

This package adds skill activation, hooks, Git sources, and a Settings UI to DeepSeek Harness (DSH).

- Follow [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code boundaries, tests, releases, and bilingual documentation.
- Read [SECURITY.md](SECURITY.md) before changes to Git, hooks, paths, or stored data.
- Apply the [writing rules](docs/agent-writing.md) to instructions, documentation, comments, and replies.

## Work

- Read the affected code and its callers before edits.
- Make the smallest change that satisfies the request. Preserve unrelated user changes.
- Reuse existing code before you add a dependency.
- Keep the Settings UI and its English and Chinese text in `client/client.js`.
- Keep project overrides separate by `scope` and `cwd`.
- Preserve Git source checks. Do not execute hooks through a shell.
- Before skill deletion, check that the manager owns the target directory.

## Checks

- Use the runtime versions in `package.json`.
- For code changes, package changes, or pull requests, run the [required checks](CONTRIBUTING.md#required-checks).
- For documentation changes, check links, project facts, and the writing rules.
- Report the checks that ran, their results, and any checks that could not run.

Keep this file short. Put detailed procedures in linked documents.

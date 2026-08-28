# Changelog

All notable changes to this project are documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Token-free npm Trusted Publishing from version-matched GitHub tags, with release gates and automatic provenance.

## 1.0.0 - 2026-08-29

### Added

- Proactive `auto` and `suggest` skill activation.
- Skill-level lifecycle hooks and tool-call policies.
- GitHub-backed skill installation, update, and uninstall workflows.
- Project-scoped skill overrides and Settings management UI.
- Cross-platform CI for Node.js 22 and 24 on Ubuntu and Windows.
- Package-contract tests for the DSH bundle manifest, patch, exports, and packaged files.
- Verified npm and GitHub installation, update, removal, compatibility, permission, security, and contribution documentation.
- Machine-readable repository, runtime, package-manager, and public npm publishing metadata.

### Fixed

- Normalize discovered skill paths to `/` on every platform so Windows installations persist portable repository-relative paths.

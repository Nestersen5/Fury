# Tooling map

Run scripts from the repository root unless a script says otherwise.

- `package_windows.js` and `package_macos.js` build platform packages. The
  `verify_packaged_*.js`, `verify_no_browser.js`, and `smoke_packaged_app.js`
  scripts check their payloads and runtime behavior.
- `release_artifacts.js` records local package metadata and hashes.
- `verify_*.js` scripts exercise focused launcher, platform, update, and
  packaging contracts. `verify_additional_features.js` discovers permanent
  tests under `tests/` that the primary npm scripts do not run.
- `assets/` contains icon and resource-pack development tools.
- `development/` contains offline recording inspection and report tools.
- `benchmarks/` contains performance measurements; `test_support/` contains
  shared harness modules.

The production entry points remain at the repository root. The permanent tests
are grouped by owner under `tests/`.

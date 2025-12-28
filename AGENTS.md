# Repository Guidelines

## Project Structure & Module Organization
This repository is currently a clean slate with no tracked files beyond the `.git` directory. When you add code, keep the layout predictable and document it here. A suggested structure for this repo:

- `src/` for application or library code.
- `tests/` for unit/integration tests (mirror `src/` subfolders).
- `scripts/` for developer tooling (build, release, data tasks).
- `docs/` for design notes and architecture diagrams.
- `assets/` for static files (images, fixtures).

If you choose a different layout, update this section with the actual paths and their purpose.

## Build, Test, and Development Commands
No build or test commands are defined yet. When you add tooling, list the exact commands here with brief explanations, for example:

- `npm run build` — compile production assets.
- `npm test` — run the full test suite.
- `./scripts/dev.sh` — start the local development server.

## Coding Style & Naming Conventions
No language or style guide is set. Please add a formatter and linter early (e.g., `prettier`, `eslint`, `black`, `ruff`) and document the required indentation and naming conventions. Example conventions to adopt and document:

- Indentation: 2 spaces (JS/TS) or 4 spaces (Python).
- File names: `kebab-case` for scripts, `PascalCase` for components.
- Class/function naming patterns appropriate to the chosen language.

## Testing Guidelines
Testing frameworks and coverage requirements are not yet defined. When you add tests, specify:

- Framework (e.g., `vitest`, `jest`, `pytest`).
- Naming conventions (e.g., `*.test.ts`, `test_*.py`).
- How to run tests locally (e.g., `npm test`, `pytest`).

## Commit & Pull Request Guidelines
There is no Git history yet, so no established commit message conventions. Until a pattern is adopted, use clear, imperative summaries (e.g., "Add lint configuration", "Implement user login"). For pull requests, include:

- A concise description of the change and rationale.
- Linked issues or tickets if applicable.
- Screenshots or logs for UI/behavior changes.

## Agent-Specific Instructions
If you add automation or agent workflows, record them here so contributors can follow the same conventions and tooling.

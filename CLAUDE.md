# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (esbuild bundles extension + webview)
npm run compile      # or: just build

# Watch mode
npm run watch

# Production build (for packaging)
npm run package

# Lint
npm run lint         # or: just lint

# Tests (mocha + ts-node, no VS Code host needed)
npm run test         # or: just test

# Run a single test file
npx mocha -r ts-node/register --timeout 10000 test/path/to/file.ts

# Full preflight check
just preflight
```

## Architecture

This is a **VS Code extension** that provides:
1. A live 3D preview panel for `.scad` files (using Three.js to render STL output from OpenSCAD)
2. A GitHub Copilot chat participant (`@scad`) with AI-powered commands for 3D printing workflows
3. Language model tools that allow AI agents to interact with the preview panel

### Build System

`esbuild.js` produces two bundles into `dist/`:
- `extension.js` — the Node.js extension host bundle (entry: `src/extension.ts`)
- `webview.js` — the browser bundle loaded in the webview panel (entry: `src/webview/webview.ts`)

### Core Data Flow

```
.scad file saved
  → ScadRunner (spawns openscad CLI) → STL binary
  → PreviewPanel.renderScad() → postMessage({ command: 'updateSTL', data })
  → webview.js (Three.js) → STLLoader → 3D scene render
```

`PreviewPanel` maintains a static `Map<string, PreviewPanel>` keyed by document URI, so one panel per file. Parameter overrides from the webview Customizer UI are stored per panel and passed back to `ScadRunner` on each render.

### Multi-Agent Pipeline (`src/agents/`)

The `/create` and `/debug` chat commands use a multi-agent orchestration system:

- **`runner.ts`** — Single LLM communication layer. `runAgent()` handles the full tool-call loop (stream → collect tool calls → invoke tools → continue). All agents use this. Skills are loaded from `.agents/skills/*.skill.md`.
- **`reportParsers.ts`** — Pure parsing utilities (no VS Code dependency). Each agent emits a structured report block between sentinel strings (e.g., `DIAGNOSTIC_REPORT_START` / `DIAGNOSTIC_REPORT_END`). Parsers extract fields from these blocks to drive orchestrator decisions.
- **`tools.ts`** — Registers the four `scad_renderer_*` language model tools: `render`, `capture_preview`, `update_code`, `open_file`.
- **`instructionManager.ts`** — Manages `.github/copilot-instructions.md` for workspace-level AI context.

Agent skills in `.agents/skills/`:
- `scad-orchestrator` — decides which agent to call next (`CALL_CODER`, `CALL_REVIEWER`, `CALL_QA`, `CALL_DEBUGGER`, `CALL_DESIGNER`, `DONE`)
- `scad-designer` — interviews user to gather requirements
- `scad-coder` — writes OpenSCAD code
- `scad-reviewer` — checks code quality and FDM printability
- `scad-qa` — visual QA using the preview capture tool
- `scad-debugger` — diagnoses rendering errors

### Chat Participant (`src/aiAssistant.ts`)

Routes `/optimize`, `/parametric`, `/printability` to single-turn LLM calls using `COMMAND_PROMPTS`. Routes `/create` to `createAgent.ts` and `/debug` to `debugAgent.ts` (both use the multi-agent pipeline). Detects active `/create` sessions by scanning `context.history`.

### Key Requirement

OpenSCAD with **Manifold engine support** (development snapshot) is required for reliable rendering. The extension checks for this at activation via `ScadRunner.supportsManifold()`.

# Changelog

All notable changes to the OpenSCAD Renderer extension are documented here.

## [0.1.0] - 2025-03-30

### Added
- Live 3D preview panel for `.scad` files using Three.js and the Manifold engine
- Improved 3D viewer: 4-light rig with shadows, dual perspective/orthographic camera, wireframe/x-ray/solid render modes, axes widget, theme-aware fog and grid
- Toolbar: camera projection toggle, render mode buttons, shadows toggle
- AI chat participant (`@scad`) powered by GitHub Copilot with five commands:
  - `/create` — interview-driven 3D model generation with multi-agent pipeline
  - `/debug` — root-cause analysis and auto-fix for rendering errors
  - `/optimize` — FDM printability optimisation
  - `/parametric` — refactor hard-coded values into named parameters
  - `/printability` — identify thin walls, overhangs, and non-manifold geometry
- Multi-agent orchestration: Orchestrator → Coder → Reviewer → QA → Debugger pipeline
- Session change log shared across all agents to prevent regression loops
- Coder mandatory render + visual self-check gates before finishing
- WorkspaceEdit-based file changes for full undo support and git diff tracking
- OpenSCAD Customizer parameter UI with live parameter overrides
- Telemetry via VS Code telemetry API (respects user privacy settings)
- Feedback command linking to GitHub Issues

# OpenSCAD Renderer

Live 3D Preview of OpenSCAD files with AI-powered modeling assistance in VS Code.

[![VS Code Marketplace](https://img.shields.io/visual-studio-code/v/luizbon.vscode-scad-renderer?color=0078d4&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=luizbon.vscode-scad-renderer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![VS Code Engine](https://img.shields.io/badge/VS%20Code-v1.95.0%2B-blue)](https://code.visualstudio.com/)

## Overview

OpenSCAD Renderer brings real-time 3D visualization and AI-powered design tools to VS Code. Preview your parametric OpenSCAD models instantly as you code, and use GitHub Copilot-powered AI agents to generate, debug, optimize, and refactor your designs for 3D printing.

## Features

### 🔍 Live 3D Preview

- Real-time STL rendering with Three.js as you save your `.scad` files
- Smooth orbiting, panning, and zoom controls
- Automatic re-render on file save
- One preview panel per file for parallel editing

### 💡 Improved Viewer

- **Advanced Lighting**: 4-light rig with dynamic shadows for realistic visualization
- **Dual Camera Modes**: Switch between perspective and orthographic projection
- **Render Modes**: Solid, wireframe, and x-ray modes for different analysis needs
- **UI Widgets**: Coordinate axes indicator and orientation helper
- **Smart Environment**: Theme-aware fog and grid background
- **Customizer UI**: Interactive parameter controls with live preview updates

### 🤖 AI Assistant (`@scad`)

GitHub Copilot-powered multi-agent orchestration for 3D modeling workflows:

- **`/create`** — Interview-driven model generation. Describe what you want, and an AI interview extracts your requirements before generating parametric OpenSCAD code
- **`/debug`** — Root-cause analysis and automatic fixes for rendering errors and SCAD syntax issues
- **`/optimize`** — Optimize designs for FDM printing by identifying and fixing overhangs, wall thickness issues, and support structure requirements
- **`/parametric`** — Refactor hard-coded values into named parameters for reusable, customizable models
- **`/printability`** — Scan for 3D printability issues: thin walls, unsupported geometry, non-manifold surfaces, and structural weaknesses

## Requirements

- **OpenSCAD with Manifold Engine**: Development snapshot version (version with "Manifold" engine support). The stable release does not include Manifold support, which is required for reliable rendering. Download from [https://openscad.org/downloads.html](https://openscad.org/downloads.html)
  - macOS: `brew install --cask openscad@snapshot`
  - Windows: `winget install OpenSCAD.OpenSCAD.Snapshots`
  - Linux: Download AppImage from https://openscad.org/downloads.html
- **GitHub Copilot** (required for AI features like `/create`, `/debug`, `/optimize`, `/parametric`, `/printability`)
- **VS Code** 1.95.0 or later

## Getting Started

### 1. Install OpenSCAD Development Snapshot

Download and install a development snapshot of OpenSCAD from [https://openscad.org/downloads.html](https://openscad.org/downloads.html). The extension requires the Manifold engine, which is only available in development snapshots, not the stable release.

**Platform-specific installation:**

- **macOS**: Run `brew install --cask openscad@snapshot`, or download the DMG from https://openscad.org/downloads.html
- **Windows**: Run `winget install OpenSCAD.OpenSCAD.Snapshots`, or download the installer from https://openscad.org/downloads.html
- **Linux**: Download the AppImage or use your distribution's package manager

### 2. Configure OpenSCAD Executable Path (if needed)

The extension automatically detects OpenSCAD in your system PATH. If your OpenSCAD installation is not detected, you can specify the path manually in VS Code settings:

1. Open VS Code Settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux)
2. Search for `scadRenderer.executablePath`
3. Enter the full path to your OpenSCAD executable (e.g., `/usr/local/bin/openscad` or `C:\Program Files\OpenSCAD\bin\openscad.exe`)

### 3. Open a SCAD File

Open any `.scad` file in VS Code.

### 4. Show the 3D Preview

- Click the **Preview** icon in the editor title bar, or
- Right-click the file in the Explorer and select **SCAD: Show 3D Preview**, or
- Open the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux) and run **SCAD: Show 3D Preview**

The 3D preview panel will open on the right side, displaying your model in real time.

## AI Commands

Use GitHub Copilot's chat interface with the `@scad` participant to access AI-powered modeling tools:

| Command | Description |
|---------|-------------|
| `@scad /create <description>` | Create a new 3D-printable model from a natural language description. An interactive interview extracts your requirements, then generates parametric OpenSCAD code. |
| `@scad /debug` | Diagnose and fix rendering errors. Analyzes SCAD syntax issues and provides auto-fixes. |
| `@scad /optimize` | Optimize the active SCAD file for FDM 3D printing, addressing overhangs, wall thickness, and support structures. |
| `@scad /parametric` | Refactor hard-coded values into parametric variables for reusable, customizable models. |
| `@scad /printability` | Identify 3D printability issues: thin walls, unsupported geometry, non-manifold surfaces, and structural weaknesses. |

## 3D Viewer Controls

### Mouse Controls

- **Left Click + Drag**: Rotate the model
- **Middle Click + Drag** (or **Right Click + Drag**): Pan the view
- **Scroll Wheel**: Zoom in/out

### Keyboard Shortcuts

- **P**: Toggle between Perspective and Orthographic camera modes
- **W**: Wireframe render mode
- **X**: X-ray render mode
- **S**: Solid render mode
- **L**: Toggle shadows

## Configuration

Configure the extension via VS Code Settings (`Cmd+,` on macOS, `Ctrl+,` on Windows/Linux):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `scadRenderer.executablePath` | string | `openscad` | Path to the OpenSCAD executable. Can be an absolute path or a command name. The extension will search your system PATH if a relative name is provided. |

## Known Limitations

- **Requires OpenSCAD Development Snapshot**: The stable release of OpenSCAD does not include Manifold engine support, which is required for reliable 3D rendering. Use a development snapshot from https://openscad.org/downloads.html
- **GitHub Copilot Required**: AI features (`/create`, `/debug`, `/optimize`, `/parametric`, `/printability`) require an active GitHub Copilot subscription
- **Preview Panel Visibility**: AI agents that capture screenshots (like `/create` and `/debug`) require the preview panel to be visible during execution
- **Legacy Mode**: If using OpenSCAD without Manifold support, preview rendering will be limited to older/slower rendering backends

## Feedback & Issues

Found a bug or have a feature request?

- [Open an issue on GitHub](https://github.com/luizbon/vscode-scad-renderer/issues)
- Use the `SCAD: Report an Issue` command from the Command Palette (`Cmd+Shift+P` on macOS, `Ctrl+Shift+P` on Windows/Linux)

Your feedback helps improve the extension for everyone.

## Contributing

Contributions are welcome! Visit the repository at [https://github.com/luizbon/vscode-scad-renderer](https://github.com/luizbon/vscode-scad-renderer) to report issues, suggest features, or submit pull requests.

## License

This extension is licensed under the MIT License. See the LICENSE file in the repository for details.

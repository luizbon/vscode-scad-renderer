# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the OpenSCAD Renderer extension, please report it responsibly.

**Do not** open a public GitHub issue. Instead:

1. Email security concerns to the repository maintainer or create a private security advisory via GitHub
2. Include details about the vulnerability, how to reproduce it, and potential impact
3. Allow time for a fix before public disclosure

## Security Measures

This extension:
- Does not collect personal data beyond what VS Code's telemetry API provides (respects user privacy settings)
- Does not execute arbitrary code — OpenSCAD execution is controlled via the `openscad` binary
- Uses secure defaults for file handling and command execution
- Validates all user inputs before processing

## Dependencies

Keep the extension up to date to receive security patches for dependencies. Run `npm audit` regularly and check for updates using `npm outdated`.

## Feedback

For security questions or general feedback, please open an issue at [https://github.com/luizbon/vscode-scad-renderer/issues](https://github.com/luizbon/vscode-scad-renderer/issues).

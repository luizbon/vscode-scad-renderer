import * as vscode from 'vscode';
import * as path from 'path';
import { PreviewPanel } from '../PreviewPanel';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
};

/**
 * Creates a language model image part compatible with the current VS Code version.
 *
 * - VS Code 1.99+: uses `LanguageModelDataPart.image()` (the new unified data-part API).
 * - VS Code < 1.99: falls back to the legacy `LanguageModelImagePart` constructor.
 * - Returns `null` when neither API is available (caller should omit the image part).
 */
function makeImagePart(data: Buffer, mimeType: string): unknown | null {
    const vscodeAny = vscode as any;
    if (typeof vscodeAny.LanguageModelDataPart !== 'undefined') {
        // New API: LanguageModelDataPart.image(data, mimeType)
        return vscodeAny.LanguageModelDataPart.image(data, mimeType);
    }
    if (typeof vscodeAny.LanguageModelImagePart !== 'undefined') {
        // Legacy API (VS Code < 1.99)
        return new vscodeAny.LanguageModelImagePart(data, mimeType);
    }
    return null;
}

/**
 * Resolves a path that may be absolute, workspace-relative, or a bare filename.
 * Returns the resolved absolute path, or null if it cannot be resolved to a
 * location inside a workspace folder.
 */
function resolveWorkspacePath(inputPath: string): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
    }
    // Already absolute and inside a workspace folder
    if (path.isAbsolute(inputPath)) {
        const inside = workspaceFolders.some(f => inputPath.startsWith(f.uri.fsPath + path.sep) || inputPath === f.uri.fsPath);
        return inside ? inputPath : null;
    }
    // Relative path or bare filename — try resolving under each workspace root
    for (const folder of workspaceFolders) {
        const resolved = path.join(folder.uri.fsPath, inputPath);
        if (resolved.startsWith(folder.uri.fsPath)) {
            return resolved;
        }
    }
    return null;
}

function isValidScadPath(filePath: string): boolean {
    if (!filePath.endsWith('.scad')) {
        return false;
    }
    return resolveWorkspacePath(filePath) !== null;
}

function isValidImagePath(filePath: string): boolean {
    if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return false;
    }
    return resolveWorkspacePath(filePath) !== null;
}

// Define the tools in package.json as well for chat discovery
export function registerScadTools(context: vscode.ExtensionContext) {
    // 0. Tool to get workspace context (roots + active editor)
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_get_workspace_info', {
        async invoke(_options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, _token: vscode.CancellationToken) {
            const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath);
            const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath ?? null;
            const panelFile = PreviewPanel.currentPanel?.documentUri.fsPath ?? null;
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    workspaceFolders: folders,
                    activeEditorFile: activeFile,
                    previewPanelFile: panelFile,
                }, null, 2))
            ]);
        }
    }));
    // 1. Tool to trigger a render
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_render', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken) {
            const panel = PreviewPanel.currentPanel;
            if (!panel) {
                return {
                    content: [new vscode.LanguageModelTextPart('No active SCAD preview panel found. Please open a preview first.')]
                };
            }

            const execPath = panel.execPath;
            if (!execPath) {
                return {
                    content: [new vscode.LanguageModelTextPart('OpenSCAD executable path not configured.')]
                };
            }

            // Trigger render
            await panel.renderScad(execPath, panel.documentUri);

            return {
                content: [new vscode.LanguageModelTextPart('Render triggered successfully. The preview has been updated.')]
            };
        }
    }));

    // 2. Tool to capture the preview screenshot
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_capture_preview', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>, token: vscode.CancellationToken) {
            const panel = PreviewPanel.currentPanel;
            if (!panel) {
                return {
                    content: [new vscode.LanguageModelTextPart('No active SCAD preview panel found.')]
                };
            }

            const dataUrl = await panel.capturePreview();
            if (!dataUrl) {
                return {
                    content: [new vscode.LanguageModelTextPart('Failed to capture preview image (panel might be hidden).')]
                };
            }

            // Return the image part.
            // Note: The dataUrl is "data:image/png;base64,..."
            const base64 = dataUrl.split(',')[1];
            const buffer = Buffer.from(base64, 'base64');

            // Warn and skip if the captured image would bloat the model context.
            const MAX_PREVIEW_BYTES = 512 * 1024; // 512 KB
            if (buffer.length > MAX_PREVIEW_BYTES) {
                return {
                    content: [new vscode.LanguageModelTextPart(
                        `Preview captured but the image is too large (${Math.round(buffer.length / 1024)} KB) to send inline. ` +
                        `Resize the VS Code panel to make it smaller, then try again.`
                    )]
                };
            }

            const imgPart = makeImagePart(buffer, 'image/png');
            if (imgPart !== null) {
                return {
                    content: [
                        new vscode.LanguageModelTextPart('Preview captured.'),
                        imgPart
                    ]
                };
            } else {
                // Neither LanguageModelDataPart nor LanguageModelImagePart is available
                return {
                    content: [
                        new vscode.LanguageModelTextPart('Preview captured (image data available but inline image API is not supported in this VS Code version).')
                    ]
                };
            }        }
    }));

    // 3. Tool to update code and render
    //
    // Uses vscode.workspace.applyEdit so changes appear in the editor's change
    // gutter (blue bars), are fully undoable, and show up in git diff — the same
    // mechanism VS Code's own AI agents use for tracked edits.
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_update_code', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { code: string };
            const panel = PreviewPanel.currentPanel;
            if (!panel) {
                return {
                    content: [new vscode.LanguageModelTextPart('No active SCAD preview panel found. Please open a preview first.')]
                };
            }

            const documentUri = panel.documentUri;

            // Open the document so VS Code is tracking it, then apply the edit
            // through the text document model for proper change tracking.
            let document: vscode.TextDocument;
            try {
                document = await vscode.workspace.openTextDocument(documentUri);
            } catch (e: any) {
                return {
                    content: [new vscode.LanguageModelTextPart(`Failed to open document: ${e.message}`)]
                };
            }

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );

            const edit = new vscode.WorkspaceEdit();
            edit.replace(documentUri, fullRange, input.code);

            const applied = await vscode.workspace.applyEdit(edit);
            if (!applied) {
                return {
                    content: [new vscode.LanguageModelTextPart('Failed to apply edit to document.')]
                };
            }

            // Do NOT save — leave the document dirty so the user can review the
            // diff (blue change bars in the gutter), then press Ctrl+S to accept
            // or Ctrl+Z to undo and reject the AI's changes.

            // Render from the in-memory code directly so the preview updates
            // immediately without requiring a save first.
            const result = await panel.renderScadContent(input.code);
            panel.reveal();

            if (result.success) {
                return {
                    content: [new vscode.LanguageModelTextPart(
                        'Code updated. The preview shows the new result. ' +
                        'Review the changes (blue bars in the gutter), then Save (Ctrl+S) to accept or Undo (Ctrl+Z) to reject.'
                    )]
                };
            } else {
                return {
                    content: [new vscode.LanguageModelTextPart(
                        `Code applied to editor but rendering failed: ${result.error}\n` +
                        'Save (Ctrl+S) to accept or Undo (Ctrl+Z) to reject.'
                    )]
                };
            }
        }
    }));
    
    // 4. Tool to read the content of a SCAD file in the workspace
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_read_file', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { path?: string };

            let targetUri: vscode.Uri;

            if (input?.path) {
                const resolved = resolveWorkspacePath(input.path);
                if (!resolved || !resolved.endsWith('.scad')) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(`Error: Can only read .scad files within the current workspace. Provided path: ${input.path}`)
                    ]);
                }
                targetUri = vscode.Uri.file(resolved);
            } else {
                const panel = PreviewPanel.currentPanel;
                if (!panel) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('No active SCAD preview panel found and no path provided.')
                    ]);
                }
                targetUri = panel.documentUri;
            }

            try {
                const document = await vscode.workspace.openTextDocument(targetUri);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(document.getText())
                ]);
            } catch (e: any) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Failed to read file: ${e.message}`)
                ]);
            }
        }
    }));

    // 5. Tool to read an image file from the workspace
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_read_image', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { path: string };
            const resolved = resolveWorkspacePath(input.path);
            if (!resolved || !IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Error: Can only read image files (png, jpg, jpeg, gif, webp, bmp) within the current workspace. Provided path: ${input.path}`
                    )
                ]);
            }
            try {
                const uri = vscode.Uri.file(resolved);
                const bytes = await vscode.workspace.fs.readFile(uri);

                // Guard against images that are too large for the model context window.
                // Full-sized photos easily exceed token limits when passed inline.
                const MAX_IMAGE_BYTES = 512 * 1024; // 512 KB
                if (bytes.length > MAX_IMAGE_BYTES) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            `Image '${input.path}' is ${Math.round(bytes.length / 1024)} KB, which exceeds the 512 KB limit ` +
                            `for inline image processing (to stay within model token limits). ` +
                            `Please resize it to under 512 KB, or describe the key visual features you want to replicate in text ` +
                            `(shape, proportions, notable details).`
                        )
                    ]);
                }

                const buffer = Buffer.from(bytes);
                const mime = IMAGE_MIME[path.extname(resolved).toLowerCase()] ?? 'image/png';

                const imgPart = makeImagePart(buffer, mime);
                if (imgPart !== null) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(`Image loaded from ${input.path}.`),
                        imgPart
                    ]);
                } else {
                    // No image API available — returning base64 would be enormous.
                    // Give the agent a message it should relay verbatim to the user.
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart(
                            `TOOL ERROR: Cannot display image '${input.path}' (${Math.round(buffer.length / 1024)} KB). ` +
                            `Reason: The inline image API (LanguageModelDataPart / LanguageModelImagePart) is not available in this VS Code build. ` +
                            `Please update VS Code to the latest stable version and reload the extension.`
                        )
                    ]);
                }
            } catch (e: any) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Failed to read image: ${e.message}`)
                ]);
            }
        }
    }));

    // 6. Tool to write (create or overwrite) a SCAD file and open its preview
    //
    // This is the primary way for agents to create a new file from scratch.
    // Unlike scad_renderer_update_code, it does NOT require an existing preview
    // panel — it creates the file, opens the editor tab, and launches the preview.
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_write_file', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { path: string; code: string };

            if (!input?.path || !input.path.endsWith('.scad')) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Error: path must be provided and must end with .scad')
                ]);
            }
            if (typeof input?.code !== 'string') {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Error: code must be provided as a string.')
                ]);
            }

            // Resolve the path: accept absolute paths that exist within a workspace
            // folder, or workspace-relative paths.
            let resolvedPath = resolveWorkspacePath(input.path);
            if (!resolvedPath) {
                // As a last resort, if the path is absolute but outside the known
                // workspace roots (e.g. user opened a different folder), treat any
                // absolute .scad path as valid — the OS write will catch permission errors.
                if (path.isAbsolute(input.path)) {
                    resolvedPath = input.path;
                } else {
                    // Relative path with no workspace open
                    const folders = vscode.workspace.workspaceFolders;
                    if (!folders || folders.length === 0) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart('Error: No workspace folder is open. Please open a folder first, or provide an absolute path.')
                        ]);
                    }
                    resolvedPath = path.join(folders[0].uri.fsPath, input.path);
                }
            }

            try {
                const uri = vscode.Uri.file(resolvedPath);

                // Ensure parent directory exists
                const parentUri = vscode.Uri.file(path.dirname(resolvedPath));
                await vscode.workspace.fs.createDirectory(parentUri);

                // Write the file
                await vscode.workspace.fs.writeFile(uri, Buffer.from(input.code, 'utf-8'));

                // Open in editor
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

                // Launch or refresh the preview panel
                await vscode.commands.executeCommand('scad-renderer.preview', uri);

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `File written and preview opened: ${resolvedPath}\n` +
                        `The 3D preview panel is now active. You can call scad_renderer_update_code to make further changes, ` +
                        `or scad_renderer_capture_preview to inspect the rendered result.`
                    )
                ]);
            } catch (e: any) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Failed to write file: ${e.message}`)
                ]);
            }
        }
    }));

    // 7. Tool to open a file in the editor
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_open_file', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { path: string };
            if (!isValidScadPath(input.path)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Error: Can only open .scad files within the current workspace. Provided path: ${input.path}`)
                ]);
            }
            try {
                const uri = vscode.Uri.file(input.path);
                await vscode.window.showTextDocument(uri);
                return {
                    content: [new vscode.LanguageModelTextPart(`File ${input.path} opened in editor.`)]
                };
            } catch (e: any) {
                return {
                    content: [new vscode.LanguageModelTextPart(`Failed to open file: ${e.message}`)]
                };
            }
        }
    }));
}

import * as vscode from 'vscode';
import * as path from 'path';
import { PreviewPanel } from '../PreviewPanel';

function isValidScadPath(filePath: string): boolean {
    if (!filePath.endsWith('.scad')) {
        return false;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return false;
    }
    return workspaceFolders.some(folder =>
        filePath.startsWith(folder.uri.fsPath + path.sep)
    );
}

// Define the tools in package.json as well for chat discovery
export function registerScadTools(context: vscode.ExtensionContext) {
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

            if (typeof (vscode as any).LanguageModelImagePart !== 'undefined') {
                return {
                    content: [
                        new vscode.LanguageModelTextPart('Preview captured.'),
                        new (vscode as any).LanguageModelImagePart(buffer, 'image/png')
                    ]
                };
            } else {
                // LanguageModelImagePart is not available in this VS Code version — return text only
                return {
                    content: [
                        new vscode.LanguageModelTextPart('Preview captured (image data available but LanguageModelImagePart is not supported in this VS Code version).')
                    ]
                };
            }
        }
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
    
    // 4. Tool to open a file in the editor
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

import * as vscode from 'vscode';
import { PreviewPanel } from '../PreviewPanel';

// Define the tools in package.json as well for chat discovery
export function registerScadTools(context: vscode.ExtensionContext) {
    // 1. Tool to trigger a render
    // @ts-ignore
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_render', {
        async invoke(options: any, token: vscode.CancellationToken) {
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
    // @ts-ignore
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_capture_preview', {
        async invoke(options: any, token: vscode.CancellationToken) {
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

            return { 
                content: [
                    new vscode.LanguageModelTextPart('Preview captured.'),
                    new (vscode as any).LanguageModelImagePart(buffer, 'image/png')
                ] 
            };
        }
    }));

    // 3. Tool to update code and render
    // @ts-ignore
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_update_code', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { code: string };
            const panel = PreviewPanel.currentPanel;
            if (!panel) {
                return {
                    content: [new vscode.LanguageModelTextPart('No active SCAD preview panel found. Please open a preview first.')]
                };
            }

            const result = await panel.renderScadContent(input.code);

            // Re-reveal the panel to make sure user sees the result
            panel.reveal();

            if (result.success) {
                return { 
                    content: [new vscode.LanguageModelTextPart('Code rendered in preview successfully.')] 
                };
            } else {
                return { 
                    content: [new vscode.LanguageModelTextPart(`Rendering failed with error: ${result.error}`)] 
                };
            }
        }
    }));
    
    // 4. Tool to open a file in the editor
    // @ts-ignore
    context.subscriptions.push(vscode.lm.registerTool('scad_renderer_open_file', {
        async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
            const input = options.input as { path: string };
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

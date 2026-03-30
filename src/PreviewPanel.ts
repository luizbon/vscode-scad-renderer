import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { ScadRunner } from './scadRunner';
import type { ExtensionToWebviewMessage, ParameterValue, WebviewToExtensionMessage } from './shared/messages';

export class PreviewPanel {
    public static panels: Map<string, PreviewPanel> = new Map();
    public static readonly viewType = 'scadRenderer';

    public static get currentPanel(): PreviewPanel | undefined {
        const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (activeUri) {
            const panel = PreviewPanel.panels.get(activeUri);
            if (panel) {
                return panel;
            }
        }
        const first = PreviewPanel.panels.values().next();
        return first.done ? undefined : first.value;
    }

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    public readonly documentUri: vscode.Uri;
    public execPath?: string;
    private _parameterOverrides: Record<string, ParameterValue> = {};

    public get parameterOverrides(): Readonly<Record<string, ParameterValue>> {
        return this._parameterOverrides;
    }
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(extensionUri: vscode.Uri, execPath: string, documentUri: vscode.Uri) {
        const key = documentUri.toString();
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        const existingPanel = PreviewPanel.panels.get(key);
        if (existingPanel) {
            existingPanel._panel.reveal(column);
            existingPanel.renderScad(execPath, documentUri);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            PreviewPanel.viewType,
            'SCAD Preview',
            column,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
            }
        );

        const preview = new PreviewPanel(panel, extensionUri, documentUri);
        PreviewPanel.panels.set(key, preview);
        preview.renderScad(execPath, documentUri);
    }

    public reveal(viewColumn?: vscode.ViewColumn) {
        this._panel.reveal(viewColumn);
    }

    private _captureResolver?: (image: string) => void;

    public async capturePreview(): Promise<string> {
        return new Promise<string>((resolve) => {
            if (!this._panel.visible) {
                resolve("");
                return;
            }
            const timeout = setTimeout(() => {
                this._captureResolver = undefined;
                resolve("");
            }, 5000);
            this._captureResolver = (image: string) => {
                clearTimeout(timeout);
                resolve(image);
            };
            this._panel.webview.postMessage({ command: 'capturePreview' } satisfies ExtensionToWebviewMessage);
        });
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, documentUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.documentUri = documentUri;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => {
            switch (message.command) {
                case 'parameterChanged':
                    this._parameterOverrides = { ...this._parameterOverrides, [message.name]: message.value };
                    if (this.execPath) {
                        this.renderScad(this.execPath, this.documentUri);
                    }
                    return;
                case 'previewCaptured':
                    if (this._captureResolver) {
                        this._captureResolver(message.data);
                        this._captureResolver = undefined;
                    }
                    return;
            }
        }, null, this._disposables);
    }

    public lastLogs: string | undefined;
    private static outputChannel = vscode.window.createOutputChannel('SCAD Renderer');

    public async updateCodeAndRender(code: string): Promise<{ success: boolean; error?: string }> {
        if (!this.documentUri) {
            return { success: false, error: "No active document." };
        }
        
        try {
            await vscode.workspace.fs.writeFile(this.documentUri, Buffer.from(code, 'utf-8'));
            return await this.renderScad(this.execPath!, this.documentUri);
        } catch (e: any) {
            return { success: false, error: e.message };
        }
    }

    /** Renders the provided OpenSCAD code without modifying the primary document. */
    public async renderScadContent(code: string): Promise<{ success: boolean; error?: string }> {
        if (!this.execPath) {
            return { success: false, error: "OpenSCAD executable path not configured." };
        }

        const tmpDir = os.tmpdir();
        const tmpFile = path.join(tmpDir, `preview_${Date.now()}.scad`);
        
        try {
            await fs.promises.writeFile(tmpFile, code, 'utf-8');
            const runner = new ScadRunner(this.execPath);
            const data = await runner.render(tmpFile, this._parameterOverrides);
            
            this._panel.webview.postMessage({
                command: 'updateSTL',
                data: data.stlBuffer,
                parameters: data.parameters,
                overrides: this._parameterOverrides
            } satisfies ExtensionToWebviewMessage);
            this.lastLogs = data.stderr || data.stdout;
            return { success: true };
        } catch (err: any) {
            const errMsg = err?.message ?? String(err);
            this._panel.webview.postMessage({ command: 'error', message: errMsg } satisfies ExtensionToWebviewMessage);
            this.lastLogs = errMsg;
            return { success: false, error: errMsg };
        } finally {
            try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
        }
    }

    public async renderScad(execPath: string, documentUri: vscode.Uri): Promise<{ success: boolean; error?: string }> {
        this.execPath = execPath;

        try {
            const runner = new ScadRunner(execPath);
            const data = await runner.render(documentUri.fsPath, this._parameterOverrides);
            
            this._panel.webview.postMessage({
                command: 'updateSTL',
                data: data.stlBuffer,
                parameters: data.parameters,
                overrides: this._parameterOverrides
            } satisfies ExtensionToWebviewMessage);
            this.lastLogs = data.stderr || data.stdout;
            return { success: true };
        } catch (err: any) {
            const errMsg = err?.message ?? String(err);
            console.error('Rendering failed:', errMsg);
            this._panel.webview.postMessage({ command: 'error', message: errMsg } satisfies ExtensionToWebviewMessage);
            this.lastLogs = errMsg;
            
            PreviewPanel.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Render Error for ${documentUri.fsPath}:`);
            PreviewPanel.outputChannel.appendLine(errMsg);
            
            return { success: false, error: errMsg };
        }
    }

    public dispose() {
        PreviewPanel.panels.delete(this.documentUri.toString());
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.title = `Preview: ${path.basename(this.documentUri.fsPath)}`;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!-- Content security policy -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SCAD Preview</title>
                <style>
                    body, html {
                        margin: 0; padding: 0; height: 100vh; width: 100vw; overflow: hidden;
                        background-color: var(--vscode-editor-background);
                    }
                    canvas {
                        display: block; width: 100%; height: 100%;
                    }
                </style>
            </head>
            <body>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

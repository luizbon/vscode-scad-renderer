import type { ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/messages';
import type { Viewer } from './viewer';
import type { Customizer } from './customizer';

export class MessageHandler {
    private vscode: { postMessage(message: WebviewToExtensionMessage): void };
    private viewer: Viewer;
    private customizer: Customizer;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(
        vscodeApi: { postMessage(message: WebviewToExtensionMessage): void },
        viewer: Viewer,
        customizer: Customizer
    ) {
        this.vscode = vscodeApi;
        this.viewer = viewer;
        this.customizer = customizer;

        window.addEventListener('message', (event: MessageEvent) => {
            this.handleMessage(event.data as ExtensionToWebviewMessage);
        });
    }

    private handleMessage(message: ExtensionToWebviewMessage) {
        switch (message.command) {
            case 'updateSTL': {
                const arr = message.data as ArrayBuffer;
                if (arr && arr.byteLength > 0) {
                    this.viewer.loadStl(arr);
                }
                if (message.parameters) {
                    this.customizer.render(message.parameters, message.overrides ?? {});
                }
                break;
            }
            case 'capturePreview': {
                const dataUrl = this.viewer.captureFrame();
                this.vscode.postMessage({ command: 'previewCaptured', data: dataUrl });
                break;
            }
            case 'error': {
                showError(message.message);
                break;
            }
        }
    }

    public sendParameterChanged(name: string, value: unknown, instant: boolean) {
        if (this.debounceTimer) { clearTimeout(this.debounceTimer); }

        const send = () => {
            this.vscode.postMessage({ command: 'parameterChanged', name, value: value as import('../shared/messages').ParameterValue });
        };

        if (instant) {
            send();
        } else {
            this.debounceTimer = setTimeout(send, 400); // 400ms debounce
        }
    }
}

function showError(msg: string) {
    let overlay = document.getElementById('error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'error-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '20px';
        overlay.style.left = '20px';
        overlay.style.right = '20px';
        overlay.style.background = 'rgba(255, 68, 68, 0.9)';
        overlay.style.color = 'white';
        overlay.style.padding = '15px';
        overlay.style.borderRadius = '5px';
        overlay.style.zIndex = '1000';
        overlay.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
        overlay.style.fontSize = '13px';
        overlay.style.whiteSpace = 'pre-wrap';
        overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';

        const close = document.createElement('div');
        close.innerHTML = '&#x2715;';
        close.style.position = 'absolute';
        close.style.top = '5px';
        close.style.right = '8px';
        close.style.cursor = 'pointer';
        close.onclick = () => { if (overlay) { overlay.style.display = 'none'; } };
        overlay.appendChild(close);

        const title = document.createElement('div');
        title.textContent = 'OpenSCAD Render Error';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '8px';
        title.style.borderBottom = '1px solid rgba(255,255,255,0.3)';
        title.style.paddingBottom = '5px';
        overlay.appendChild(title);

        const content = document.createElement('div');
        content.id = 'error-content';
        overlay.appendChild(content);

        document.body.appendChild(overlay);
    }

    const content = document.getElementById('error-content');
    if (content) { content.textContent = msg; }
    overlay.style.display = 'block';
}

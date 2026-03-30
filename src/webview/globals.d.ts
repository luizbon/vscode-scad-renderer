/**
 * Ambient declaration for the VS Code webview API injected at runtime.
 * @see https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-an-extension-to-a-webview
 */
declare function acquireVsCodeApi(): {
    postMessage(message: import('../shared/messages').WebviewToExtensionMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
};

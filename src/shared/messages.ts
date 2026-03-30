import type { ParameterValue } from '../PreviewPanel';

export type { ParameterValue };

export interface ScadParameter {
    name: string;
    caption?: string;
    type: 'boolean' | 'number' | 'string';
    initial: ParameterValue;
    options?: Array<{ value: ParameterValue; name?: string }>;
    min?: number;
    max?: number;
    step?: number;
}

// Messages sent from the extension host to the webview
export type ExtensionToWebviewMessage =
    | { command: 'updateSTL'; data: ArrayBuffer; parameters?: ScadParameter[]; overrides?: Record<string, ParameterValue> }
    | { command: 'capturePreview' }
    | { command: 'error'; message: string };

// Messages sent from the webview to the extension host
export type WebviewToExtensionMessage =
    | { command: 'ready' }
    | { command: 'previewCaptured'; data: string }
    | { command: 'parameterChanged'; name: string; value: ParameterValue };

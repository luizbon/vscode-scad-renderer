export type ParameterValue = string | number | boolean;

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
    | { command: 'previewCaptured'; data: string }
    | { command: 'parameterChanged'; name: string; value: ParameterValue }
    | { command: 'renderModeChanged'; mode: 'solid' | 'wireframe' | 'xray' }
    | { command: 'cameraProjectionChanged'; projection: 'perspective' | 'orthographic' };

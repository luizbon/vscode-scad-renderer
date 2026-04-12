/**
 * Minimal vscode mock for tests running outside the VS Code host.
 *
 * Only the surface used by runner.ts, messageBuilders.ts and orchestratorLoop.ts
 * is implemented.
 */

export class LanguageModelTextPart {
    constructor(public value: string) { }
}

export class LanguageModelImagePart {
    constructor(public data: Buffer | Uint8Array, public mimeType: string) { }
}

export class LanguageModelDataPart {
    static image(data: Buffer | Uint8Array, mimeType: string): LanguageModelDataPart {
        return new LanguageModelDataPart(data, mimeType);
    }
    constructor(public data: Buffer | Uint8Array, public mimeType: string) { }
}

export class LanguageModelToolCallPart {
    constructor(
        public callId: string,
        public name: string,
        public input: unknown
    ) { }
}

export class LanguageModelToolResultPart {
    constructor(
        public callId: string,
        public content: unknown[]
    ) { }
}

export class LanguageModelChatMessage {
    static User(content: string | unknown[]): LanguageModelChatMessage {
        return new LanguageModelChatMessage('user', content);
    }
    static Assistant(content: string | unknown[]): LanguageModelChatMessage {
        return new LanguageModelChatMessage('assistant', content);
    }
    constructor(
        public role: 'user' | 'assistant',
        public content: string | unknown[]
    ) { }
}

export interface Uri {
    fsPath: string;
}

export function makeUri(fsPath: string): Uri {
    return { fsPath };
}

/** Minimal CancellationToken that is never cancelled. */
export const notCancelled = { isCancellationRequested: false };

/** Capture all markdown / progress calls for assertions. */
export function makeChatResponseStream() {
    const markdownChunks: string[] = [];
    const progressMessages: string[] = [];
    return {
        markdown(text: string) { markdownChunks.push(text); },
        progress(msg: string) { progressMessages.push(msg); },
        markdownChunks,
        progressMessages,
    };
}

export class LanguageModelToolResult {
    constructor(public content: unknown[]) { }
}

/** The full vscode namespace mock — register with require() interception. */
export const vscodeMock = {
    LanguageModelTextPart,
    LanguageModelImagePart,
    LanguageModelDataPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    LanguageModelToolResult,
    Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file', toString: () => 'file://' + p }),
        joinPath: (base: { fsPath: string }, ...segs: string[]) => {
            const nodePath: typeof import('path') = require('path');
            const joined = nodePath.join(base.fsPath, ...segs);
            return { fsPath: joined, scheme: 'file', toString: () => 'file://' + joined };
        },
    },
    ViewColumn: { One: 1, Two: 2, Three: 3 } as Record<string, number>,
    workspace: {
        workspaceFolders: null as null | Array<{ uri: { fsPath: string } }>,
        fs: {
            createDirectory: async (_uri: unknown) => { },
            writeFile: async (_uri: unknown, _data: unknown) => { },
            readFile: async (_uri: unknown) => Buffer.alloc(0),
        },
        openTextDocument: async (uri: unknown) => ({ uri, getText: () => '' }),
        activeTextEditor: undefined as undefined,
    },
    window: {
        activeTextEditor: undefined as undefined,
        showTextDocument: async (_doc: unknown) => { },
        createOutputChannel: (_name: string) => ({
            appendLine: (_line: string) => { },
            append: (_text: string) => { },
            show: () => { },
            hide: () => { },
            clear: () => { },
            dispose: () => { },
        }),
    },
    commands: {
        executeCommand: async (..._args: unknown[]) => { },
    },
    lm: {
        tools: [] as any[],
        invokeTool: async (_name: string, _opts: unknown, _token: unknown) => ({
            content: [] as unknown[],
        }),
        registerTool: (_name: string, _handler: unknown) => ({ dispose: () => { } }),
    },
};

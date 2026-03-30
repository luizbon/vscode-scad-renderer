/**
 * Minimal vscode mock for tests running outside the VS Code host.
 *
 * Only the surface used by runner.ts, messageBuilders.ts and orchestratorLoop.ts
 * is implemented.
 */

export class LanguageModelTextPart {
    constructor(public value: string) { }
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

/** The full vscode namespace mock — register with require() interception. */
export const vscodeMock = {
    LanguageModelTextPart,
    LanguageModelToolCallPart,
    LanguageModelToolResultPart,
    LanguageModelChatMessage,
    lm: {
        tools: [] as any[],
        invokeTool: async (_name: string, _opts: unknown, _token: unknown) => ({
            content: [],
        }),
    },
};

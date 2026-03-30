/**
 * Shared test helpers for runner and orchestratorLoop tests.
 */

export const notCancelled = { isCancellationRequested: false };

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

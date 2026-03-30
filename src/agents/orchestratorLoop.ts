import * as vscode from 'vscode';
import { runAgent } from './runner';
import {
    parseOrchestratorDecision,
    stripSentinelBlocks,
    OrchestratorContext,
    OrchestratorDecision,
    ChangeLogEntry,
} from './reportParsers';

/**
 * A no-op ChatResponseStream that silently discards all output.
 * Used for internal agent-to-agent communication so it doesn't leak into the user chat.
 */
export function createSilentStream(): vscode.ChatResponseStream {
    const noop = () => {};
    return {
        markdown: noop,
        anchor: noop,
        button: noop,
        filetree: noop,
        progress: noop,
        reference: noop,
        push: noop,
    } as unknown as vscode.ChatResponseStream;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface OrchestratorLoopConfig {
    model: vscode.LanguageModelChat;
    context: OrchestratorContext;
    response: vscode.ChatResponseStream;
    token: vscode.CancellationToken;
    toolInvocationToken?: vscode.ChatParticipantToolToken;
    /** Maximum loop iterations (default: 10). */
    maxIterations?: number;
    /** Per-action handler callbacks. Each receives the brief and the current change log. */
    handlers: {
        CALL_CODER?: (brief: string, changeLog: ChangeLogEntry[]) => Promise<string>;
        CALL_REVIEWER?: (brief: string, changeLog: ChangeLogEntry[]) => Promise<string>;
        CALL_QA?: (brief: string, changeLog: ChangeLogEntry[]) => Promise<string>;
        CALL_DEBUGGER?: (brief: string, changeLog: ChangeLogEntry[]) => Promise<string>;
        CALL_DESIGNER?: (brief: string, changeLog: ChangeLogEntry[]) => Promise<string>;
    };
    /**
     * Called at the start of each iteration to rebuild orchestrator messages
     * from the *current* context (code, reports, trigger may have changed).
     */
    buildOrchestratorMessages: (context: OrchestratorContext) => vscode.LanguageModelChatMessage[];
    /**
     * Called after each successful handler execution so the caller can update
     * its mutable context before the next iteration.
     */
    onAfterHandler?: (decision: OrchestratorDecision, iteration: number) => Promise<OrchestratorContext>;
}

export interface OrchestratorLoopResult {
    iterations: number;
    finalDecision: OrchestratorDecision | undefined;
    hitMaxIterations: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core loop
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generic orchestrator dispatch loop shared by the /create and /debug flows.
 *
 * Each iteration:
 *  1. Rebuilds orchestrator messages via `buildOrchestratorMessages`.
 *  2. Runs the orchestrator agent to get the next decision.
 *  3. Dispatches to the matching `handlers` callback.
 *  4. Optionally updates context via `onAfterHandler`.
 *  5. Breaks on DONE, UNKNOWN, cancellation, or max iterations.
 */
export async function runOrchestratorLoop(
    config: OrchestratorLoopConfig
): Promise<OrchestratorLoopResult> {
    const {
        model,
        response,
        token,
        handlers,
        maxIterations = 10,
    } = config;

    let currentContext = config.context;
    let iterations = 0;
    let finalDecision: OrchestratorDecision | undefined;
    const changeLog: ChangeLogEntry[] = [...(config.context.changeLog ?? [])];

    while (!token.isCancellationRequested && iterations < maxIterations) {
        iterations++;

        response.progress(`🛸 Orchestrator deciding… (step ${iterations})`);

        const messages = config.buildOrchestratorMessages({ ...currentContext, changeLog });
        const raw = await runAgent(model, messages, createSilentStream(), token, undefined, '');
        const decision = parseOrchestratorDecision(raw);

        const visibleText = stripSentinelBlocks(raw);
        if (visibleText) {
            response.markdown(visibleText + '\n\n');
        }
        finalDecision = decision;

        if (token.isCancellationRequested) { break; }

        if (decision.action === 'DONE') {
            break;
        }
        if (decision.action === 'UNKNOWN') {
            response.markdown('⚠️ Orchestrator could not decide — halting session.\n\n');
            break;
        }

        const brief = decision.brief ?? currentContext.designBrief;
        const handler = handlers[decision.action];

        if (!handler) {
            response.markdown(`⚠️ No handler registered for orchestrator action: ${decision.action}. Stopping.`);
            break;
        }

        const handlerSummary = await handler(brief, changeLog);

        // Record this step in the shared change log
        changeLog.push({
            step: iterations,
            agent: decision.action,
            summary: handlerSummary || brief,
            outcome: 'success',
        });

        if (config.onAfterHandler) {
            currentContext = await config.onAfterHandler(decision, iterations);
        }
    }

    const hitMaxIterations = iterations >= maxIterations && finalDecision?.action !== 'DONE';
    if (hitMaxIterations) {
        response.markdown('⚠️ Safety cap reached — session ended after max iterations.\n\n');
    }

    return { iterations, finalDecision, hitMaxIterations };
}

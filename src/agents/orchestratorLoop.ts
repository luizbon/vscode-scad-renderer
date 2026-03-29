import * as vscode from 'vscode';
import { runAgent } from './runner';
import {
    parseOrchestratorDecision,
    OrchestratorContext,
    OrchestratorDecision,
} from './reportParsers';

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
    /** Per-action handler callbacks.  Each receives the brief from the decision. */
    handlers: {
        CALL_CODER?: (brief: string) => Promise<void>;
        CALL_REVIEWER?: (brief: string) => Promise<void>;
        CALL_QA?: (brief: string) => Promise<void>;
        CALL_DEBUGGER?: (brief: string) => Promise<void>;
        CALL_DESIGNER?: (brief: string) => Promise<void>;
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

    while (!token.isCancellationRequested && iterations < maxIterations) {
        iterations++;

        response.markdown(`\n\n---\n## 🛸 Orchestrator (step ${iterations})\n\n`);

        const messages = config.buildOrchestratorMessages(currentContext);
        const raw = await runAgent(model, messages, response, token, undefined, '🛸 Orchestrator is deciding…');
        const decision = parseOrchestratorDecision(raw);
        finalDecision = decision;

        if (token.isCancellationRequested) { break; }

        if (decision.action === 'DONE') {
            response.markdown('\n\n✅ **Orchestrator declared the session complete.**\n\n');
            break;
        }
        if (decision.action === 'UNKNOWN') {
            response.markdown('\n\n⚠️ Orchestrator could not decide — halting session.\n\n');
            break;
        }

        const brief = decision.brief ?? currentContext.designBrief;
        const handler = handlers[decision.action];

        if (!handler) {
            response.markdown(`\n\n⚠️ No handler registered for orchestrator action: ${decision.action}. Stopping.`);
            break;
        }

        await handler(brief);

        if (config.onAfterHandler) {
            currentContext = await config.onAfterHandler(decision, iterations);
        }
    }

    const hitMaxIterations = iterations >= maxIterations && finalDecision?.action !== 'DONE';
    if (hitMaxIterations) {
        response.markdown('\n\n⚠️ Safety cap reached — session ended after max iterations.\n\n');
    }

    return { iterations, finalDecision, hitMaxIterations };
}

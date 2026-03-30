/**
 * Tests for src/agents/orchestratorLoop.ts
 *
 * vscode is provided via the node_modules/vscode mock package.
 * runAgent is patched on the live runnerModule export object.
 */
import { expect } from 'chai';
import { notCancelled, makeChatResponseStream } from './helpers/testHelpers';

const vscode = require('vscode');
const runnerModule = require('../src/agents/runner');
const { runOrchestratorLoop } = require('../src/agents/orchestratorLoop');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDecisionText(action: string, brief?: string): string {
    const lines = ['ORCHESTRATOR_DECISION_START', `Action: ${action}`];
    if (brief) { lines.push(`Brief: ${brief}`); }
    lines.push('ORCHESTRATOR_DECISION_END');
    return lines.join('\n');
}

function makeModel(): any {
    return { sendRequest: async () => ({ stream: (async function* () { })() }) };
}

function baseConfig(overrides: Record<string, any> = {}): any {
    return {
        model: makeModel(),
        context: {
            fileDescription: 'test.scad',
            designBrief: 'Build a box',
            currentCode: '',
            agentReports: [],
            trigger: 'initial',
        },
        response: makeChatResponseStream(),
        token: notCancelled,
        handlers: {},
        buildOrchestratorMessages: (_ctx: any) => [vscode.LanguageModelChatMessage.User('Decide.')],
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runOrchestratorLoop', () => {
    it('terminates immediately on DONE', async () => {
        const orig = runnerModule.runAgent;
        runnerModule.runAgent = async () => makeDecisionText('DONE');
        try {
            const result = await runOrchestratorLoop(baseConfig());
            expect(result.finalDecision?.action).to.equal('DONE');
            expect(result.iterations).to.equal(1);
            expect(result.hitMaxIterations).to.equal(false);
        } finally {
            runnerModule.runAgent = orig;
        }
    });

    it('terminates on UNKNOWN with a warning in the stream', async () => {
        const orig = runnerModule.runAgent;
        runnerModule.runAgent = async () => makeDecisionText('UNKNOWN');
        const stream = makeChatResponseStream();
        try {
            const result = await runOrchestratorLoop(baseConfig({ response: stream }));
            expect(result.finalDecision?.action).to.equal('UNKNOWN');
            expect(stream.markdownChunks.join('')).to.include('could not decide');
        } finally {
            runnerModule.runAgent = orig;
        }
    });

    it('hits maxIterations cap and sets hitMaxIterations=true', async () => {
        const orig = runnerModule.runAgent;
        runnerModule.runAgent = async () => makeDecisionText('CALL_CODER', 'keep going');
        const stream = makeChatResponseStream();
        try {
            const result = await runOrchestratorLoop(baseConfig({
                response: stream,
                maxIterations: 3,
                handlers: {
                    CALL_CODER: async () => { /* no-op */ },
                },
            }));
            expect(result.hitMaxIterations).to.equal(true);
            expect(result.iterations).to.equal(3);
            expect(stream.markdownChunks.join('')).to.include('Safety cap');
        } finally {
            runnerModule.runAgent = orig;
        }
    });

    it('calls the correct handler based on the decision action', async () => {
        const orig = runnerModule.runAgent;
        let call = 0;
        runnerModule.runAgent = async () => {
            call++;
            return call === 1 ? makeDecisionText('CALL_CODER', 'add a hole') : makeDecisionText('DONE');
        };
        let coderBrief = '';
        try {
            const result = await runOrchestratorLoop(baseConfig({
                handlers: {
                    CALL_CODER: async (brief: string) => { coderBrief = brief; },
                },
            }));
            expect(coderBrief).to.equal('add a hole');
            expect(result.finalDecision?.action).to.equal('DONE');
        } finally {
            runnerModule.runAgent = orig;
        }
    });

    it('stops with warning when no handler is registered for the action', async () => {
        const orig = runnerModule.runAgent;
        runnerModule.runAgent = async () => makeDecisionText('CALL_REVIEWER');
        const stream = makeChatResponseStream();
        try {
            const result = await runOrchestratorLoop(baseConfig({
                response: stream,
                handlers: {},
            }));
            expect(stream.markdownChunks.join('')).to.include('No handler');
            expect(result.iterations).to.equal(1);
        } finally {
            runnerModule.runAgent = orig;
        }
    });

    it('calls onAfterHandler and updates context between iterations', async () => {
        const orig = runnerModule.runAgent;
        let call = 0;
        runnerModule.runAgent = async () => {
            call++;
            return call === 1 ? makeDecisionText('CALL_CODER', 'step1') : makeDecisionText('DONE');
        };
        let contextSeenInSecondIter: any = null;
        try {
            const result = await runOrchestratorLoop(baseConfig({
                handlers: {
                    CALL_CODER: async () => { /* no-op */ },
                },
                buildOrchestratorMessages: (ctx: any) => {
                    contextSeenInSecondIter = ctx;
                    return [vscode.LanguageModelChatMessage.User('Decide.')];
                },
                onAfterHandler: async () => ({
                    fileDescription: 'updated.scad',
                    designBrief: 'updated brief',
                    currentCode: 'sphere(10);',
                    agentReports: ['coder done'],
                    trigger: 'after-coder',
                }),
            }));
            expect(contextSeenInSecondIter?.designBrief).to.equal('updated brief');
            expect(result.finalDecision?.action).to.equal('DONE');
        } finally {
            runnerModule.runAgent = orig;
        }
    });
});

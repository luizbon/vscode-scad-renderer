/**
 * Tests for src/agents/runner.ts
 *
 * vscode is provided via the node_modules/vscode mock package.
 */
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Load vscode mock (node_modules/vscode/index.js) then source module
const vscode = require('vscode');
const runnerModule = require('../src/agents/runner');
const { loadSkill } = runnerModule;

// ── loadSkill ─────────────────────────────────────────────────────────────────

describe('loadSkill', () => {
    let tmpDir: string;

    before(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scad-runner-test-'));
        const skillsDir = path.join(tmpDir, '.agents', 'skills');
        fs.mkdirSync(skillsDir, { recursive: true });
        fs.writeFileSync(path.join(skillsDir, 'test-skill.skill.md'), 'You are a test skill.');
    });

    after(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns skill file contents when file exists', () => {
        const extensionUri = { fsPath: tmpDir };
        const result = loadSkill(extensionUri, 'test-skill');
        expect(result).to.equal('You are a test skill.');
    });

    it('returns empty string when skill file does not exist', () => {
        const extensionUri = { fsPath: tmpDir };
        const result = loadSkill(extensionUri, 'nonexistent-skill');
        expect(result).to.equal('');
    });
});

// ── runAgent ──────────────────────────────────────────────────────────────────

const notCancelled = { isCancellationRequested: false };

function makeChatResponseStream() {
    const markdownChunks: string[] = [];
    const progressMessages: string[] = [];
    return {
        markdown(text: string) { markdownChunks.push(text); },
        progress(msg: string) { progressMessages.push(msg); },
        markdownChunks,
        progressMessages,
    };
}

describe('runAgent', () => {
    function makeTextOnlyModel(text: string) {
        return {
            async sendRequest() {
                const t = text;
                return {
                    stream: (async function* () {
                        yield new vscode.LanguageModelTextPart(t);
                    })(),
                };
            },
        };
    }

    it('accumulates text from a simple text-only response', async () => {
        const model = makeTextOnlyModel('Hello from the model!');
        const stream = makeChatResponseStream();

        const result = await runnerModule.runAgent(model, [], stream, notCancelled);

        expect(result).to.equal('Hello from the model!');
        expect(stream.markdownChunks).to.include('Hello from the model!');
    });

    it('writes progress message when provided', async () => {
        const model = makeTextOnlyModel('ok');
        const stream = makeChatResponseStream();

        await runnerModule.runAgent(model, [], stream, notCancelled, undefined, 'Thinking…');

        expect(stream.progressMessages).to.include('Thinking…');
    });

    it('handles tool-call loop: tool call followed by text response', async () => {
        const toolCall = new vscode.LanguageModelToolCallPart('id-1', 'scad_renderer_render', {});

        let callCount = 0;
        const model = {
            async sendRequest() {
                callCount++;
                if (callCount === 1) {
                    return {
                        stream: (async function* () {
                            yield toolCall;
                        })(),
                    };
                }
                return {
                    stream: (async function* () {
                        yield new vscode.LanguageModelTextPart('Final answer after tool.');
                    })(),
                };
            },
        };

        const originalInvoke = vscode.lm.invokeTool;
        vscode.lm.invokeTool = async () => ({ content: [{ text: 'rendered ok' }] });

        const stream = makeChatResponseStream();
        const result = await runnerModule.runAgent(model, [], stream, notCancelled);

        vscode.lm.invokeTool = originalInvoke;

        expect(result).to.equal('Final answer after tool.');
        expect(callCount).to.equal(2);
    });

    it('returns empty string and writes error markdown when model throws', async () => {
        const model = {
            async sendRequest() {
                throw new Error('LLM unavailable');
            },
        };

        const stream = makeChatResponseStream();
        const result = await runnerModule.runAgent(model, [], stream, notCancelled);

        expect(result).to.equal('');
        const combined = stream.markdownChunks.join('');
        expect(combined).to.include('LLM unavailable');
    });
});

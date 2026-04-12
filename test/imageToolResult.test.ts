/**
 * Tests that verify image content is preserved through the agent tool-call loop.
 *
 * Regression coverage for the bug where `JSON.stringify(result.content)` was
 * used when building the LanguageModelToolResultPart, which silently dropped
 * binary image data and caused the model to receive an unreadable object instead
 * of an actual image.
 */
import { expect } from 'chai';

const vscode = require('vscode');
const runnerModule = require('../src/agents/runner');
import { notCancelled, makeChatResponseStream } from './helpers/testHelpers';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Fake image data (1×1 white pixel, minimal PNG header bytes). */
const FAKE_IMAGE_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function makeImagePart() {
    return new vscode.LanguageModelImagePart(FAKE_IMAGE_BYTES, 'image/png');
}

// ── LanguageModelImagePart mock sanity ───────────────────────────────────────

describe('LanguageModelImagePart (mock)', () => {
    it('is available on the vscode mock', () => {
        expect(vscode.LanguageModelImagePart).to.be.a('function');
    });

    it('stores data and mimeType', () => {
        const part = makeImagePart();
        expect(part.data).to.equal(FAKE_IMAGE_BYTES);
        expect(part.mimeType).to.equal('image/png');
    });
});

// ── runAgent image passthrough ───────────────────────────────────────────────

describe('runAgent — image content passthrough', () => {
    /**
     * Captures every message array that was passed to model.sendRequest so we
     * can inspect what the tool result looked like in the second turn.
     */
    function makeCapturingModel(secondTurnText: string) {
        const capturedRequests: any[][] = [];
        let callCount = 0;

        const model = {
            async sendRequest(messages: any[]) {
                capturedRequests.push(messages);
                callCount++;
                if (callCount === 1) {
                    // First turn: emit a tool call for scad_renderer_read_image
                    return {
                        stream: (async function* () {
                            yield new vscode.LanguageModelToolCallPart(
                                'img-call-1',
                                'scad_renderer_read_image',
                                { path: 'model.jpg' }
                            );
                        })(),
                    };
                }
                // Second turn: plain text answer
                return {
                    stream: (async function* () {
                        yield new vscode.LanguageModelTextPart(secondTurnText);
                    })(),
                };
            },
        };

        return { model, capturedRequests };
    }

    /** Finds the LanguageModelToolResultPart in the messages sent on the second turn. */
    function findToolResultPart(messages: any[]): any {
        for (const msg of messages) {
            const content = Array.isArray(msg.content) ? msg.content : [];
            for (const part of content) {
                if (part instanceof vscode.LanguageModelToolResultPart) {
                    return part;
                }
            }
        }
        return null;
    }

    it('passes image content array directly — not JSON-stringified', async () => {
        const { model, capturedRequests } = makeCapturingModel('Image looks like a miniature.');

        // invokeTool returns both a text part AND an image part (realistic read_image response)
        const originalInvoke = vscode.lm.invokeTool;
        vscode.lm.invokeTool = async (_name: string) => ({
            content: [
                new vscode.LanguageModelTextPart('Image loaded from model.jpg.'),
                makeImagePart(),
            ],
        });

        const stream = makeChatResponseStream();
        const result = await runnerModule.runAgent(model, [], stream, notCancelled);

        vscode.lm.invokeTool = originalInvoke;

        // Model should have been called twice (initial + after tool result)
        expect(capturedRequests).to.have.length(2);

        // Inspect the second request — it must contain a LanguageModelToolResultPart
        const toolResultPart = findToolResultPart(capturedRequests[1]);
        expect(toolResultPart).to.not.be.null;

        // The content array must have 2 items: text + image
        expect(toolResultPart.content).to.have.length(2);

        // First item must be the original LanguageModelTextPart (not a JSON string wrapping it)
        expect(toolResultPart.content[0]).to.be.instanceof(vscode.LanguageModelTextPart);
        expect((toolResultPart.content[0] as any).value).to.equal('Image loaded from model.jpg.');

        // Second item must be the original LanguageModelImagePart with its binary data intact
        expect(toolResultPart.content[1]).to.be.instanceof(vscode.LanguageModelImagePart);
        const imgPart = toolResultPart.content[1] as any;
        expect(imgPart.mimeType).to.equal('image/png');
        expect(imgPart.data).to.equal(FAKE_IMAGE_BYTES);

        // And the agent should have returned the second turn text
        expect(result).to.equal('Image looks like a miniature.');
    });

    it('tool result content is NOT wrapped in a single JSON text string (regression)', async () => {
        const { model, capturedRequests } = makeCapturingModel('ok');

        const originalInvoke = vscode.lm.invokeTool;
        vscode.lm.invokeTool = async () => ({
            content: [
                new vscode.LanguageModelTextPart('some text'),
                makeImagePart(),
            ],
        });

        const stream = makeChatResponseStream();
        await runnerModule.runAgent(model, [], stream, notCancelled);

        vscode.lm.invokeTool = originalInvoke;

        const toolResultPart = findToolResultPart(capturedRequests[1]);
        expect(toolResultPart).to.not.be.null;

        // The old (buggy) behaviour: a single LanguageModelTextPart containing JSON
        // We assert that is NOT the case.
        if (toolResultPart.content.length === 1) {
            const only = toolResultPart.content[0];
            if (only instanceof vscode.LanguageModelTextPart) {
                // If it is a single text part, it must NOT look like JSON serialization
                expect(only.value).to.not.match(/^\[.*\]$/s,
                    'Tool result content must not be JSON-stringified into a single text part');
            }
        }
    });

    it('text-only tool results still work after the fix', async () => {
        const { model, capturedRequests } = makeCapturingModel('Done.');

        const originalInvoke = vscode.lm.invokeTool;
        vscode.lm.invokeTool = async () => ({
            content: [new vscode.LanguageModelTextPart('render ok')],
        });

        const stream = makeChatResponseStream();
        const result = await runnerModule.runAgent(model, [], stream, notCancelled);

        vscode.lm.invokeTool = originalInvoke;

        const toolResultPart = findToolResultPart(capturedRequests[1]);
        expect(toolResultPart).to.not.be.null;
        expect(toolResultPart.content).to.have.length(1);
        expect(toolResultPart.content[0]).to.be.instanceof(vscode.LanguageModelTextPart);
        expect((toolResultPart.content[0] as any).value).to.equal('render ok');
        expect(result).to.equal('Done.');
    });
});

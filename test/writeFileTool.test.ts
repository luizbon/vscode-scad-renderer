/**
 * Unit tests for the scad_renderer_write_file language model tool.
 *
 * Tests run outside the VS Code host. The `vscode` module is intercepted by
 * test/setup.js and replaced with a minimal stub that is extended here with
 * workspace, window, commands, and Uri APIs needed by the tool handler.
 */

import { expect } from 'chai';
import * as path from 'path';

const vscode = require('vscode');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A cancellation token that is never cancelled. */
const notCancelled = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => { } }),
};

/**
 * Absolute base directories derived from __dirname so they are valid absolute
 * paths on any OS (Windows or Unix).
 */
const TMP_DIR = path.resolve(__dirname, '..', '.tmp-test');
const WS_ROOT = path.join(TMP_DIR, 'workspace');

// ── Capture tool handlers when registerScadTools is called ───────────────────

const registeredTools: Record<string, { invoke: Function }> = {};

describe('scad_renderer_write_file', () => {
    before(function () {
        // Stub lm.registerTool so we intercept the write_file handler
        const origRegisterTool = vscode.lm.registerTool;
        vscode.lm.registerTool = (name: string, handler: any) => {
            registeredTools[name] = handler;
            return { dispose: () => { } };
        };

        const fakeContext = { subscriptions: { push: (_: any) => { } } };

        // Load and register all tools; handlers land in registeredTools
        const toolsModule = require('../src/agents/tools');
        toolsModule.registerScadTools(fakeContext);

        vscode.lm.registerTool = origRegisterTool;
    });

    beforeEach(() => {
        // Reset all workspace/window/commands stubs to clean no-op defaults
        vscode.workspace.workspaceFolders = null;
        vscode.workspace.fs.createDirectory = async () => { };
        vscode.workspace.fs.writeFile = async () => { };
        vscode.workspace.openTextDocument = async (uri: any) => ({ uri });
        vscode.window.showTextDocument = async () => { };
        vscode.commands.executeCommand = async () => { };
    });

    // ── Convenience wrappers ──────────────────────────────────────────────────

    async function invokeWriteFile(input: Record<string, any>): Promise<any> {
        return registeredTools['scad_renderer_write_file'].invoke({ input }, notCancelled);
    }

    function getText(result: any): string {
        return result.content[0].value as string;
    }

    // ── Input validation ──────────────────────────────────────────────────────

    describe('input validation', () => {
        it('returns an error when path is missing', async () => {
            const r = await invokeWriteFile({ code: 'cube([10,10,10]);' });
            expect(getText(r)).to.include('path must be provided and must end with .scad');
        });

        it('returns an error when path has no .scad extension', async () => {
            const r = await invokeWriteFile({ path: path.join(TMP_DIR, 'model.stl'), code: 'cube([10,10,10]);' });
            expect(getText(r)).to.include('path must be provided and must end with .scad');
        });

        it('returns an error when code is not a string', async () => {
            const r = await invokeWriteFile({ path: path.join(TMP_DIR, 'model.scad'), code: 42 });
            expect(getText(r)).to.include('code must be provided as a string');
        });

        it('returns an error when path is relative and no workspace folder is open', async () => {
            vscode.workspace.workspaceFolders = null;
            const r = await invokeWriteFile({ path: 'model.scad', code: 'sphere(10);' });
            expect(getText(r)).to.include('No workspace folder is open');
        });
    });

    // ── File writing ──────────────────────────────────────────────────────────

    describe('file writing', () => {
        it('accepts an absolute path and writes the correct content', async () => {
            vscode.workspace.workspaceFolders = null;

            let writtenUri: any = null;
            let writtenData: Buffer | null = null;
            vscode.workspace.fs.writeFile = async (uri: any, data: Buffer) => {
                writtenUri = uri;
                writtenData = data;
            };

            const filePath = path.join(TMP_DIR, 'model.scad');
            const code = 'cube([10,10,10]);';
            const r = await invokeWriteFile({ path: filePath, code });

            expect(getText(r)).to.include('File written and preview opened');
            expect(writtenUri).to.not.be.null;
            expect(writtenData!.toString('utf-8')).to.equal(code);
        });

        it('resolves a workspace-relative path using the first workspace folder', async () => {
            vscode.workspace.workspaceFolders = [{ uri: { fsPath: WS_ROOT } }];

            let writtenToPath: string | null = null;
            vscode.workspace.fs.writeFile = async (uri: any) => {
                writtenToPath = uri.fsPath;
            };

            const r = await invokeWriteFile({ path: 'mymodel.scad', code: 'sphere(r=5);' });

            expect(getText(r)).to.include('File written and preview opened');
            expect(writtenToPath).to.equal(path.join(WS_ROOT, 'mymodel.scad'));
        });

        it('creates parent directories before writing', async () => {
            const filePath = path.join(TMP_DIR, 'subdir', 'model.scad');
            const createdUris: any[] = [];
            vscode.workspace.fs.createDirectory = async (uri: any) => { createdUris.push(uri); };

            await invokeWriteFile({ path: filePath, code: 'cube(5);' });

            expect(createdUris).to.have.length(1);
            expect(createdUris[0].fsPath).to.equal(path.dirname(filePath));
        });

        it('opens the written document in the editor', async () => {
            const filePath = path.join(TMP_DIR, 'model.scad');
            const openedDocs: any[] = [];
            const shownDocs: any[] = [];

            vscode.workspace.openTextDocument = async (uri: any) => {
                const doc = { uri };
                openedDocs.push(doc);
                return doc;
            };
            vscode.window.showTextDocument = async (doc: any) => { shownDocs.push(doc); };

            await invokeWriteFile({ path: filePath, code: 'cylinder(h=10, r=3);' });

            expect(openedDocs).to.have.length(1);
            expect(shownDocs).to.have.length(1);
        });

        it('executes the scad-renderer.preview command with the file URI', async () => {
            const filePath = path.join(TMP_DIR, 'model.scad');
            const commandCalls: any[][] = [];
            vscode.commands.executeCommand = async (...args: any[]) => { commandCalls.push(args); };

            await invokeWriteFile({ path: filePath, code: 'sphere(r=8);' });

            expect(commandCalls).to.have.length(1);
            expect(commandCalls[0][0]).to.equal('scad-renderer.preview');
        });

        it('returns a success message that includes the resolved file path', async () => {
            const filePath = path.join(TMP_DIR, 'model.scad');
            const r = await invokeWriteFile({ path: filePath, code: 'cube(1);' });
            expect(getText(r)).to.include(filePath);
        });
    });

    // ── Error handling ────────────────────────────────────────────────────────

    describe('error handling', () => {
        it('returns a failure message when writeFile throws', async () => {
            vscode.workspace.fs.writeFile = async () => { throw new Error('Permission denied'); };

            const r = await invokeWriteFile({ path: path.join(TMP_DIR, 'readonly.scad'), code: 'cube(1);' });

            expect(getText(r)).to.include('Failed to write file');
            expect(getText(r)).to.include('Permission denied');
        });

        it('returns a failure message when createDirectory throws', async () => {
            vscode.workspace.fs.createDirectory = async () => { throw new Error('Disk full'); };

            const r = await invokeWriteFile({ path: path.join(TMP_DIR, 'model.scad'), code: 'cube(1);' });

            expect(getText(r)).to.include('Failed to write file');
            expect(getText(r)).to.include('Disk full');
        });
    });
});

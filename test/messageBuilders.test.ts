/**
 * Tests for src/agents/messageBuilders.ts
 *
 * vscode is provided via the node_modules/vscode mock package.
 */
import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const vscode = require('vscode');
const {
    buildOrchestratorMessages,
    buildCoderMessages,
    buildDebuggerMessages,
    buildReviewerMessages,
    buildQaMessages,
} = require('../src/agents/messageBuilders');

// ── Test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let extensionUri: { fsPath: string };

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scad-mb-test-'));
    const skillsDir = path.join(tmpDir, '.agents', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    for (const name of ['scad-orchestrator', 'scad-coder', 'scad-reviewer', 'scad-qa', 'scad-debugger']) {
        fs.writeFileSync(path.join(skillsDir, `${name}.skill.md`), `SKILL:${name}`);
    }
    extensionUri = { fsPath: tmpDir };
});

after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── buildOrchestratorMessages ─────────────────────────────────────────────────

describe('buildOrchestratorMessages', () => {
    it('returns an array of two LanguageModelChatMessage', () => {
        const ctx = {
            fileDescription: 'test.scad',
            designBrief: 'Create a cube',
            currentCode: 'cube([10,10,10]);',
            agentReports: [],
            trigger: 'initial',
            changeLog: [],
        };
        const msgs = buildOrchestratorMessages(extensionUri, ctx);
        expect(msgs).to.have.length(2);
        expect(msgs[0]).to.be.instanceOf(vscode.LanguageModelChatMessage);
        expect(msgs[1]).to.be.instanceOf(vscode.LanguageModelChatMessage);
    });

    it('includes the design brief in the second message', () => {
        const ctx = {
            fileDescription: 'test.scad',
            designBrief: 'Make a cylindrical vase',
            currentCode: '',
            agentReports: [],
            trigger: 'initial',
            changeLog: [],
        };
        const msgs = buildOrchestratorMessages(extensionUri, ctx);
        expect(msgs[1].content).to.include('Make a cylindrical vase');
    });

    it('includes skill content in the first message', () => {
        const ctx = {
            fileDescription: 'test.scad',
            designBrief: 'brief',
            currentCode: '',
            agentReports: [],
            trigger: 'initial',
            changeLog: [],
        };
        const msgs = buildOrchestratorMessages(extensionUri, ctx);
        expect(msgs[0].content).to.equal('SKILL:scad-orchestrator');
    });

    it('includes agent reports when present', () => {
        const ctx = {
            fileDescription: 'test.scad',
            designBrief: 'brief',
            currentCode: 'cube([1,1,1]);',
            agentReports: ['Report A', 'Report B'],
            trigger: 'after-coder',
            changeLog: [],
        };
        const msgs = buildOrchestratorMessages(extensionUri, ctx);
        expect(msgs[1].content).to.include('Report A');
        expect(msgs[1].content).to.include('Report B');
    });
});

// ── buildCoderMessages ────────────────────────────────────────────────────────

describe('buildCoderMessages', () => {
    it('returns two messages with skill and generation instruction', () => {
        const msgs = buildCoderMessages(extensionUri, 'Create a bracket');
        expect(msgs).to.have.length(2);
        expect(msgs[0].content).to.equal('SKILL:scad-coder');
        expect(msgs[1].content).to.include('Create a bracket');
    });

    it('includes fix brief when provided', () => {
        const msgs = buildCoderMessages(extensionUri, 'Create a bracket', 'existing code here', 'Fix the hole size');
        expect(msgs[1].content).to.include('Fix the hole size');
        expect(msgs[1].content).to.include('existing code here');
    });

    it('includes the design brief when no fix brief is provided', () => {
        const msgs = buildCoderMessages(extensionUri, 'Make a lid');
        expect(msgs[1].content).to.include('Make a lid');
        expect(msgs[1].content).to.include('CHANGE_HISTORY');
    });
});

// ── buildDebuggerMessages ─────────────────────────────────────────────────────

describe('buildDebuggerMessages', () => {
    it('without renderLogs: includes source code and change history', () => {
        const msgs = buildDebuggerMessages(extensionUri, 'cube([10,10,10]);');
        expect(msgs).to.have.length(2);
        expect(msgs[0].content).to.equal('SKILL:scad-debugger');
        expect(msgs[1].content).to.include('cube([10,10,10]);');
        expect(msgs[1].content).to.include('CHANGE_HISTORY');
        expect(msgs[1].content).to.not.include('Render Logs');
    });

    it('with renderLogs: includes render logs in the user message', () => {
        const msgs = buildDebuggerMessages(extensionUri, 'cube([10,10,10]);', 'ERROR: something failed');
        expect(msgs[1].content).to.include('Render Logs');
        expect(msgs[1].content).to.include('ERROR: something failed');
    });
});

// ── buildReviewerMessages ─────────────────────────────────────────────────────

describe('buildReviewerMessages', () => {
    it('returns two messages including design brief and code', () => {
        const msgs = buildReviewerMessages(extensionUri, 'cube([5,5,5]);', 'A small cube');
        expect(msgs).to.have.length(2);
        expect(msgs[0].content).to.equal('SKILL:scad-reviewer');
        expect(msgs[1].content).to.include('A small cube');
        expect(msgs[1].content).to.include('cube([5,5,5]);');
    });
});

// ── buildQaMessages ───────────────────────────────────────────────────────────

describe('buildQaMessages', () => {
    it('returns two messages including design brief and code', () => {
        const msgs = buildQaMessages(extensionUri, 'cylinder(h=10, r=5);', 'A cylinder');
        expect(msgs).to.have.length(2);
        expect(msgs[0].content).to.equal('SKILL:scad-qa');
        expect(msgs[1].content).to.include('A cylinder');
        expect(msgs[1].content).to.include('cylinder(h=10, r=5);');
    });
});

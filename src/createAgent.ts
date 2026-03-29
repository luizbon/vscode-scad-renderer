import * as vscode from 'vscode';
import * as path from 'path';
import { runAgent, loadSkill } from './agents/runner';
import {
    parseOrchestratorDecision,
    parseReviewReport,
    parseQaReport,
    parseDiagnosticReport,
    OrchestratorContext,
    OrchestratorDecision,
} from './agents/reportParsers';

const SAVE_SCAD_COMMAND = 'scad-renderer.ai.saveGeneratedCode';

// ─────────────────────────────────────────────────────────────────────────────
// Designer signal tokens (defined in scad-designer.skill.md)
// ─────────────────────────────────────────────────────────────────────────────

const ACTION_GENERATE  = 'ACTION:GENERATE_CODE';
const DESIGN_BRIEF_START = 'DESIGN_BRIEF_START';
const DESIGN_BRIEF_END   = 'DESIGN_BRIEF_END';

function extractDesignBrief(text: string): string | undefined {
    const start = text.indexOf(DESIGN_BRIEF_START);
    const end   = text.indexOf(DESIGN_BRIEF_END);
    if (start === -1 || end === -1) { return undefined; }
    return text.substring(start + DESIGN_BRIEF_START.length, end).trim();
}

/** Extracts the design brief from history (for multi-turn create sessions). */
function extractBriefFromHistory(
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>
): string | undefined {
    for (const turn of [...history].reverse()) {
        if (!(turn instanceof vscode.ChatResponseTurn)) { continue; }
        for (const part of turn.response) {
            if (!(part instanceof vscode.ChatResponseMarkdownPart)) { continue; }
            const brief = extractDesignBrief(part.value.value);
            if (brief) { return brief; }
        }
    }
    return undefined;
}

/** Registers the save-to-file command. Called once from extension.ts. */
export function registerSaveCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(SAVE_SCAD_COMMAND, async (code: string) => {
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.workspace.workspaceFolders?.[0]
                    ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'generated_model.scad')
                    : undefined,
                filters: { 'OpenSCAD Files': ['scad'] }
            });
            if (!uri) { return; }
            await vscode.workspace.fs.writeFile(uri, Buffer.from(code, 'utf-8'));
            const open = await vscode.window.showInformationMessage(
                `Saved to ${path.basename(uri.fsPath)}`,
                'Open & Preview'
            );
            if (open === 'Open & Preview') {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
                await vscode.commands.executeCommand('scad-renderer.preview', uri);
            }
        })
    );
}

/** Finds the initial description from the first /create turn in history. */
function getInitialDescription(
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
    currentPrompt: string
): string {
    for (const turn of history) {
        if (turn instanceof vscode.ChatRequestTurn && turn.command === 'create' && turn.prompt.trim()) {
            return turn.prompt.trim();
        }
    }
    return currentPrompt.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Message builders — skill-specific context lives here, not in runner.ts
// ─────────────────────────────────────────────────────────────────────────────

function buildDesignerMessages(
    extensionUri: vscode.Uri,
    initialDescription: string,
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
    currentPrompt: string
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-designer');
    const isFirstTurn = history.length === 0;

    const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            isFirstTurn
                ? `The user wants to create a 3D-printable object. Their description:\n\n"${initialDescription}"\n\nBegin the interview with your first question.`
                : `The user wants to create a 3D-printable object. Their description:\n\n"${initialDescription}"\n\nThe interview is in progress. Continue — do NOT repeat questions already asked.`
        )
    ];

    for (const turn of history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            if (turn.command === 'create') { continue; } // already in setup message
            if (turn.prompt.trim()) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            }
        } else if (turn instanceof vscode.ChatResponseTurn) {
            const text = turn.response
                .filter((p): p is vscode.ChatResponseMarkdownPart => p instanceof vscode.ChatResponseMarkdownPart)
                .map(p => p.value.value)
                .join('');
            if (text.trim()) {
                messages.push(vscode.LanguageModelChatMessage.Assistant(text));
            }
        }
    }

    if (!isFirstTurn && currentPrompt.trim()) {
        messages.push(vscode.LanguageModelChatMessage.User(currentPrompt));
    }

    return messages;
}

function buildCoderMessages(
    extensionUri: vscode.Uri,
    designBrief: string,
    existingCode?: string,
    fixBrief?: string
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-coder');
    const instruction = fixBrief
        ? `Fix the following issue:\n\n${fixBrief}\n\nExisting code:\n\`\`\`openscad\n${existingCode ?? ''}\n\`\`\`\n\nDesign Brief (for reference):\n${designBrief}`
        : `Generate a complete OpenSCAD script based on the following design brief:\n\n${designBrief}`;
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(instruction),
    ];
}

function buildOrchestratorMessages(
    extensionUri: vscode.Uri,
    ctx: OrchestratorContext
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-orchestrator');
    const contextBlock = [
        `**File:** ${ctx.fileDescription}`,
        `**Design Brief / Goal:**\n${ctx.designBrief}`,
        ctx.currentCode ? `**Current SCAD Code:**\n\`\`\`openscad\n${ctx.currentCode}\n\`\`\`` : '',
        ctx.agentReports.length > 0
            ? `**Subagent Reports This Session:**\n\n${ctx.agentReports.join('\n\n---\n\n')}`
            : '',
        `**Trigger:** ${ctx.trigger}`,
    ].filter(Boolean).join('\n\n');
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            `Read the session context carefully and decide the next action.\n\n${contextBlock}`
        ),
    ];
}

function buildReviewerMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    designBrief: string
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-reviewer');
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            `Review the following OpenSCAD script against the design brief.\n\n` +
            `**Design Brief:**\n${designBrief}\n\n` +
            `**OpenSCAD Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        ),
    ];
}

function buildQaMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    designBrief: string
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-qa');
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            `Perform final QA on the following OpenSCAD model.\n\n` +
            `**Design Brief:**\n${designBrief}\n\n` +
            `**OpenSCAD Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        ),
    ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Orchestrator dispatch helper
// ─────────────────────────────────────────────────────────────────────────────

async function runOrchestratorStep(
    model: vscode.LanguageModelChat,
    extensionUri: vscode.Uri,
    ctx: OrchestratorContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<OrchestratorDecision> {
    const messages = buildOrchestratorMessages(extensionUri, ctx);
    const raw = await runAgent(model, messages, response, token, undefined, '🛸 Orchestrator is deciding…');
    return parseOrchestratorDecision(raw);
}

async function readFile(uri: vscode.Uri): Promise<string> {
    try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(bytes);
    } catch { return ''; }
}

// ─────────────────────────────────────────────────────────────────────────────
// /create flow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrates the /create flow.
 *
 * Phases:
 *  1. Designer LLM interviews the user (multi-turn).
 *  2. When designer signals ACTION:GENERATE_CODE, the user picks a save location.
 *  3. Coder writes initial SCAD code to the file.
 *  4. Orchestrator-driven loop: the orchestrator LLM (guided by its skill file) decides
 *     whether to call Reviewer, QA, Coder (for fixes), Debugger, or DONE.
 */
export async function handleCreateRequest(
    extensionUri: vscode.Uri,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    toolInvocationToken?: string
): Promise<vscode.ChatResult> {
    const history = context.history;
    const initialDescription = getInitialDescription(history, request.prompt);

    if (!initialDescription) {
        response.markdown(
            `## 🎨 Create a 3D-Printable Object\n\n` +
            `Describe what you'd like to make and I'll ask a few questions before generating the OpenSCAD code.\n\n` +
            `*Example: "a wall hook for hanging my bicycle helmet"*`
        );
        return { metadata: { phase: 'create-start' } };
    }

    // ── Phase 1: Designer interview ───────────────────────────────────────────

    response.progress('💬 3D design specialist is thinking…');

    const designerMessages = buildDesignerMessages(extensionUri, initialDescription, history, request.prompt);
    const designerOutput = await runAgent(model(request), designerMessages, response, token);

    const readyToGenerate = designerOutput.includes(ACTION_GENERATE);
    const designBriefText = extractDesignBrief(designerOutput) ?? extractBriefFromHistory(history);

    if (!readyToGenerate || !designBriefText) {
        // Still interviewing — show the response (stripping internal tokens) and wait
        // Note: runAgent already streamed the output; no extra work needed here.
        return { metadata: { phase: 'designing' } };
    }

    // ── Phase 2: Pick save location ───────────────────────────────────────────

    response.progress('🎨 Design brief ready. Choose where to save your model…');

    const words = designBriefText.toLowerCase().match(/\b(\w+)\b/g);
    const suggestedName = words
        ? `${words.filter(w => w.length > 4 && !['model', 'scad', 'design', 'which', 'their'].includes(w)).slice(0, 2).join('_')}.scad`
        : 'my_model.scad';

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.workspace.workspaceFolders?.[0]
            ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, suggestedName)
            : undefined,
        filters: { 'OpenSCAD Files': ['scad'] },
        title: '🚀 Create SCAD Project: Save your new file to begin'
    });

    if (!uri) {
        response.markdown('⚠️ You must save the file to proceed with code generation.');
        return { metadata: { phase: 'design-cancelled' } };
    }

    await vscode.workspace.fs.writeFile(uri, Buffer.from(
        `// Created by SCAD AI Designer\n// Brief: ${designBriefText.replace(/\n/g, ' ')}\n\n`, 'utf-8'
    ));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    await vscode.commands.executeCommand('scad-renderer.preview', uri);

    // ── Phase 3: Initial code generation ─────────────────────────────────────

    response.progress('⚙️ Coder agent is building your 3D model…');
    response.markdown('\n\n---\n## 🖨️ Generating OpenSCAD Code\n\n');

    const coderMessages = buildCoderMessages(extensionUri, designBriefText);
    await runAgent(model(request), coderMessages, response, token, toolInvocationToken, '⚙️ Coder is writing…');

    // ── Phase 4: Orchestrator-driven quality loop ─────────────────────────────

    const agentReports: string[] = [
        `### Coder Turn (initial)\nCode written to disk. Design brief: ${designBriefText}`
    ];

    const MAX_ITERATIONS = 20;
    let iterations = 0;
    let trigger = 'Initial code generation completed. Post-code quality gate should begin.';

    while (!token.isCancellationRequested && iterations < MAX_ITERATIONS) {
        iterations++;

        const currentCode = await readFile(uri);
        const ctx: OrchestratorContext = {
            fileDescription: vscode.workspace.asRelativePath(uri),
            designBrief: designBriefText,
            currentCode,
            agentReports,
            trigger,
        };

        response.markdown(`\n\n---\n## 🛸 Orchestrator (step ${iterations})\n\n`);
        const decision = await runOrchestratorStep(model(request), extensionUri, ctx, response, token);

        if (token.isCancellationRequested) { break; }
        if (decision.action === 'DONE') {
            response.markdown('\n\n✅ **Orchestrator declared the model complete.**\n\n');
            break;
        }
        if (decision.action === 'UNKNOWN') {
            response.markdown('\n\n⚠️ Orchestrator could not decide — halting session.\n\n');
            break;
        }

        const brief = decision.brief ?? designBriefText;
        let reportEntry = '';

        switch (decision.action) {
            case 'CALL_CODER': {
                response.markdown(`\n\n---\n## 🖨️ Coder\n\n`);
                const existingCode = await readFile(uri);
                const msgs = buildCoderMessages(extensionUri, designBriefText, existingCode, brief);
                await runAgent(model(request), msgs, response, token, toolInvocationToken, '⚙️ Coder is applying fixes…');
                reportEntry = `### Coder Turn (step ${iterations})\nBrief: ${brief}`;
                trigger = `Coder completed its turn with brief: "${brief}"`;
                break;
            }
            case 'CALL_REVIEWER': {
                response.markdown(`\n\n---\n## 🕵️ Reviewer\n\n`);
                const code = await readFile(uri);
                const msgs = buildReviewerMessages(extensionUri, code, designBriefText);
                const raw = await runAgent(model(request), msgs, response, token, undefined, '🕵️ Reviewer is auditing…');
                const report = parseReviewReport(raw);
                reportEntry = `### Reviewer Report (step ${iterations})\n${report.raw}`;
                trigger = `Reviewer returned status: "${report.status}". Change Request: "${report.changeRequest ?? 'none'}"`;
                break;
            }
            case 'CALL_QA': {
                response.markdown(`\n\n---\n## 🛡️ QA\n\n`);
                const code = await readFile(uri);
                const msgs = buildQaMessages(extensionUri, code, designBriefText);
                const raw = await runAgent(model(request), msgs, response, token, toolInvocationToken, '🛡️ QA is verifying…');
                const report = parseQaReport(raw);
                reportEntry = `### QA Report (step ${iterations})\n${report.raw}`;
                trigger = `QA returned result: "${report.result}". Change Request: "${report.changeRequest ?? 'none'}"`;
                break;
            }
            case 'CALL_DEBUGGER': {
                response.markdown(`\n\n---\n## 🩺 Debugger\n\n`);
                const code = await readFile(uri);
                const skill = loadSkill(extensionUri, 'scad-debugger');
                const msgs = [
                    vscode.LanguageModelChatMessage.User(skill),
                    vscode.LanguageModelChatMessage.User(
                        `Diagnose the following OpenSCAD code.\n\n\`\`\`openscad\n${code}\n\`\`\``
                    ),
                ];
                const raw = await runAgent(model(request), msgs, response, token, toolInvocationToken, '🩺 Debugger is diagnosing…');
                const report = parseDiagnosticReport(raw);
                reportEntry = `### Debugger Report (step ${iterations})\n${report.raw}`;
                trigger = `Debugger returned. Root cause: "${report.rootCause ?? 'unknown'}". Fix guidance: "${report.fixGuidance ?? 'none'}"`;
                break;
            }
            default:
                response.markdown(`\n\n⚠️ Unknown orchestrator action "${decision.action}" — halting.`);
                return { metadata: { phase: 'coded' } };
        }

        agentReports.push(reportEntry);
    }

    if (iterations >= MAX_ITERATIONS) {
        response.markdown('\n\n⚠️ Safety cap reached — session ended after max iterations.\n\n');
    }

    response.button({ command: SAVE_SCAD_COMMAND, title: '💾 Save Generated SCAD', arguments: [] });
    return { metadata: { phase: 'coded' } };
}

/** Helper to unwrap the model from a chat request. */
function model(request: vscode.ChatRequest): vscode.LanguageModelChat {
    return request.model;
}

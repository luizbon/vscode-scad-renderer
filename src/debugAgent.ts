import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { runAgent, loadSkill } from './agents/runner';
import {
    parseOrchestratorDecision,
    parseReviewReport,
    parseQaReport,
    parseDiagnosticReport,
    OrchestratorContext,
    OrchestratorDecision,
} from './agents/reportParsers';

/**
 * Orchestrates the /debug flow.
 *
 * Architecture:
 *  - The orchestrator LLM (scad-orchestrator.skill.md) decides every next step.
 *  - TypeScript is a pure dispatcher: build messages → run agent → parse → repeat.
 *  - No routing logic here; all decisions belong to the skill file.
 */
export async function handleDebugRequest(
    extensionUri: vscode.Uri,
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    toolInvocationToken?: string
): Promise<vscode.ChatResult> {

    // ── 1. Resolve source file & render logs ──────────────────────────────────

    let targetUri: vscode.Uri | undefined;
    let scadCode = '';
    let renderLogs: string | undefined;

    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.fsPath.endsWith('.scad')) {
        targetUri = editor.document.uri;
        scadCode = editor.document.getText();
        response.progress(`Using active file: ${editor.document.fileName}`);
    }

    if (!scadCode) {
        const panel = targetUri
            ? PreviewPanel.panels.get(targetUri.toString())
            : Array.from(PreviewPanel.panels.values())[0];

        if (panel) {
            targetUri = panel.documentUri;
            try {
                const bytes = await vscode.workspace.fs.readFile(targetUri);
                scadCode = new TextDecoder().decode(bytes);
            } catch { /* ignore */ }
            renderLogs = panel.lastLogs;
        }
    }

    if (!renderLogs && targetUri) {
        const panel = PreviewPanel.panels.get(targetUri.toString());
        if (panel) { renderLogs = panel.lastLogs; }
    }

    if (!scadCode || !targetUri) {
        response.markdown('⚠️ Please open a `.scad` file or a SCAD Preview panel before running `/debug`.');
        return {};
    }

    // ── 2. Ensure preview panel is visible ────────────────────────────────────

    if (!PreviewPanel.panels.has(targetUri.toString())) {
        const config = vscode.workspace.getConfiguration('scadRenderer');
        const execPath = config.get<string>('executablePath') || 'openscad';
        PreviewPanel.createOrShow(extensionUri, execPath, targetUri);
    }

    const fileDescription = vscode.workspace.asRelativePath(targetUri);
    const designBrief = `Debug session for: ${fileDescription}`;

    // ── 3. Initial Debugger turn — diagnose the root cause ────────────────────

    response.markdown('\n\n---\n## 🩺 Debugger Analysis\n\n');

    const debuggerSkill = loadSkill(extensionUri, 'scad-debugger');
    const debuggerMessages = [
        vscode.LanguageModelChatMessage.User(debuggerSkill),
        vscode.LanguageModelChatMessage.User(
            `Diagnose the following OpenSCAD file.\n\n` +
            `**Render Logs:**\n${renderLogs ?? '(no logs captured)'}\n\n` +
            `**Source Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        ),
    ];

    const debuggerOutput = await runAgent(
        request.model, debuggerMessages, response, token, toolInvocationToken, '🩺 Debugger is analysing…'
    );
    const diagnosticReport = parseDiagnosticReport(debuggerOutput);

    if (token.isCancellationRequested) { return {}; }

    // ── 4. Orchestrator-driven dispatch loop ──────────────────────────────────

    const agentReports: string[] = [
        `### Debugger Report\n${diagnosticReport.raw || diagnosticReport.fixGuidance || 'No structured report returned.'}`
    ];

    const readCurrentCode = async (): Promise<string> => {
        try {
            const bytes = await vscode.workspace.fs.readFile(targetUri!);
            return new TextDecoder().decode(bytes);
        } catch { return scadCode; }
    };

    const MAX_ITERATIONS = 20;
    let iterations = 0;
    let trigger = `Debugger diagnosed the issue. Root cause: "${diagnosticReport.rootCause ?? 'unknown'}". Fix guidance: "${diagnosticReport.fixGuidance ?? 'none'}"`;

    while (!token.isCancellationRequested && iterations < MAX_ITERATIONS) {
        iterations++;

        const currentCode = await readCurrentCode();
        const ctx: OrchestratorContext = {
            fileDescription,
            designBrief,
            currentCode,
            agentReports,
            trigger,
        };

        response.markdown(`\n\n---\n## 🛸 Orchestrator (step ${iterations})\n\n`);

        const orchestratorSkill = loadSkill(extensionUri, 'scad-orchestrator');
        const orchestratorMessages = buildOrchestratorMessages(orchestratorSkill, ctx);
        const orchestratorOutput = await runAgent(
            request.model, orchestratorMessages, response, token, undefined, '🛸 Orchestrator is deciding…'
        );
        const decision = parseOrchestratorDecision(orchestratorOutput);

        if (token.isCancellationRequested) { break; }

        if (decision.action === 'DONE') {
            response.markdown('\n\n✅ **Orchestrator declared the session complete.**\n\n');
            break;
        }
        if (decision.action === 'UNKNOWN') {
            response.markdown('\n\n⚠️ Orchestrator could not decide — halting.\n\n');
            break;
        }

        const brief = decision.brief ?? designBrief;
        let reportEntry = '';

        switch (decision.action) {
            case 'CALL_CODER': {
                response.markdown(`\n\n---\n## 🖨️ Coder\n\n`);
                const existingCode = await readCurrentCode();
                const skill = loadSkill(extensionUri, 'scad-coder');
                const msgs = [
                    vscode.LanguageModelChatMessage.User(skill),
                    vscode.LanguageModelChatMessage.User(
                        `Fix the following issue:\n\n${brief}\n\n` +
                        `Existing code:\n\`\`\`openscad\n${existingCode}\n\`\`\``
                    ),
                ];
                await runAgent(request.model, msgs, response, token, toolInvocationToken, '⚙️ Coder is applying fix…');
                reportEntry = `### Coder Turn (step ${iterations})\nBrief: ${brief}`;
                trigger = `Coder completed its turn with brief: "${brief}"`;
                break;
            }
            case 'CALL_REVIEWER': {
                response.markdown(`\n\n---\n## 🕵️ Reviewer\n\n`);
                const code = await readCurrentCode();
                const skill = loadSkill(extensionUri, 'scad-reviewer');
                const msgs = [
                    vscode.LanguageModelChatMessage.User(skill),
                    vscode.LanguageModelChatMessage.User(
                        `Review the following OpenSCAD code against the design brief.\n\n` +
                        `**Design Brief:**\n${designBrief}\n\n` +
                        `**Code:**\n\`\`\`openscad\n${code}\n\`\`\``
                    ),
                ];
                const raw = await runAgent(request.model, msgs, response, token, undefined, '🕵️ Reviewer is auditing…');
                const report = parseReviewReport(raw);
                reportEntry = `### Reviewer Report (step ${iterations})\n${report.raw}`;
                trigger = `Reviewer returned status: "${report.status}". Change Request: "${report.changeRequest ?? 'none'}"`;
                break;
            }
            case 'CALL_QA': {
                response.markdown(`\n\n---\n## 🛡️ QA\n\n`);
                const code = await readCurrentCode();
                const skill = loadSkill(extensionUri, 'scad-qa');
                const msgs = [
                    vscode.LanguageModelChatMessage.User(skill),
                    vscode.LanguageModelChatMessage.User(
                        `Perform final QA on the following OpenSCAD model.\n\n` +
                        `**Design Brief:**\n${designBrief}\n\n` +
                        `**Code:**\n\`\`\`openscad\n${code}\n\`\`\``
                    ),
                ];
                const raw = await runAgent(request.model, msgs, response, token, toolInvocationToken, '🛡️ QA is verifying…');
                const report = parseQaReport(raw);
                reportEntry = `### QA Report (step ${iterations})\n${report.raw}`;
                trigger = `QA returned result: "${report.result}". Change Request: "${report.changeRequest ?? 'none'}"`;
                break;
            }
            case 'CALL_DEBUGGER': {
                response.markdown(`\n\n---\n## 🩺 Debugger\n\n`);
                const code = await readCurrentCode();
                const skill = loadSkill(extensionUri, 'scad-debugger');
                const msgs = [
                    vscode.LanguageModelChatMessage.User(skill),
                    vscode.LanguageModelChatMessage.User(
                        `Diagnose the following OpenSCAD code.\n\n\`\`\`openscad\n${code}\n\`\`\``
                    ),
                ];
                const raw = await runAgent(request.model, msgs, response, token, toolInvocationToken, '🩺 Debugger is diagnosing…');
                const report = parseDiagnosticReport(raw);
                reportEntry = `### Debugger Report (step ${iterations})\n${report.raw}`;
                trigger = `Debugger returned. Root cause: "${report.rootCause ?? 'unknown'}". Fix guidance: "${report.fixGuidance ?? 'none'}"`;
                break;
            }
            default:
                response.markdown(`\n\n⚠️ Unknown action "${decision.action}" — halting.`);
                return {};
        }

        agentReports.push(reportEntry);
    }

    if (iterations >= MAX_ITERATIONS) {
        response.markdown('\n\n⚠️ Safety cap reached — session ended after max iterations.\n\n');
    }

    return { metadata: { phase: 'debug-complete' } };
}

/** Builds orchestrator messages from context. */
function buildOrchestratorMessages(
    skill: string,
    ctx: OrchestratorContext
): vscode.LanguageModelChatMessage[] {
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

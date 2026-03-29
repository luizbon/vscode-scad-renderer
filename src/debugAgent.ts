import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { runAgent } from './agents/runner';
import {
    parseReviewReport,
    parseQaReport,
    parseDiagnosticReport,
} from './agents/reportParsers';
import {
    buildOrchestratorMessages,
    buildCoderMessages,
    buildReviewerMessages,
    buildQaMessages,
    buildDebuggerMessages,
} from './agents/messageBuilders';
import { runOrchestratorLoop } from './agents/orchestratorLoop';

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
    toolInvocationToken?: vscode.ChatParticipantToolToken
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

    const debuggerMessages = buildDebuggerMessages(extensionUri, scadCode, renderLogs);
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

    let trigger = `Debugger diagnosed the issue. Root cause: "${diagnosticReport.rootCause ?? 'unknown'}". Fix guidance: "${diagnosticReport.fixGuidance ?? 'none'}"`;

    await runOrchestratorLoop({
        model: request.model,
        extensionUri,
        context: {
            fileDescription,
            designBrief,
            currentCode: await readCurrentCode(),
            agentReports,
            trigger,
        },
        response,
        token,
        toolInvocationToken,
        maxIterations: 20,
        buildOrchestratorMessages: (ctx) => buildOrchestratorMessages(extensionUri, ctx),
        onAfterHandler: async () => {
            const currentCode = await readCurrentCode();
            return { fileDescription, designBrief, currentCode, agentReports, trigger };
        },
        handlers: {
            CALL_CODER: async (brief) => {
                response.markdown(`\n\n---\n## 🖨️ Coder\n\n`);
                const existingCode = await readCurrentCode();
                const msgs = buildCoderMessages(extensionUri, designBrief, existingCode, brief);
                await runAgent(request.model, msgs, response, token, toolInvocationToken, '⚙️ Coder is applying fix…');
                agentReports.push(`### Coder Turn\nBrief: ${brief}`);
                trigger = `Coder completed its turn with brief: "${brief}"`;
            },
            CALL_REVIEWER: async (brief) => {
                response.markdown(`\n\n---\n## 🕵️ Reviewer\n\n`);
                const code = await readCurrentCode();
                const msgs = buildReviewerMessages(extensionUri, code, designBrief);
                const raw = await runAgent(request.model, msgs, response, token, undefined, '🕵️ Reviewer is auditing…');
                const report = parseReviewReport(raw);
                agentReports.push(`### Reviewer Report\n${report.raw}`);
                trigger = `Reviewer returned status: "${report.status}". Change Request: "${report.changeRequest ?? 'none'}"`;
            },
            CALL_QA: async (brief) => {
                response.markdown(`\n\n---\n## 🛡️ QA\n\n`);
                const code = await readCurrentCode();
                const msgs = buildQaMessages(extensionUri, code, designBrief);
                const raw = await runAgent(request.model, msgs, response, token, toolInvocationToken, '🛡️ QA is verifying…');
                const report = parseQaReport(raw);
                agentReports.push(`### QA Report\n${report.raw}`);
                trigger = `QA returned result: "${report.result}". Change Request: "${report.changeRequest ?? 'none'}"`;
            },
            CALL_DEBUGGER: async (brief) => {
                response.markdown(`\n\n---\n## 🩺 Debugger\n\n`);
                const code = await readCurrentCode();
                const msgs = buildDebuggerMessages(extensionUri, code);
                const raw = await runAgent(request.model, msgs, response, token, toolInvocationToken, '🩺 Debugger is diagnosing…');
                const report = parseDiagnosticReport(raw);
                agentReports.push(`### Debugger Report\n${report.raw}`);
                trigger = `Debugger returned. Root cause: "${report.rootCause ?? 'unknown'}". Fix guidance: "${report.fixGuidance ?? 'none'}"`;
            },
        },
    });

    return { metadata: { phase: 'debug-complete' } };
}

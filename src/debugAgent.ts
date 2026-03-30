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
import { runOrchestratorLoop, createSilentStream } from './agents/orchestratorLoop';
import { stripSentinelBlocks } from './agents/reportParsers';

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

    response.progress('🩺 Debugger is analysing…');

    const debuggerMessages = buildDebuggerMessages(extensionUri, scadCode, renderLogs);
    const debuggerOutput = await runAgent(
        request.model, debuggerMessages, createSilentStream(), token, toolInvocationToken, ''
    );
    const debuggerVisible = stripSentinelBlocks(debuggerOutput);
    if (debuggerVisible) { response.markdown(debuggerVisible + '\n\n'); }
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
        context: {
            fileDescription,
            designBrief,
            currentCode: await readCurrentCode(),
            agentReports,
            trigger,
            changeLog: [{
                step: 0,
                agent: 'CALL_DEBUGGER',
                summary: `Initial diagnosis — root cause: ${diagnosticReport.rootCause ?? 'unknown'}`,
                outcome: 'success',
            }],
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
            CALL_CODER: async (brief, changeLog) => {
                response.progress('⚙️ Coder is applying fix…');
                const existingCode = await readCurrentCode();
                const msgs = buildCoderMessages(extensionUri, designBrief, existingCode, brief, changeLog);
                const raw = await runAgent(request.model, msgs, createSilentStream(), token, toolInvocationToken, '');
                const visible = stripSentinelBlocks(raw);
                if (visible) { response.markdown(visible + '\n\n'); }
                agentReports.push(`### Coder Turn\nBrief: ${brief}`);
                trigger = `Coder completed its turn with brief: "${brief}"`;
                return `Applied fix: ${brief}`;
            },
            CALL_REVIEWER: async (brief, changeLog) => {
                response.progress('🕵️ Reviewer is auditing…');
                const code = await readCurrentCode();
                const msgs = buildReviewerMessages(extensionUri, code, designBrief, changeLog);
                const raw = await runAgent(request.model, msgs, createSilentStream(), token, undefined, '');
                const report = parseReviewReport(raw);
                const visible = stripSentinelBlocks(raw);
                if (visible) { response.markdown(visible + '\n\n'); }
                agentReports.push(`### Reviewer Report\n${report.raw}`);
                trigger = `Reviewer returned status: "${report.status}". Change Request: "${report.changeRequest ?? 'none'}"`;
                return `Reviewer: ${report.status}${report.changeRequest ? ` — ${report.changeRequest}` : ''}`;
            },
            CALL_QA: async (brief, changeLog) => {
                response.progress('🛡️ QA is verifying…');
                const code = await readCurrentCode();
                const msgs = buildQaMessages(extensionUri, code, designBrief, changeLog);
                const raw = await runAgent(request.model, msgs, createSilentStream(), token, toolInvocationToken, '');
                const report = parseQaReport(raw);
                const visible = stripSentinelBlocks(raw);
                if (visible) { response.markdown(visible + '\n\n'); }
                agentReports.push(`### QA Report\n${report.raw}`);
                trigger = `QA returned result: "${report.result}". Change Request: "${report.changeRequest ?? 'none'}"`;
                return `QA: ${report.result}${report.changeRequest ? ` — ${report.changeRequest}` : ''}`;
            },
            CALL_DEBUGGER: async (brief, changeLog) => {
                response.progress('🩺 Debugger is diagnosing…');
                const code = await readCurrentCode();
                const msgs = buildDebuggerMessages(extensionUri, code, undefined, changeLog);
                const raw = await runAgent(request.model, msgs, createSilentStream(), token, toolInvocationToken, '');
                const report = parseDiagnosticReport(raw);
                const visible = stripSentinelBlocks(raw);
                if (visible) { response.markdown(visible + '\n\n'); }
                agentReports.push(`### Debugger Report\n${report.raw}`);
                trigger = `Debugger returned. Root cause: "${report.rootCause ?? 'unknown'}". Fix guidance: "${report.fixGuidance ?? 'none'}"`;
                return `Debugger: root cause — ${report.rootCause ?? 'unknown'}`;
            },
        },
    });

    response.markdown(
        `✅ **Debug session complete.**\n\n` +
        `Root cause: *${diagnosticReport.rootCause ?? 'See debugger analysis above.'}*\n\n` +
        (diagnosticReport.fixGuidance ? `Fix applied: ${diagnosticReport.fixGuidance}` : '')
    );

    return { metadata: { phase: 'debug-complete' } };
}

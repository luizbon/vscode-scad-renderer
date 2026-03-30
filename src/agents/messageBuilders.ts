import * as vscode from 'vscode';
import { loadSkill } from './runner';
import { OrchestratorContext, ChangeLogEntry } from './reportParsers';

function formatChangeLog(changeLog: ChangeLogEntry[]): string {
    if (changeLog.length === 0) {
        return 'No changes have been made yet this session.';
    }
    return changeLog.map(e =>
        `- Step ${e.step} [${e.agent}] (${e.outcome}): ${e.summary}`
    ).join('\n');
}

/**
 * Builds messages for the orchestrator LLM.
 */
export function buildOrchestratorMessages(
    extensionUri: vscode.Uri,
    ctx: OrchestratorContext
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-orchestrator');
    const contextBlock = [
        `**File:** ${ctx.fileDescription}`,
        `**Design Brief / Goal:**\n${ctx.designBrief}`,
        `**Change History (Session Memory):**\n${formatChangeLog(ctx.changeLog)}`,
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

/**
 * Builds messages for the coder LLM.
 *
 * When `fixBrief` is provided the coder is asked to fix an existing file.
 * Otherwise it generates code from scratch based on `designBrief`.
 */
export function buildCoderMessages(
    extensionUri: vscode.Uri,
    designBrief: string,
    existingCode?: string,
    fixBrief?: string,
    changeLog: ChangeLogEntry[] = []
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-coder');
    const changeLogBlock = `**CHANGE_HISTORY (read before writing anything):**\n${formatChangeLog(changeLog)}`;
    const instruction = fixBrief
        ? `${changeLogBlock}\n\n**Design Brief (for reference):**\n${designBrief}\n\n**What needs to change:**\n${fixBrief}\n\n**Current code:**\n\`\`\`openscad\n${existingCode ?? ''}\n\`\`\``
        : `${changeLogBlock}\n\n**Design Brief:**\n${designBrief}${existingCode ? `\n\n**Existing code (starting point):**\n\`\`\`openscad\n${existingCode}\n\`\`\`` : ''}`;
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(instruction),
    ];
}

/**
 * Builds messages for the reviewer LLM.
 */
export function buildReviewerMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    designBrief: string,
    changeLog: ChangeLogEntry[] = []
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-reviewer');
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            `**CHANGE_HISTORY (issues already addressed — do not raise them again):**\n${formatChangeLog(changeLog)}\n\n` +
            `**Design Brief:**\n${designBrief}\n\n` +
            `**OpenSCAD Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        ),
    ];
}

/**
 * Builds messages for the QA LLM.
 */
export function buildQaMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    designBrief: string,
    changeLog: ChangeLogEntry[] = []
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-qa');
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(
            `**CHANGE_HISTORY (improvements already made — do not request them again):**\n${formatChangeLog(changeLog)}\n\n` +
            `**Design Brief:**\n${designBrief}\n\n` +
            `**OpenSCAD Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        ),
    ];
}

/**
 * Builds messages for the debugger LLM.
 *
 * When `renderLogs` is provided (initial debug session) those are included.
 * Otherwise a simple diagnosis request is sent (orchestrator-driven re-invocations).
 */
export function buildDebuggerMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    renderLogs?: string,
    changeLog: ChangeLogEntry[] = []
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-debugger');
    const changeLogBlock = `**CHANGE_HISTORY (previous fix attempts — avoid repeating them):**\n${formatChangeLog(changeLog)}\n\n`;
    const userText = renderLogs
        ? `${changeLogBlock}**Render Logs:**\n${renderLogs}\n\n**Source Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        : `${changeLogBlock}**Source Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``;
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(userText),
    ];
}

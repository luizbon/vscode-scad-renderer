import * as vscode from 'vscode';
import { loadSkill } from './runner';
import { OrchestratorContext } from './reportParsers';

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

/**
 * Builds messages for the reviewer LLM.
 */
export function buildReviewerMessages(
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

/**
 * Builds messages for the QA LLM.
 */
export function buildQaMessages(
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

/**
 * Builds messages for the debugger LLM.
 *
 * When `renderLogs` is provided (initial debug session) those are included.
 * Otherwise a simple diagnosis request is sent (orchestrator-driven re-invocations).
 */
export function buildDebuggerMessages(
    extensionUri: vscode.Uri,
    scadCode: string,
    renderLogs?: string
): vscode.LanguageModelChatMessage[] {
    const skill = loadSkill(extensionUri, 'scad-debugger');
    const userText = renderLogs
        ? `Diagnose the following OpenSCAD file.\n\n` +
          `**Render Logs:**\n${renderLogs}\n\n` +
          `**Source Code:**\n\`\`\`openscad\n${scadCode}\n\`\`\``
        : `Diagnose the following OpenSCAD code.\n\n\`\`\`openscad\n${scadCode}\n\`\`\``;
    return [
        vscode.LanguageModelChatMessage.User(skill),
        vscode.LanguageModelChatMessage.User(userText),
    ];
}

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const ACTION_GENERATE = 'ACTION:GENERATE_CODE';
const DESIGN_BRIEF_START = 'DESIGN_BRIEF_START';
const DESIGN_BRIEF_END = 'DESIGN_BRIEF_END';

/** Loads the designer skill file. Falls back to an inline prompt if missing. */
function loadDesignerSkill(extensionUri: vscode.Uri): string {
    const skillPath = path.join(extensionUri.fsPath, '.agents', 'skills', 'scad-designer.skill.md');
    try {
        return fs.readFileSync(skillPath, 'utf-8');
    } catch {
        return `You are a senior 3D modelling engineer and FDM printing specialist.
Interview the user one question at a time to understand what object they want to create.
When you have enough information, output ACTION:GENERATE_CODE followed by a DESIGN_BRIEF_START ... DESIGN_BRIEF_END block.`;
    }
}

/** Extracts the design brief text from the raw LLM output string. */
function extractBriefFromText(text: string): string | undefined {
    const start = text.indexOf(DESIGN_BRIEF_START);
    const end = text.indexOf(DESIGN_BRIEF_END);
    if (start === -1 || end === -1) { return undefined; }
    return text.substring(start + DESIGN_BRIEF_START.length, end).trim();
}

/**
 * Extracts the design brief from conversation history.
 * Used by the orchestrator to find a previously generated brief.
 */
export function extractDesignBrief(
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>
): string | undefined {
    for (const turn of [...history].reverse()) {
        if (!(turn instanceof vscode.ChatResponseTurn)) { continue; }
        for (const part of turn.response) {
            if (!(part instanceof vscode.ChatResponseMarkdownPart)) { continue; }
            const brief = extractBriefFromText(part.value.value);
            if (brief) { return brief; }
        }
    }
    return undefined;
}

/** Builds the LLM message chain: skill system prompt + full conversation history. */
function buildMessages(
    skillPrompt: string,
    initialDescription: string,
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
    currentPrompt: string
): vscode.LanguageModelChatMessage[] {
    const isFirstTurn = history.length === 0;

    const messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(skillPrompt),
        vscode.LanguageModelChatMessage.User(
            isFirstTurn
                ? `The user wants to create a 3D-printable object. Their description:\n\n"${initialDescription}"\n\nBegin your interview now with your first question.`
                : `The user wants to create a 3D-printable object. Their description:\n\n"${initialDescription}"\n\nThe interview is in progress. Continue from the conversation below — do NOT repeat questions already asked.`
        )
    ];

    for (const turn of history) {
        if (turn instanceof vscode.ChatRequestTurn) {
            // Skip the initial /create turn — its content is already in the setup message above.
            // Skipping this prevents the description from appearing twice and confusing the LLM.
            if (turn.command === 'create') { continue; }
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

    // Add the current user reply (if this is a follow-up, not the initial /create)
    if (!isFirstTurn && currentPrompt.trim()) {
        messages.push(vscode.LanguageModelChatMessage.User(currentPrompt));
    }

    return messages;
}

export interface DesignerTurnResult {
    /** True if the LLM signalled it is ready to generate code. */
    readyToGenerate: boolean;
    /** The extracted design brief (only set when readyToGenerate is true). */
    designBrief?: string;
}

/**
 * Runs one designer turn.
 *
 * The LLM controls the entire interview — we only:
 *  1. Stream its response to the user (stripping internal control tokens)
 *  2. Detect the ACTION:GENERATE_CODE signal
 *  3. Return whether generation should begin
 */
export async function runDesignerTurn(
    model: vscode.LanguageModelChat,
    extensionUri: vscode.Uri,
    initialDescription: string,
    currentPrompt: string,
    history: ReadonlyArray<vscode.ChatRequestTurn | vscode.ChatResponseTurn>,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken
): Promise<DesignerTurnResult> {
    const skillPrompt = loadDesignerSkill(extensionUri);
    const messages = buildMessages(skillPrompt, initialDescription, history, currentPrompt);

    let fullResponse = '';
    try {
        const chatResponse = await model.sendRequest(messages, {}, token);
        for await (const chunk of chatResponse.text) {
            fullResponse += chunk;
        }
    } catch (err: any) {
        response.markdown(`\n\n⚠️ ${err?.message ?? String(err)}`);
        return { readyToGenerate: false };
    }

    // Determine if the designer is ready to trigger the coder
    const readyToGenerate = fullResponse.includes(ACTION_GENERATE);
    const briefContent = extractBriefFromText(fullResponse) ?? '';

    // ALWAYS hide system tokens and the structured brief block from the user display
    let display = fullResponse
        .replace(ACTION_GENERATE, '')
        .trim();

    // Regex to hide the entire background brief block
    const briefRegex = new RegExp(`${DESIGN_BRIEF_START}[\\s\\S]*?${DESIGN_BRIEF_END}`, 'g');
    display = display.replace(briefRegex, '').trim();

    response.markdown(display.length > 0 ? display : (readyToGenerate ? '_Design brief captured. Generating code…_' : '_Processing..._'));

    return {
        readyToGenerate,
        designBrief: briefContent.length > 0 ? briefContent : undefined
    };
}

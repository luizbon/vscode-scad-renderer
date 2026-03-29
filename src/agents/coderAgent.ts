import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/** Loads the coder skill file as a system prompt. */
function loadCoderSkill(extensionUri: vscode.Uri): string {
    const skillPath = path.join(extensionUri.fsPath, '.agents', 'skills', 'scad-coder.skill.md');
    try {
        return fs.readFileSync(skillPath, 'utf-8');
    } catch {
        return `You are an expert OpenSCAD developer specialising in FDM 3D printing.
Write complete, parametric, manifold OpenSCAD code based on the design brief provided.
Include a parameters section at the top and print notes at the bottom.
Return only the code in a fenced openscad code block, followed by a brief design summary.`;
    }
}

/**
 * Runs the SCAD coder agent, generating OpenSCAD code from the design brief.
 */
export async function runCoderTurn(
    model: vscode.LanguageModelChat,
    extensionUri: vscode.Uri,
    targetUri: vscode.Uri,
    designBrief: string,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    toolInvocationToken?: string
): Promise<string> {
    const skillPrompt = loadCoderSkill(extensionUri);

    const messages = [
        vscode.LanguageModelChatMessage.User(skillPrompt),
        vscode.LanguageModelChatMessage.User(
            `Generate a complete OpenSCAD script based on the following design brief:\n\n${designBrief}`
        )
    ];

    let fullCode = '';
    // @ts-ignore
    const availableTools = vscode.lm.tools || [];
    const toolList = availableTools.filter((t: any) => t.name.startsWith('scad_renderer_'));

    try {
        let chatResponse = await model.sendRequest(messages, { tools: toolList as vscode.LanguageModelChatTool[] }, token);
        
        while (true) {
            let hasToolCalls = false;
            let fullCodeThisTurn = '';

            for await (const chunk of chatResponse.stream) {
                if (chunk instanceof vscode.LanguageModelTextPart) {
                    response.markdown(chunk.value);
                    fullCodeThisTurn += chunk.value;
                } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
                    hasToolCalls = true;
                    response.progress(`🛠️ Tool Call: ${chunk.name}...`);
                    try {
                        // @ts-ignore - invokeTool may be scoped or require specific types
                        const toolResult = await vscode.lm.invokeTool(chunk.name, { input: chunk.input, toolInvocationToken }, token);
                        
                        // If it's the update_code tool, also push an interactive file edit for the user to accept/reject
                        if (chunk.name === 'scad_renderer_update_code' && chunk.input && typeof chunk.input === 'object') {
                            const code = (chunk.input as any).code;
                            if (code) {
                                try {
                                    // Use the "AI file change tool" (ChatResponseFileEditPart)
                                    // We push it to the stream so the user sees the diff and Accept button.
                                    const edits = [new vscode.TextEdit(new vscode.Range(0, 0, 10000, 0), code)];
                                    // @ts-ignore
                                    if (typeof (vscode as any).ChatResponseFileEditPart !== 'undefined') {
                                        // @ts-ignore
                                        response.push(new (vscode as any).ChatResponseFileEditPart(targetUri, edits));
                                    } else {
                                        // Fallback: Markdown block with an anchor if the API is missing/unstable
                                        response.markdown(`\n\n*Proposed changes to ${path.basename(targetUri.fsPath)} are ready for review.*`);
                                    }
                                } catch (e) {
                                    console.error('Failed to push file edit part:', e);
                                }
                            }
                        }

                        messages.push(vscode.LanguageModelChatMessage.Assistant([chunk]));
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(chunk.callId, [
                                new vscode.LanguageModelTextPart(JSON.stringify(toolResult.content))
                            ])
                        ]));
                    } catch (e: any) {
                        messages.push(vscode.LanguageModelChatMessage.Assistant([chunk]));
                        messages.push(vscode.LanguageModelChatMessage.User([
                            new vscode.LanguageModelToolResultPart(chunk.callId, [
                                new vscode.LanguageModelTextPart(`Tool error: ${e.message}`)
                            ])
                        ]));
                    }
                }
            }

            fullCode += fullCodeThisTurn;

            if (!hasToolCalls) {
                break;
            }

            // Next turn for tool outputs
            chatResponse = await model.sendRequest(messages, { tools: toolList as vscode.LanguageModelChatTool[] }, token);
        }
    } catch (err: any) {
        response.markdown(`\n\n⚠️ Error during agentic iteration: ${err?.message ?? String(err)}`);
    }

    return fullCode;
}

/** Extracts just the raw OpenSCAD code from the coder's markdown output. */
export function extractScadCode(coderOutput: string): string | null {
    const match = coderOutput.match(/```(?:openscad)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
}

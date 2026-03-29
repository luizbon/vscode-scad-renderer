import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Loads an agent skill file by name from the .agents/skills/ directory.
 * Falls back to an empty string so callers can provide fallback system prompts.
 */
export function loadSkill(extensionUri: vscode.Uri, skillName: string): string {
    const skillPath = path.join(extensionUri.fsPath, '.agents', 'skills', `${skillName}.skill.md`);
    try {
        return fs.readFileSync(skillPath, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * Runs a single agent turn against the VS Code language model.
 *
 * This is the only TypeScript file responsible for LLM communication — it is
 * intentionally skill-agnostic. Callers supply the messages; this function
 * handles the tool-call loop, streams text to chat, and returns the full response.
 *
 * @param model              The LLM to use.
 * @param messages           The message chain to send (skill prompt + user context).
 * @param response           The chat response stream to write to.
 * @param token              Cancellation token.
 * @param toolInvocationToken Optional token required by the VS Code tool invocation API.
 * @param progressMessage    Optional progress spinner message shown before the request.
 * @returns                  The full text response accumulated across all tool-call turns.
 */
export async function runAgent(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    toolInvocationToken?: string,
    progressMessage?: string
): Promise<string> {
    if (progressMessage) {
        response.progress(progressMessage);
    }

    // @ts-ignore — vscode.lm.tools is available at runtime
    const availableTools: vscode.LanguageModelChatTool[] = (vscode.lm.tools || [])
        .filter((t: any) => t.name.startsWith('scad_renderer_'));

    let fullResponse = '';

    try {
        let chatResponse = await model.sendRequest(
            messages,
            { tools: availableTools },
            token
        );

        while (!token.isCancellationRequested) {
            const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

            for await (const chunk of chatResponse.stream) {
                if (chunk instanceof vscode.LanguageModelTextPart) {
                    response.markdown(chunk.value);
                    fullResponse += chunk.value;
                } else if (chunk instanceof vscode.LanguageModelToolCallPart) {
                    toolCallParts.push(chunk);
                }
            }

            // No tool calls this turn — the agent is done
            if (toolCallParts.length === 0) {
                break;
            }

            // Handle all tool calls and append results to the message chain
            for (const call of toolCallParts) {
                response.progress(`🛠️ Tool: ${call.name}…`);
                try {
                    // @ts-ignore — toolInvocationToken type mismatch
                    const result = await vscode.lm.invokeTool(call.name, { input: call.input, toolInvocationToken }, token);
                    messages.push(vscode.LanguageModelChatMessage.Assistant([call]));
                    messages.push(vscode.LanguageModelChatMessage.User([
                        new vscode.LanguageModelToolResultPart(call.callId, [
                            new vscode.LanguageModelTextPart(JSON.stringify(result.content))
                        ])
                    ]));
                } catch (err: any) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant([call]));
                    messages.push(vscode.LanguageModelChatMessage.User([
                        new vscode.LanguageModelToolResultPart(call.callId, [
                            new vscode.LanguageModelTextPart(`Tool error: ${err?.message ?? String(err)}`)
                        ])
                    ]));
                }
            }

            // Continue the conversation with the tool results
            chatResponse = await model.sendRequest(
                messages,
                { tools: availableTools },
                token
            );
        }
    } catch (err: any) {
        response.markdown(`\n\n⚠️ Agent error: ${err?.message ?? String(err)}`);
    }

    return fullResponse;
}

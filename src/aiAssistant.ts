import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { handleCreateRequest, registerSaveCommand } from './createAgent';
import { handleDebugRequest } from './debugAgent';

const PARTICIPANT_ID = 'scad.chat';

// System prompt shared across all commands — establishes the domain expert persona
const BASE_SYSTEM_PROMPT = `You are an expert OpenSCAD developer and 3D printing specialist.
You help users write, optimise, and troubleshoot OpenSCAD scripts specifically intended for FDM 3D printing.

INTERACTIVITY RULES:
1. ALWAYS use the 'scad_renderer_open_file' tool if you are working on a specific file, so the user can see it.
2. ALWAYS use the 'scad_renderer_update_code' tool to provide a live 3D preview of any code you generate or modify.
3. If the user asks for changes, explain them clearly and then provide the full updated code via a tool call OR a markdown block.
4. If you use a markdown block for code, ensure it is valid OpenSCAD.

Format code blocks with \`\`\`openscad fences.
Explain your changes clearly and concisely.`;

// Per-command system prompts extend the base prompt with focused objectives
const COMMAND_PROMPTS: Record<string, string> = {
    optimize: `${BASE_SYSTEM_PROMPT}

YOUR TASK: Optimise the supplied OpenSCAD script for FDM 3D printing.
Focus on:
- Eliminating overhangs beyond 45° that would require support material
- Ensuring wall thicknesses are at least 1.2 mm (2 × 0.4 mm nozzle diameter)
- Suggesting or applying layer-aligned geometry for stronger parts
- Reducing unnecessary polygon counts (use $fn wisely for circles/spheres)
- Keeping the model manifold (watertight) so slicers can handle it
- Adding chamfers/fillets to stress-concentration points where applicable
After the improved code, provide a brief bullet-point summary of every change made.`,

    parametric: `${BASE_SYSTEM_PROMPT}

YOUR TASK: Refactor the supplied OpenSCAD script to be fully parametric.
Focus on:
- Extracting ALL hard-coded numeric literals into clearly named top-level variables with comments
- Using the OpenSCAD Customizer format (// [min:step:max] annotations where appropriate)
- Grouping related parameters with section header comments (// === Section === style)
- Deriving dependent values from base parameters using expressions rather than duplicating numbers
- Keeping the model's original shape and proportions unchanged
After the refactored code, list every parameter you introduced and what it controls.`,

    printability: `${BASE_SYSTEM_PROMPT}

YOUR TASK: Audit the supplied OpenSCAD script and identify 3D printability issues.
Check for:
- Overhangs steeper than 45° that will need support
- Walls thinner than 1.2 mm that may not print reliably
- Non-manifold geometry (holes, zero-thickness surfaces, inverted normals)
- Very small features (< 0.4 mm) that most FDM printers cannot reproduce
- Parts with no flat bottom face (will need support or orientation change)
- High polygon counts that may cause slicer performance issues
Provide your findings as a prioritised markdown list (🔴 Critical / 🟡 Warning / 🟢 Suggestion).
Then suggest concrete fixes for each critical issue.`,

    debug: `${BASE_SYSTEM_PROMPT}

YOUR TASK: Troubleshoot the supplied OpenSCAD code and the rendering error logs.
Analyze:
- The provided SCAD script
- Any rendering error messages or warnings
- The current Customizer parameter overrides
Identify the root cause of the failure and provide a corrected version of the code snippet or the full file.
Explain why the issue occurred (e.g., empty geometry result, manifold error, or syntax mistake).`
};
// NOTE: 'debug' key kept for fallback only; /debug is now handled by the agentic pipeline.

function getActiveScadContent(): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return null; }
    if (!editor.document.uri.fsPath.endsWith('.scad')) { return null; }
    return editor.document.getText();
}

async function runAiCommand(command: 'optimize' | 'parametric' | 'printability' | 'debug', setContextualUri: (uri: vscode.Uri | undefined) => void, uri?: vscode.Uri): Promise<void> {
    setContextualUri(uri);

    // If we don't have a URI and no active editor, we can't proceed
    if (!uri && !vscode.window.activeTextEditor) {
        await vscode.window.showErrorMessage('Please open a .scad file first or right-click one in the Explorer.');
        return;
    }

    // Open Chat and pre-fill the message
    await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@scad /${command}`,
        isPartialQuery: false
    });
}

export async function handleChatRequest(
    extensionUri: vscode.Uri,
    request: vscode.ChatRequest,
    _context: vscode.ChatContext,
    response: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    getContextualUri: () => vscode.Uri | undefined,
    clearContextualUri: () => void
): Promise<vscode.ChatResult> {

    const command = request.command ?? '';

    // Route /create to the two-agent pipeline
    if (command === 'create') {
        return handleCreateRequest(extensionUri, request, _context, response, token, request.toolInvocationToken);
    }

    // Route /debug to the agentic debug pipeline
    if (command === 'debug') {
        return handleDebugRequest(extensionUri, request, _context, response, token, request.toolInvocationToken);
    }

    // Check if we're in an active /create interview session.
    // When the user replies to a designer question, there is no slash command on the
    // request — we must infer the session from conversation history.
    const history = _context.history;
    const hasActiveCreateSession = history.some(
        turn => turn instanceof vscode.ChatRequestTurn && turn.command === 'create'
    );
    if (hasActiveCreateSession) {
        return handleCreateRequest(extensionUri, request, _context, response, token, request.toolInvocationToken);
    }

    const systemPrompt = COMMAND_PROMPTS[command];

    if (!systemPrompt) {
        // No slash command — route free-form prompt directly to the orchestrator pipeline.
        // The orchestrator skill will figure out what to do (create, debug, optimize, etc.).
        if (!request.prompt.trim()) {
            response.markdown(`## 🖨️ SCAD AI Assistant

I'm your OpenSCAD 3D printing specialist. Just tell me what you need, for example:

- *"Create a parametric bracket with two mounting holes"*
- *"Fix the rendering error in my file"*
- *"Optimise this model for FDM printing"*

Or use a specific command: \`/create\`, \`/debug\`, \`/optimize\`, \`/parametric\`, \`/printability\`.`);
            return {};
        }
        return handleCreateRequest(extensionUri, request, _context, response, token, request.toolInvocationToken, { skipDesigner: true });
    }

    // Obtain the SCAD code: first check if user pasted code in the prompt,
    // otherwise fall back to the contextual file (from menu) or active editor.
    let scadCode = request.prompt.trim();
    let overrides: Record<string, any> | undefined;
    let renderError: string | undefined;

    const contextualFileUri = getContextualUri();

    if (!scadCode) {
        if (contextualFileUri) {
            try {
                const bytes = await vscode.workspace.fs.readFile(contextualFileUri);
                scadCode = new TextDecoder().decode(bytes);
                const fileName = vscode.workspace.asRelativePath(contextualFileUri);
                response.progress(`Using selected file: ${fileName}`);
            } catch (e) {
                // Ignore
            }
        }

        if (!scadCode) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.fsPath.endsWith('.scad')) {
                scadCode = editor.document.getText();
                response.progress(`Using active file: ${editor.document.fileName}`);
            }
        }

        // Fallback 3: Check if there is an active SCAD Preview panel for this model
        if (!scadCode) {
            const potentialUri = contextualFileUri || vscode.window.activeTextEditor?.document.uri;
            const panel = potentialUri ? PreviewPanel.panels.get(potentialUri.toString()) : Array.from(PreviewPanel.panels.values())[0];

            if (panel) {
                try {
                    const uri = panel.documentUri;
                    const bytes = await vscode.workspace.fs.readFile(uri);
                    scadCode = new TextDecoder().decode(bytes);

                    overrides = panel.parameterOverrides;
                    renderError = panel.lastLogs;

                    const fileName = vscode.workspace.asRelativePath(uri);
                    response.progress(`Using previewed file: ${fileName}`);
                } catch (e) {
                    // Ignore errors
                }
            }
        }
    }

    // Ensure we have current logs if code was found elsewhere but a panel exists
    if (!renderError) {
        const potentialUri = contextualFileUri || vscode.window.activeTextEditor?.document.uri;
        const panel = potentialUri ? PreviewPanel.panels.get(potentialUri.toString()) : Array.from(PreviewPanel.panels.values())[0];
        if (panel) {
            renderError = panel.lastLogs;
        }
    }

    // Clear the contextual URI after it's been "consumed" or at least attempted
    clearContextualUri();

    if (!scadCode) {
        response.markdown('⚠️ Please open a `.scad` file, a preview, or paste some OpenSCAD code into the chat.');
        return {};
    }

    response.progress('Analysing your OpenSCAD script…');

    const userMessages: string[] = [
        `Here is the OpenSCAD script to analyse:\n\n\`\`\`openscad\n${scadCode}\n\`\`\``
    ];

    if (overrides && Object.keys(overrides).length > 0) {
        userMessages.push(`The user currently has the following Customizer parameters applied in the preview:\n\`\`\`json\n${JSON.stringify(overrides, null, 2)}\n\`\`\``);
    }

    if (renderError) {
        userMessages.push(`The OpenSCAD rendering engine reported the following error/output:\n\`\`\`\n${renderError}\n\`\`\``);
    }

    const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(userMessages.join('\n\n'))
    ];

    try {
        // Ensure preview is open for contextual commands
        const activeUri = contextualFileUri || vscode.window.activeTextEditor?.document.uri;
        if (['optimize', 'parametric', 'debug'].includes(command) && (!activeUri || !PreviewPanel.panels.has(activeUri.toString()))) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.fsPath.endsWith('.scad')) {
                const config = vscode.workspace.getConfiguration('scadRenderer');
                const execPath = config.get<string>('executablePath') || 'openscad';
                PreviewPanel.createOrShow(extensionUri, execPath, editor.document.uri);
            }
        }

        // Get tools for the model
        const tools = vscode.lm.tools.filter(tool => tool.name.startsWith('scad_renderer_'));
        
        const chatResponse = await request.model.sendRequest(messages, { tools }, token);

        let fullCodeFound = '';

        for await (const part of chatResponse.stream) {
            if (part instanceof vscode.LanguageModelTextPart) {
                response.markdown(part.value);
                
                // Heuristic: try to capture code blocks to offer interactive edits
                // (In a more advanced implementation, we'd parse the full markdown)
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                response.progress(`Calling tool: ${part.name}…`);
                try {
                    const toolResult = await vscode.lm.invokeTool(part.name, { input: part.input, toolInvocationToken: request.toolInvocationToken }, token);
                    
                    for (const resultPart of toolResult.content) {
                        if (resultPart instanceof vscode.LanguageModelTextPart) {
                            response.progress(resultPart.value);
                        }
                    }
                    
                    // If the tool was update_code, we know the code
                    if (part.name === 'scad_renderer_update_code') {
                        fullCodeFound = (part.input as any).code;
                    }
                } catch (e: any) {
                    response.markdown(`\n\n⚠️ Tool error (${part.name}): ${e.message}`);
                }
            }
        }

        // If we found a substantial code update, offer it as an interactive file edit
        if (fullCodeFound && contextualFileUri) {
            try {
                const edits = [new vscode.TextEdit(new vscode.Range(0, 0, 10000, 0), fullCodeFound)];
                
                // Use the AI File Change tool (ChatResponseFileEditPart)
                if (typeof (vscode as any).ChatResponseFileEditPart !== 'undefined') {
                    response.push(new (vscode as any).ChatResponseFileEditPart(contextualFileUri, edits) as vscode.ChatResponsePart);
                } else {
                    // Fallback button if the type is missing for some reason
                    response.button({
                        command: 'scad-renderer.ai.applyChanges',
                        arguments: [contextualFileUri, fullCodeFound],
                        title: 'Apply Changes to File'
                    });
                }
            } catch (e) {
                // Silent fail for edit enrichment
            }
        }

    } catch (err: any) {
        if (err?.code === 'NoPermissions') {
            response.markdown('⚠️ The selected AI model declined the request. Try a different model in the Chat dropdown.');
        } else {
            response.markdown(`⚠️ An error occurred: ${err?.message ?? String(err)}`);
        }
        return { errorDetails: { message: String(err?.message ?? err) } };
    }

    // Suggest follow-up commands
    return {
        metadata: { command }
    };
}

export function registerChatParticipant(context: vscode.ExtensionContext, setContextualUri: (uri: vscode.Uri | undefined) => void, getContextualUri: () => vscode.Uri | undefined): void {
    const extensionUri = context.extensionUri;
    const clearContextualUri = () => setContextualUri(undefined);
    const participant = vscode.chat.createChatParticipant(
        PARTICIPANT_ID,
        (request, ctx, response, token) => handleChatRequest(extensionUri, request, ctx, response, token, getContextualUri, clearContextualUri)
    );
    participant.iconPath = new vscode.ThemeIcon('symbol-misc');

    // Provide contextual follow-up suggestions after each response
    participant.followupProvider = {
        provideFollowups(result: vscode.ChatResult): vscode.ChatFollowup[] {
            const cmd = result.metadata?.command as string | undefined;
            const phase = result.metadata?.phase as string | undefined;

            // During a /create interview, let the LLM drive — no extra followups
            if (phase === 'designing' || phase === 'create-start') {
                return [];
            }

            // After code is generated
            if (phase === 'coded') {
                return [{ prompt: '', command: 'create', label: '🎨 Create Another Model', participant: PARTICIPANT_ID }];
            }

            // Standard followups for other commands
            const followups: vscode.ChatFollowup[] = [];
            if (cmd !== 'optimize') {
                followups.push({ prompt: '', command: 'optimize', label: '🔧 Optimise for 3D Printing', participant: PARTICIPANT_ID });
            }
            if (cmd !== 'parametric') {
                followups.push({ prompt: '', command: 'parametric', label: '⚙️ Make Parametric', participant: PARTICIPANT_ID });
            }
            if (cmd !== 'printability') {
                followups.push({ prompt: '', command: 'printability', label: '🖨️ Check Printability', participant: PARTICIPANT_ID });
            }
            followups.push({ prompt: '', command: 'create', label: '🎨 Create New Model', participant: PARTICIPANT_ID });
            return followups;
        }
    };


    registerSaveCommand(context);
    context.subscriptions.push(participant);
}

export function registerAiCommands(context: vscode.ExtensionContext, setContextualUri: (uri: vscode.Uri | undefined) => void): void {
    const commands: Array<[string, 'optimize' | 'parametric' | 'printability' | 'debug']> = [
        ['scad-renderer.ai.optimize', 'optimize'],
        ['scad-renderer.ai.parametric', 'parametric'],
        ['scad-renderer.ai.printability', 'printability'],
        ['scad-renderer.ai.debug', 'debug']
    ];

    for (const [commandId, cmd] of commands) {
        context.subscriptions.push(
            vscode.commands.registerCommand(commandId, (uri?: vscode.Uri) => runAiCommand(cmd, setContextualUri, uri))
        );
    }

    // Register the /create command — opens chat pre-filled with @scad /create
    context.subscriptions.push(
        vscode.commands.registerCommand('scad-renderer.ai.create', async () => {
            await vscode.commands.executeCommand('workbench.action.chat.open', {
                query: '@scad /create ',
                isPartialQuery: true
            });
        })
    );
}

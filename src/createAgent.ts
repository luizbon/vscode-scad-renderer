import * as vscode from 'vscode';
import * as path from 'path';
import { runDesignerTurn } from './agents/designerAgent';
import { runCoderTurn, extractScadCode } from './agents/coderAgent';

const SAVE_SCAD_COMMAND = 'scad-renderer.ai.saveGeneratedCode';

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

/**
 * Orchestrates the /create flow.
 *
 * The designer LLM controls the entire interview. This function just:
 * 1. Passes the conversation to the designer agent each turn.
 * 2. When the designer signals ACTION:GENERATE_CODE, immediately calls the coder.
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

    // If the user typed /create with no description yet, prompt them
    if (!initialDescription) {
        response.markdown(
            `## 🎨 Create a 3D-Printable Object\n\n` +
            `Describe what you'd like to make and I'll ask you a few questions before generating the OpenSCAD code.\n\n` +
            `*Example: "a wall hook for hanging my bicycle helmet"*`
        );
        return { metadata: { phase: 'create-start' } };
    }

    response.progress('💬 3D design specialist is thinking…');

    // Hand off to the designer agent — the LLM runs the interview
    const result = await runDesignerTurn(
        request.model,
        extensionUri,
        initialDescription,
        request.prompt,
        history,
        response,
        token
    );

    // If the designer LLM signalled it is ready, immediately prompt the user to save a file
    if (result.readyToGenerate && result.designBrief) {
        response.progress('🎨 Design brief ready. Choose where to save your model...');
        
        // 1. Suggest a filename based on the brief (crude keyword extraction)
        let suggestedName = 'my_model.scad';
        const words = result.designBrief.toLowerCase().match(/\b(\w+)\b/g);
        if (words && words.length > 5) {
            // Find nouns or descriptive words in the first sentence
            const interestingTerms = words.filter(w => w.length > 4 && !['model', 'scad', 'design', 'which', 'their'].includes(w)).slice(0, 2);
            if (interestingTerms.length > 0) {
                suggestedName = `${interestingTerms.join('_')}.scad`;
            }
        }

        // 2. Prompt for save first so user can 'follow along'
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

        // 3. Create the file and open it
        await vscode.workspace.fs.writeFile(uri, Buffer.from(`// Created by SCAD AI Designer\n// Design Brief: ${result.designBrief.replace(/\n/g, ' ')}\n\n`, 'utf-8'));
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        
        // 4. Trigger preview so it's ready for the coder's 'scad_renderer_update_code' calls
        await vscode.commands.executeCommand('scad-renderer.preview', uri);

        response.progress('⚙️ Coder agent is building your 3D model...');
        response.markdown('\n\n---\n## 🖨️ Generating OpenSCAD Code\n\n');

        // 5. Run the coder turn targeting the specific file
        const coderOutput = await runCoderTurn(request.model, extensionUri, uri, result.designBrief, response, token, toolInvocationToken);
        const scadCode = extractScadCode(coderOutput);

        if (scadCode) {
            // Final button for manual save/export if needed, but the file is already being updated interactively
            response.button({ command: SAVE_SCAD_COMMAND, title: '💾 Final Export (Manual)', arguments: [scadCode] });
        }
        return { metadata: { phase: 'coded' } };
    }

    // Otherwise the designer is still interviewing — return and await the next user reply
    return { metadata: { phase: 'designing' } };
}

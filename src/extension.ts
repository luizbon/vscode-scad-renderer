import * as vscode from 'vscode';
import * as fs from 'fs';
import { PreviewPanel } from './PreviewPanel';
import which from 'which';
import * as os from 'os';
import { ScadRunner } from './scadRunner';
import { registerChatParticipant, registerAiCommands } from './aiAssistant';
import { registerScadTools } from './agents/tools';
import { InstructionManager } from './agents/instructionManager';
import { initTelemetry, sendEvent, sendError } from './telemetry';

let scadInstallationChecked = false;
let cachedScadPath: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('vscode-scad-renderer is now active');

    initTelemetry(context);
    sendEvent('extension.activated');

    // Manage AI instructions in the workspace
    InstructionManager.checkAndPrompt(context);

    const checkScadInstallation = async (): Promise<string | undefined> => {
        if (scadInstallationChecked) { return cachedScadPath; }
        // 1. Check if the system path or settings path is compatible
        const config = vscode.workspace.getConfiguration('scadRenderer');
        let fallbackPath = config.get<string>('executablePath');
        
        // Resolve 'openscad' if it's the default and not an absolute path
        if (!fallbackPath || fallbackPath === 'openscad') {
            try {
                fallbackPath = await which('openscad');
            } catch (e) {
                fallbackPath = undefined;
            }
        }

        if (fallbackPath && fs.existsSync(fallbackPath)) {
            const runner = new ScadRunner(fallbackPath);
            const supports = await runner.supportsManifold();
            if (supports) {
                scadInstallationChecked = true;
                cachedScadPath = fallbackPath;
                return fallbackPath;
            }
            console.log(`System OpenSCAD at ${fallbackPath} does not support Manifold.`);
        } else if (fallbackPath) {
            console.warn(`Configured OpenSCAD path does not exist: ${fallbackPath}`);
            fallbackPath = undefined;
        }

        // 2. Prompt for manual update if no compatible version is found
        const msg = fallbackPath 
            ? `Your OpenSCAD (${fallbackPath}) is out of date. A version with "Manifold" engine support is required for optimal performance.`
            : `OpenSCAD was not found. Please install a version with "Manifold" engine support to use the 3D preview.`;
            
        const selection = await vscode.window.showInformationMessage(msg, 'How to Update', 'Use anyway (Legacy)');

        if (selection === 'How to Update') {
            showUpgradeGuidance();
        } else if (selection === 'Use anyway (Legacy)') {
            if (fallbackPath) {
                scadInstallationChecked = true;
                cachedScadPath = fallbackPath;
                return fallbackPath;
            } else {
                vscode.window.showErrorMessage('No OpenSCAD installation found. Please install OpenSCAD or specify the path in settings.');
            }
        }
        
        return undefined;
    };

    const showUpgradeGuidance = () => {
        const platform = os.platform();
        let guidance = 'To use the high-performance Manifold engine, you need a recent version of OpenSCAD (preferably a Development Snapshot).\n\n';
        
        if (platform === 'darwin') {
            guidance += 'Recommended for macOS:\n';
            guidance += '• Run: brew install --cask openscad@snapshot\n';
            guidance += '• Or download from: openscad.org/downloads.html';
        } else if (platform === 'win32') {
            guidance += 'Recommended for Windows:\n';
            guidance += '• Run: winget install OpenSCAD.OpenSCAD.Snapshots\n';
            guidance += '• Or download from: openscad.org/downloads.html';
        } else {
            guidance += 'Recommended for Linux:\n';
            guidance += '• Use the official AppImage from openscad.org\n';
            guidance += '• Or for Ubuntu: sudo add-apt-repository ppa:openscad/releases && sudo apt update && sudo apt install openscad';
        }

        vscode.window.showInformationMessage(guidance, { modal: true }, 'Open Downloads Page').then(selection => {
            if (selection === 'Open Downloads Page') {
                vscode.env.openExternal(vscode.Uri.parse('https://openscad.org/downloads.html'));
            }
        });
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('scadRenderer.executablePath')) {
                scadInstallationChecked = false;
                cachedScadPath = undefined;
            }
        })
    );

    // Register tools, chat and AI commands
    registerScadTools(context);
    let contextualFileUri: vscode.Uri | undefined;
    const setContextualUri = (uri: vscode.Uri | undefined) => { contextualFileUri = uri; };
    const getContextualUri = () => contextualFileUri;
    registerChatParticipant(context, setContextualUri, getContextualUri);
    registerAiCommands(context, setContextualUri);

    context.subscriptions.push(
        vscode.commands.registerCommand('scad-renderer.preview', async (uri?: vscode.Uri) => {
            let documentUri = uri;

            if (!documentUri) {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active editor.');
                    return;
                }
                documentUri = editor.document.uri;
            }

            if (!documentUri.fsPath.endsWith('.scad')) {
                vscode.window.showErrorMessage('The selected file is not a SCAD file.');
                return;
            }

            sendEvent('preview.opened', { documentExtension: '.scad' });

            const execPath = await checkScadInstallation();
            if (execPath) {
                PreviewPanel.createOrShow(context.extensionUri, execPath, documentUri);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('scad-renderer.reportIssue', () => {
            vscode.env.openExternal(vscode.Uri.parse(
                'https://github.com/luizbon/vscode-scad-renderer/issues/new?template=bug_report.md'
            ));
        })
    );

    // Update if active preview panel is looking at the saved document
    vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'scad') {
            const panel = PreviewPanel.panels.get(document.uri.toString());
            if (panel) {
                const execPath = await checkScadInstallation();
                if (execPath) {
                    panel.renderScad(execPath, document.uri);
                }
            }
        }
    }, null, context.subscriptions);
}

export function deactivate() {}

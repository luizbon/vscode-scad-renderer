import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class InstructionManager {
    private static readonly AGENT_FILE = 'AGENTS.md';
    private static readonly CONTENT = `# SCAD Renderer Project: AI & Orchestration Instructions

This ecosystem uses a **Multi-Agent 3D Pipeline** to produce production-grade, FDM-printable OpenSCAD models.

## The Agentic Flow
The session is managed by an **Orchestrator** that delegates to specialized roles. Every role except the Coder is **forbidden from writing code**.

1.  **Orchestrator (@scad-orchestrator):** Leads the process, manages state, and coordinates fixes.
2.  **Designer (@scad-designer):** Conducts interviews. Reports to Orchestrator.
3.  **Reviewer (@scad-reviewer):** Critiques design (Pre-code) and execution (Post-code). Reports to Orchestrator.
4.  **Debugger (@scad-debugger):** Diagnoses render errors. Reports to Orchestrator.
5.  **Coder (@scad-coder):** The ONLY agent authorized to write and fix code. Uses **TDD**.
6.  **QA Specialist (@scad-qa):** Final visual verification. Reports to Orchestrator.

## Agentic Interaction Guidelines
- **Strict Role Separation:** Reviewers, Debuggers, and QA specialists identify issues but DO NOT provide code fixes. They report findings back to the Orchestrator.
- **TDD Requirement:** The Coder MUST call \`scad_renderer_update_code\` iteratively.
- **Visual Evidence:** The QA Agent MUST capture a screenshot (\`scad_renderer_capture_preview\`) for final verification.
- **Australian English:** Always use Australian spelling.

## Tool Access
- \`scad_renderer_render\`: Refreshes 3D preview.
- \`scad_renderer_capture_preview\`: Captures visual evidence.
- \`scad_renderer_update_code\`: Stages code, renders, and returns success/error logs.
`;

    public static async checkAndPrompt(context: vscode.ExtensionContext) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders) return;

        for (const folder of folders) {
            const workspacePath = folder.uri.fsPath;
            
            // Check if this project is 3D related (contains .scad files or has a scad-related name)
            const isScadProject = await InstructionManager.detectScadProject(workspacePath);
            if (!isScadProject) continue;

            const agentsFile = path.join(workspacePath, InstructionManager.AGENT_FILE);
            const exists = fs.existsSync(agentsFile);

            if (exists) {
                // If it exists, only update if user approves
                const currentContent = fs.readFileSync(agentsFile, 'utf8');
                if (currentContent.trim() !== InstructionManager.CONTENT.trim()) {
                    const selection = await vscode.window.showInformationMessage(
                        `VSCode SCAD Renderer: A newer version of the AI instructions (AGENTS.md) is available for this project. Update it?`,
                        'Update AGENTS.md',
                        'Not Now'
                    );
                    if (selection === 'Update AGENTS.md') {
                        fs.writeFileSync(agentsFile, InstructionManager.CONTENT);
                    }
                }
            } else {
                // Not exists, ask to create
                const selection = await vscode.window.showInformationMessage(
                    `VSCode SCAD Renderer: This looks like a 3D printing project. Create AGENTS.md to enable context-aware AI assistants (GitHub Copilot, Gemini, Claude)?`,
                    'Create AGENTS.md',
                    'Not Now'
                );
                if (selection === 'Create AGENTS.md') {
                    fs.writeFileSync(agentsFile, InstructionManager.CONTENT);
                }
            }
        }
    }

    private static async detectScadProject(root: string): Promise<boolean> {
        // Simple detection: find any 3D-related file or check name
        try {
            const files = fs.readdirSync(root);
            const has3DFile = files.some(f => {
                const ext = path.extname(f).toLowerCase();
                return ext === '.scad' || ext === '.stl' || ext === '.3mf';
            });
            if (has3DFile) return true;
            
            const isScadName = root.toLowerCase().includes('scad') || root.toLowerCase().includes('3d-print');
            if (isScadName) return true;
        } catch (e) {
            // Permission errors etc
        }
        return false;
    }
}

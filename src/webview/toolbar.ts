export type RenderMode = 'solid' | 'wireframe' | 'xray';
export type CameraProjection = 'perspective' | 'orthographic';

export interface ToolbarCallbacks {
    onRenderModeChange: (mode: RenderMode) => void;
    onCameraProjectionChange: (projection: CameraProjection) => void;
    onShadowsChange: (enabled: boolean) => void;
    onExport: () => void;
}

export class Toolbar {
    private container: HTMLDivElement;
    private renderMode: RenderMode = 'solid';
    private cameraProjection: CameraProjection = 'perspective';
    private shadowsEnabled: boolean = true;

    private renderButtons: Map<RenderMode, HTMLButtonElement> = new Map();
    private cameraButton!: HTMLButtonElement;
    private shadowsButton!: HTMLButtonElement;

    constructor(
        onRenderModeChange: (mode: RenderMode) => void,
        onCameraProjectionChange: (projection: CameraProjection) => void,
        onShadowsChange: (enabled: boolean) => void,
        onExport: () => void
    ) {
        const callbacks: ToolbarCallbacks = { onRenderModeChange, onCameraProjectionChange, onShadowsChange, onExport };

        this.container = document.createElement('div');
        this.applyContainerStyle();
        this.buildToolbar(callbacks);
        document.body.appendChild(this.container);
    }

    private applyContainerStyle() {
        const s = this.container.style;
        s.position = 'absolute';
        s.top = '0.5rem';
        s.left = '0.5rem';
        s.zIndex = '100';
        s.display = 'flex';
        s.flexDirection = 'row';
        s.gap = '4px';
        s.padding = '4px 6px';
        s.background = 'rgba(30,30,30,0.75)';
        s.borderRadius = '4px';
        s.backdropFilter = 'blur(4px)';
        s.fontFamily = 'var(--vscode-font-family, sans-serif)';
        s.fontSize = '11px';
        s.userSelect = 'none';
        s.alignItems = 'center';
    }

    private createButton(label: string): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.textContent = label;
        const s = btn.style;
        s.padding = '3px 8px';
        s.border = '1px solid rgba(255,255,255,0.15)';
        s.borderRadius = '3px';
        s.cursor = 'pointer';
        s.fontSize = '11px';
        s.fontFamily = 'inherit';
        s.background = 'var(--vscode-button-secondaryBackground, rgba(60,60,60,0.9))';
        s.color = 'var(--vscode-button-secondaryForeground, #cccccc)';
        s.outline = 'none';
        s.transition = 'background 0.15s, color 0.15s';
        return btn;
    }

    private setActiveStyle(btn: HTMLButtonElement, active: boolean) {
        if (active) {
            btn.style.background = 'var(--vscode-button-background, #0e639c)';
            btn.style.color = 'var(--vscode-button-foreground, #ffffff)';
        } else {
            btn.style.background = 'var(--vscode-button-secondaryBackground, rgba(60,60,60,0.9))';
            btn.style.color = 'var(--vscode-button-secondaryForeground, #cccccc)';
        }
    }

    private addSeparator() {
        const sep = document.createElement('div');
        sep.style.width = '1px';
        sep.style.height = '16px';
        sep.style.background = 'rgba(255,255,255,0.15)';
        sep.style.margin = '0 2px';
        this.container.appendChild(sep);
    }

    private buildToolbar(callbacks: ToolbarCallbacks) {
        // --- Render mode buttons ---
        const renderModes: Array<{ mode: RenderMode; label: string }> = [
            { mode: 'solid', label: 'Solid' },
            { mode: 'wireframe', label: 'Wireframe' },
            { mode: 'xray', label: 'X-Ray' },
        ];

        for (const { mode, label } of renderModes) {
            const btn = this.createButton(label);
            this.setActiveStyle(btn, mode === this.renderMode);
            btn.addEventListener('click', () => {
                this.renderMode = mode;
                this.renderButtons.forEach((b, m) => this.setActiveStyle(b, m === mode));
                callbacks.onRenderModeChange(mode);
            });
            this.renderButtons.set(mode, btn);
            this.container.appendChild(btn);
        }

        this.addSeparator();

        // --- Camera projection toggle ---
        this.cameraButton = this.createButton('Perspective');
        this.cameraButton.addEventListener('click', () => {
            this.cameraProjection = this.cameraProjection === 'perspective' ? 'orthographic' : 'perspective';
            this.cameraButton.textContent = this.cameraProjection === 'perspective' ? 'Perspective' : 'Orthographic';
            this.setActiveStyle(this.cameraButton, this.cameraProjection === 'orthographic');
            callbacks.onCameraProjectionChange(this.cameraProjection);
        });
        this.container.appendChild(this.cameraButton);

        this.addSeparator();

        // --- Shadows toggle ---
        this.shadowsButton = this.createButton('Shadows On');
        this.setActiveStyle(this.shadowsButton, true);
        this.shadowsButton.addEventListener('click', () => {
            this.shadowsEnabled = !this.shadowsEnabled;
            this.shadowsButton.textContent = this.shadowsEnabled ? 'Shadows On' : 'Shadows Off';
            this.setActiveStyle(this.shadowsButton, this.shadowsEnabled);
            callbacks.onShadowsChange(this.shadowsEnabled);
        });
        this.container.appendChild(this.shadowsButton);

        this.addSeparator();

        // --- Export button ---
        const exportBtn = this.createButton('⬇ Export 3MF');
        exportBtn.title = 'Export 3MF with current parameter values';
        exportBtn.addEventListener('click', () => callbacks.onExport());
        this.container.appendChild(exportBtn);
    }
}

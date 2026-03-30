import type { ScadParameter, ParameterValue } from '../shared/messages';

export type ParameterChangedCallback = (name: string, value: ParameterValue, instant: boolean) => void;

export class Customizer {
    private currentParametersStr = '';
    private onParameterChanged: ParameterChangedCallback;

    constructor(onParameterChanged: ParameterChangedCallback) {
        this.onParameterChanged = onParameterChanged;
    }

    public render(parameters: ScadParameter[], overrides: Record<string, ParameterValue>) {
        let toggleBtn = document.getElementById('scad-drawer-toggle');
        let drawer = document.getElementById('scad-customizer-drawer');

        if (!parameters || parameters.length === 0) {
            if (toggleBtn) { toggleBtn.style.display = 'none'; }
            if (drawer) { drawer.style.display = 'none'; }
            return;
        }

        const paramStr = JSON.stringify(parameters);

        if (!toggleBtn) {
            toggleBtn = document.createElement('div');
            toggleBtn.id = 'scad-drawer-toggle';
            toggleBtn.textContent = '⚙️ Customizer';
            toggleBtn.style.position = 'absolute';
            toggleBtn.style.top = '15px';
            toggleBtn.style.right = '15px';
            toggleBtn.style.background = 'var(--vscode-button-background)';
            toggleBtn.style.color = 'var(--vscode-button-foreground)';
            toggleBtn.style.padding = '8px 12px';
            toggleBtn.style.borderRadius = '4px';
            toggleBtn.style.cursor = 'pointer';
            toggleBtn.style.zIndex = '90';
            toggleBtn.style.fontFamily = 'var(--vscode-font-family)';
            toggleBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

            toggleBtn.addEventListener('click', () => {
                const d = document.getElementById('scad-customizer-drawer');
                if (d) { d.style.transform = 'translateX(0)'; }
            });
            document.body.appendChild(toggleBtn);
        }
        toggleBtn.style.display = 'block';

        // Only rebuild DOM if structure changed
        if (!drawer || this.currentParametersStr !== paramStr) {
            if (!drawer) {
                drawer = document.createElement('div');
                drawer.id = 'scad-customizer-drawer';
                drawer.style.position = 'absolute';
                drawer.style.top = '0';
                drawer.style.right = '0';
                drawer.style.bottom = '0';
                drawer.style.width = '320px';
                drawer.style.minWidth = '200px';
                drawer.style.maxWidth = '800px';
                drawer.style.background = 'var(--vscode-editor-background)';
                drawer.style.borderLeft = '1px solid var(--vscode-widget-border)';
                drawer.style.boxShadow = '-4px 0 10px rgba(0,0,0,0.3)';
                drawer.style.color = 'var(--vscode-editor-foreground)';
                drawer.style.fontFamily = 'var(--vscode-font-family)';
                drawer.style.overflowY = 'auto';
                drawer.style.overflowX = 'hidden';
                drawer.style.resize = 'horizontal';
                drawer.style.direction = 'rtl'; // puts the scrollbar/resizer on the left
                drawer.style.zIndex = '100';
                // Start open
                drawer.style.transform = 'translateX(0)';
                drawer.style.transition = 'transform 0.3s ease-in-out';
                document.body.appendChild(drawer);
            }

            drawer.innerHTML = '';
            this.currentParametersStr = paramStr;

            // wrapper to restore text direction LTR
            const contentWrapper = document.createElement('div');
            contentWrapper.style.direction = 'ltr';
            contentWrapper.style.padding = '20px';
            contentWrapper.style.minHeight = '100%';

            const headerRow = document.createElement('div');
            headerRow.style.display = 'flex';
            headerRow.style.justifyContent = 'space-between';
            headerRow.style.alignItems = 'center';
            headerRow.style.borderBottom = '1px solid var(--vscode-widget-border)';
            headerRow.style.paddingBottom = '10px';
            headerRow.style.marginBottom = '20px';

            const title = document.createElement('h3');
            title.textContent = 'Customizer';
            title.style.margin = '0';
            headerRow.appendChild(title);

            const closeBtn = document.createElement('div');
            closeBtn.innerHTML = '&#x2715;'; // X mark
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.padding = '4px 8px';
            closeBtn.style.opacity = '0.8';
            closeBtn.onmouseover = () => { closeBtn.style.opacity = '1'; };
            closeBtn.onmouseleave = () => { closeBtn.style.opacity = '0.8'; };
            closeBtn.addEventListener('click', () => {
                const d = document.getElementById('scad-customizer-drawer');
                if (d) { d.style.transform = 'translateX(100%)'; }
            });
            headerRow.appendChild(closeBtn);

            contentWrapper.appendChild(headerRow);

            const form = document.createElement('div');
            form.style.display = 'flex';
            form.style.flexDirection = 'column';
            form.style.gap = '15px';

            parameters.forEach(param => {
                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.flexDirection = 'column';
                wrapper.style.gap = '6px';

                const label = document.createElement('label');
                label.textContent = param.caption || param.name;
                label.style.fontWeight = 'bold';
                label.style.fontSize = '12px';
                wrapper.appendChild(label);

                const input = this.buildInput(param, overrides);
                wrapper.appendChild(input);
                form.appendChild(wrapper);
            });

            contentWrapper.appendChild(form);
            drawer.appendChild(contentWrapper);
        } else {
            // Just sync values to avoid dropping text focus unless structural
            parameters.forEach(param => {
                const val = overrides[param.name] ?? param.initial;
                const el = document.getElementById('param_' + param.name);
                if (el) {
                    if (param.type === 'boolean') {
                        (el as HTMLInputElement).checked = !!val;
                    } else if (!param.options && param.type === 'number') {
                        (el as HTMLInputElement).value = val.toString();
                        // Sync parallel range slider if exists
                        const possibleRange = el.previousElementSibling;
                        if (possibleRange && (possibleRange as HTMLInputElement).type === 'range') {
                            (possibleRange as HTMLInputElement).value = val.toString();
                        }
                    } else {
                        (el as HTMLInputElement).value = val.toString();
                    }
                }
            });
        }
    }

    private buildInput(param: ScadParameter, overrides: Record<string, ParameterValue>): HTMLElement {
        if (param.type === 'boolean') {
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.id = 'param_' + param.name;
            input.checked = !!(overrides[param.name] ?? param.initial);
            input.addEventListener('change', (e) => {
                this.onParameterChanged(param.name, (e.target as HTMLInputElement).checked, true);
            });
            return input;
        }

        if (param.options && Array.isArray(param.options)) {
            const input = document.createElement('select');
            input.id = 'param_' + param.name;
            input.style.background = 'var(--vscode-dropdown-background)';
            input.style.color = 'var(--vscode-dropdown-foreground)';
            input.style.border = '1px solid var(--vscode-dropdown-border)';
            input.style.padding = '4px';

            param.options.forEach((opt) => {
                const option = document.createElement('option');
                option.value = opt.value.toString();
                option.textContent = opt.name ? opt.name.toString() : opt.value.toString();
                input.appendChild(option);
            });

            const curVal = (overrides[param.name] ?? param.initial).toString();
            input.value = curVal;

            input.addEventListener('change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                const parsedVal = param.type === 'number' ? parseFloat(val) : val;
                this.onParameterChanged(param.name, parsedVal, true);
            });
            return input;
        }

        if (param.type === 'number') {
            const container = document.createElement('div');
            container.style.display = 'flex';
            container.style.gap = '8px';

            const val = overrides[param.name] ?? param.initial;

            const numHtml = document.createElement('input');
            numHtml.type = 'number';
            numHtml.id = 'param_' + param.name;
            if (param.min !== undefined) { numHtml.min = param.min.toString(); }
            if (param.max !== undefined) { numHtml.max = param.max.toString(); }
            if (param.step !== undefined) { numHtml.step = param.step.toString(); }
            numHtml.value = val.toString();
            numHtml.style.background = 'var(--vscode-input-background)';
            numHtml.style.color = 'var(--vscode-input-foreground)';
            numHtml.style.border = '1px solid var(--vscode-input-border)';
            numHtml.style.width = '60px';

            let rangeHtml: HTMLInputElement | null = null;
            if (param.min !== undefined && param.max !== undefined) {
                rangeHtml = document.createElement('input');
                rangeHtml.type = 'range';
                rangeHtml.min = param.min.toString();
                rangeHtml.max = param.max.toString();
                if (param.step !== undefined) { rangeHtml.step = param.step.toString(); }
                rangeHtml.value = val.toString();
                rangeHtml.style.flexGrow = '1';

                rangeHtml.addEventListener('input', (e) => {
                    const targetVal = (e.target as HTMLInputElement).value;
                    numHtml.value = targetVal;
                    this.onParameterChanged(param.name, parseFloat(targetVal), false);
                });
            }

            numHtml.addEventListener('input', (e) => {
                const targetVal = parseFloat((e.target as HTMLInputElement).value);
                if (rangeHtml) { rangeHtml.value = targetVal.toString(); }
                this.onParameterChanged(param.name, targetVal, false);
            });

            if (rangeHtml) { container.appendChild(rangeHtml); }
            container.appendChild(numHtml);
            return container;
        }

        // String or arbitrary
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'param_' + param.name;
        input.value = (overrides[param.name] ?? param.initial).toString();
        input.style.background = 'var(--vscode-input-background)';
        input.style.color = 'var(--vscode-input-foreground)';
        input.style.border = '1px solid var(--vscode-input-border)';
        input.style.padding = '4px';

        input.addEventListener('input', (e) => {
            this.onParameterChanged(param.name, (e.target as HTMLInputElement).value, false);
        });
        return input;
    }
}

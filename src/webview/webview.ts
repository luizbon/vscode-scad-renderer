import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// @ts-ignore
const vscode = acquireVsCodeApi();

// OpenSCAD uses Z as up, Three.js defaults to Y as up.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let currentMesh: THREE.Mesh | null = null;
let stlLoader = new STLLoader();

let currentParametersStr = '';
let debounceTimer: any = null;

function init() {
    // SCENE
    scene = new THREE.Scene();
    
    // Attempt to match VSCode theme background
    const bodyStyles = window.getComputedStyle(document.body);
    const bgColor = bodyStyles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    scene.background = new THREE.Color(bgColor);

    // CAMERA
    camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 10000);
    camera.position.set(100, 100, 100);

    // RENDERER
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        preserveDrawingBuffer: true // Required for toDataURL() to work reliably
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // CONTROLS
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;

    // LIGHTING (OpenSCAD style styling)
    const ambientLight = new THREE.AmbientLight(0x555555);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight1.position.set(200, 200, 200);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight2.position.set(-200, -200, 50);
    scene.add(dirLight2);

    // ENVIRONMENT HELPERS
    // Grid matches OpenSCAD floor
    const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
    // Grid is default drawn on XZ plane, so rotate it to XY plane (for Z-up)
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Axes matches OpenSCAD axes (Red=X, Green=Y, Blue=Z)
    const axesHelper = new THREE.AxesHelper(100);
    scene.add(axesHelper);

    window.addEventListener('resize', onWindowResize, false);
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

function loadStl(buffer: ArrayBuffer) {
    try {
        const geometry = stlLoader.parse(buffer);
        
        // Classic OpenSCAD Yellow Material
        const material = new THREE.MeshPhongMaterial({ 
            color: 0xf5d44f, 
            specular: 0x111111, 
            shininess: 50,
            flatShading: true // Gives that crisp faceted look
        });
        
        if (currentMesh) {
            scene.remove(currentMesh);
            currentMesh.geometry.dispose();
            (currentMesh.material as THREE.Material).dispose();
        }

        currentMesh = new THREE.Mesh(geometry, material);
        
        // Center the geometry
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (box) {
            const center = new THREE.Vector3();
            box.getCenter(center);
            geometry.translate(-center.x, -center.y, -center.z);
            
            // Adjust camera to fit
            const size = new THREE.Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = camera.fov * (Math.PI / 180);
            let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
            cameraZ *= 2.0; // Zoom out a little
            camera.position.set(cameraZ, cameraZ, cameraZ);
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
        }

        scene.add(currentMesh);
    } catch (e) {
        console.error('Failed to parse STL arraybuffer:', e);
    }
}

function updateParameter(name: string, value: any, instant: boolean = false) {
    if (debounceTimer) clearTimeout(debounceTimer);
    
    const send = () => {
        vscode.postMessage({ command: 'parameterChanged', name, value });
    };

    if (instant) {
        send();
    } else {
        debounceTimer = setTimeout(send, 400); // 400ms debounce
    }
}

function renderCustomizer(parameters: any[], overrides: Record<string, any>) {
    let toggleBtn = document.getElementById('scad-drawer-toggle');
    let drawer = document.getElementById('scad-customizer-drawer');
    
    if (!parameters || parameters.length === 0) {
        if (toggleBtn) toggleBtn.style.display = 'none';
        if (drawer) drawer.style.display = 'none';
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
            if (drawer) drawer.style.transform = 'translateX(0)';
        });
        document.body.appendChild(toggleBtn);
    }
    toggleBtn.style.display = 'block';

    // Only rebuild DOM if structure changed
    if (!drawer || currentParametersStr !== paramStr) {
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
        currentParametersStr = paramStr;

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
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseleave = () => closeBtn.style.opacity = '0.8';
        closeBtn.addEventListener('click', () => {
            drawer!.style.transform = 'translateX(100%)';
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

            let input: HTMLElement;

            if (param.type === 'boolean') {
                input = document.createElement('input');
                (input as HTMLInputElement).type = 'checkbox';
                input.id = 'param_' + param.name;
                (input as HTMLInputElement).checked = overrides[param.name] ?? param.initial;
                
                input.addEventListener('change', (e) => {
                    updateParameter(param.name, (e.target as HTMLInputElement).checked, true);
                });
            } else if (param.options && Array.isArray(param.options)) {
                input = document.createElement('select');
                input.id = 'param_' + param.name;
                input.style.background = 'var(--vscode-dropdown-background)';
                input.style.color = 'var(--vscode-dropdown-foreground)';
                input.style.border = '1px solid var(--vscode-dropdown-border)';
                input.style.padding = '4px';

                param.options.forEach((opt: any) => {
                    const option = document.createElement('option');
                    option.value = opt.value.toString();
                    option.textContent = opt.name ? opt.name.toString() : opt.value.toString();
                    (input as HTMLSelectElement).appendChild(option);
                });
                
                const curVal = (overrides[param.name] ?? param.initial).toString();
                (input as HTMLSelectElement).value = curVal;
                
                input.addEventListener('change', (e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    const parsedVal = param.type === 'number' ? parseFloat(val) : val;
                    updateParameter(param.name, parsedVal, true);
                });
            } else if (param.type === 'number') {
                input = document.createElement('div');
                input.style.display = 'flex';
                input.style.gap = '8px';
                
                const val = overrides[param.name] ?? param.initial;

                const numHtml = document.createElement('input');
                numHtml.type = 'number';
                numHtml.id = 'param_' + param.name;
                if (param.min !== undefined) numHtml.min = param.min.toString();
                if (param.max !== undefined) numHtml.max = param.max.toString();
                if (param.step !== undefined) numHtml.step = param.step.toString();
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
                    if (param.step !== undefined) rangeHtml.step = param.step.toString();
                    rangeHtml.value = val.toString();
                    rangeHtml.style.flexGrow = '1';
                    
                    rangeHtml.addEventListener('input', (e) => {
                        const targetVal = (e.target as HTMLInputElement).value;
                        numHtml.value = targetVal;
                        updateParameter(param.name, parseFloat(targetVal), false);
                    });
                }
                
                numHtml.addEventListener('input', (e) => {
                    const targetVal = parseFloat((e.target as HTMLInputElement).value);
                    if (rangeHtml) rangeHtml.value = targetVal.toString();
                    updateParameter(param.name, targetVal, false);
                });

                if (rangeHtml) input.appendChild(rangeHtml);
                input.appendChild(numHtml);
            } else {
                // String or arbitrary
                input = document.createElement('input');
                (input as HTMLInputElement).type = 'text';
                input.id = 'param_' + param.name;
                (input as HTMLInputElement).value = (overrides[param.name] ?? param.initial).toString();
                input.style.background = 'var(--vscode-input-background)';
                input.style.color = 'var(--vscode-input-foreground)';
                input.style.border = '1px solid var(--vscode-input-border)';
                input.style.padding = '4px';
                
                input.addEventListener('input', (e) => {
                    updateParameter(param.name, (e.target as HTMLInputElement).value, false);
                });
            }

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

window.addEventListener('message', event => {
    const message = event.data;
    if (message.command === 'updateSTL') {
        const arr = message.data as ArrayBuffer;
        if (arr && arr.byteLength > 0) {
            loadStl(arr);
        }
    } else if (message.command === 'error') {
        showError(message.message);
    } else if (message.command === 'capturePreview') {
        // Redraw scene to make sure we have current frame in the buffer
        renderer.render(scene, camera);
        const dataUrl = renderer.domElement.toDataURL('image/png');
        vscode.postMessage({ command: 'previewCaptured', data: dataUrl });
    }
});

function showError(msg: string) {
    let overlay = document.getElementById('error-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'error-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '20px';
        overlay.style.left = '20px';
        overlay.style.right = '20px';
        overlay.style.background = 'rgba(255, 68, 68, 0.9)';
        overlay.style.color = 'white';
        overlay.style.padding = '15px';
        overlay.style.borderRadius = '5px';
        overlay.style.zIndex = '1000';
        overlay.style.fontFamily = 'var(--vscode-editor-font-family, monospace)';
        overlay.style.fontSize = '13px';
        overlay.style.whiteSpace = 'pre-wrap';
        overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
        
        const close = document.createElement('div');
        close.innerHTML = '&#x2715;';
        close.style.position = 'absolute';
        close.style.top = '5px';
        close.style.right = '8px';
        close.style.cursor = 'pointer';
        close.onclick = () => overlay!.style.display = 'none';
        overlay.appendChild(close);
        
        const title = document.createElement('div');
        title.textContent = 'OpenSCAD Render Error';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '8px';
        title.style.borderBottom = '1px solid rgba(255,255,255,0.3)';
        title.style.paddingBottom = '5px';
        overlay.appendChild(title);

        const content = document.createElement('div');
        content.id = 'error-content';
        overlay.appendChild(content);

        document.body.appendChild(overlay);
    }
    
    const content = document.getElementById('error-content');
    if (content) content.textContent = msg;
    overlay.style.display = 'block';
}

// Initialize the 3D viewer
init();

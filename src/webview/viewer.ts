import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a CSS colour string (hex or rgb/rgba) and return a hex number. */
function parseCssColor(cssColor: string): number {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = cssColor;
    const resolved = ctx.fillStyle as string; // browser normalises to #rrggbb
    return parseInt(resolved.replace('#', '0x'), 16);
}

/** Return perceived luminance (0–1) for a hex colour number. */
function luminance(hex: number): number {
    const r = ((hex >> 16) & 0xff) / 255;
    const g = ((hex >> 8) & 0xff) / 255;
    const b = (hex & 0xff) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// AxesWidget — mini 96x96 renderer in the top-right corner
// ---------------------------------------------------------------------------

class AxesWidget {
    private renderer: THREE.WebGLRenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;

    constructor(container: HTMLElement) {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
        this.camera.position.set(0, 0, 7);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(96, 96);
        this.renderer.setPixelRatio(window.devicePixelRatio);

        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.top = '1rem';
        canvas.style.right = '1rem';
        canvas.style.pointerEvents = 'none';
        container.appendChild(canvas);

        // Axes helper — OpenSCAD: X=red, Y=blue, Z=green
        const axes = new THREE.AxesHelper(2);
        // AxesHelper default: X=red, Y=green, Z=blue — recolour to match OpenSCAD
        const colors = axes.geometry.attributes.color as THREE.BufferAttribute;
        // Vertex order: X start(0), X end(1), Y start(2), Y end(3), Z start(4), Z end(5)
        // X → red (1,0,0), Y → blue (0,0,1), Z → green (0,1,0)
        const axisColors = [
            [1, 0, 0], [1, 0, 0], // X
            [0, 0, 1], [0, 0, 1], // Y
            [0, 1, 0], [0, 1, 0], // Z
        ];
        for (let i = 0; i < axisColors.length; i++) {
            colors.setXYZ(i, axisColors[i][0], axisColors[i][1], axisColors[i][2]);
        }
        colors.needsUpdate = true;
        this.scene.add(axes);

        // Sprite labels
        this.addLabel('X', 2.4, 0, 0, '#ff0000');
        this.addLabel('Y', 0, 2.4, 0, '#0000ff');
        this.addLabel('Z', 0, 0, 2.4, '#00ff00');
    }

    private addLabel(text: string, x: number, y: number, z: number, color: string) {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = color;
        ctx.font = `bold ${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, size / 2, size / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(x, y, z);
        sprite.scale.set(0.6, 0.6, 0.6);
        this.scene.add(sprite);
    }

    public update(mainCamera: THREE.Camera) {
        // Mirror main camera orientation, fixed distance
        this.camera.quaternion.copy(mainCamera.quaternion);
        this.camera.position.set(0, 0, 0)
            .addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(mainCamera.quaternion), 7);
        this.renderer.render(this.scene, this.camera);
    }

    public dispose() {
        this.renderer.dispose();
    }
}

// ---------------------------------------------------------------------------
// Viewer
// ---------------------------------------------------------------------------

export class Viewer {
    private scene: THREE.Scene;
    private persCamera: THREE.PerspectiveCamera;
    private orthoCamera: THREE.OrthographicCamera;
    private activeCamera: THREE.Camera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private currentMesh: THREE.Mesh | null = null;
    private stlLoader = new STLLoader();
    private axesWidget: AxesWidget;
    private gridHelper: THREE.GridHelper | null = null;

    constructor() {
        // OpenSCAD uses Z as up
        THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

        this.scene = new THREE.Scene();

        const bgColor = this.readBgColor();
        this.applyBackground(bgColor);

        // --- Cameras ---
        const aspect = window.innerWidth / window.innerHeight;
        this.persCamera = new THREE.PerspectiveCamera(75, aspect, 0.1, 10000);
        this.persCamera.position.set(0, 100, 200);

        const viewSize = 100;
        this.orthoCamera = new THREE.OrthographicCamera(
            -viewSize * aspect / 2, viewSize * aspect / 2,
            viewSize / 2, -viewSize / 2,
            0.1, 10000
        );
        this.orthoCamera.position.set(0, 100, 200);

        this.activeCamera = this.persCamera;

        // --- Renderer ---
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // --- Controls ---
        this.controls = new OrbitControls(this.persCamera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;

        // Keep ortho camera in sync with perspective camera
        this.controls.addEventListener('change', () => this.syncCameras());

        // --- Lighting ---
        const ambient = new THREE.AmbientLight(0xffffff, 0.25 * Math.PI);
        this.scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
        dirLight.position.set(100, 200, 50);
        dirLight.castShadow = true;
        this.scene.add(dirLight);

        const spotLight = new THREE.SpotLight(0xffffff, 0.5 * Math.PI, 0, 0.15, 1, 0);
        spotLight.position.set(200, 200, 200);
        spotLight.castShadow = true;
        this.scene.add(spotLight);

        const pointLight = new THREE.PointLight(0xffffff, 0.25 * Math.PI, 0, 0);
        pointLight.position.set(-200, -200, -200);
        this.scene.add(pointLight);

        // --- Grid ---
        this.rebuildGrid(bgColor);

        // --- Axes widget ---
        this.axesWidget = new AxesWidget(document.body);

        window.addEventListener('resize', this.onWindowResize.bind(this), false);
        this.animate();
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private readBgColor(): string {
        const bodyStyles = window.getComputedStyle(document.body);
        return bodyStyles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
    }

    private applyBackground(bgColor: string) {
        const hex = parseCssColor(bgColor);
        this.scene.background = new THREE.Color(hex);
        this.scene.fog = new THREE.FogExp2(hex, 0.002);
    }

    private rebuildGrid(bgColor: string) {
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper.dispose();
        }
        const hex = parseCssColor(bgColor);
        const dark = luminance(hex) < 0.5;
        const majorColor = dark ? 0x888888 : 0x444444;
        const minorColor = dark ? 0x444444 : 0x888888;
        this.gridHelper = new THREE.GridHelper(10000, 1000, majorColor, minorColor);
        this.gridHelper.rotation.x = Math.PI / 2;
        this.scene.add(this.gridHelper);
    }

    private syncCameras() {
        this.orthoCamera.position.copy(this.persCamera.position);
        this.orthoCamera.quaternion.copy(this.persCamera.quaternion);
        this.orthoCamera.updateMatrixWorld();
    }

    private onWindowResize() {
        const aspect = window.innerWidth / window.innerHeight;

        this.persCamera.aspect = aspect;
        this.persCamera.updateProjectionMatrix();

        const viewSize = this.getOrthoViewSize();
        this.orthoCamera.left = -viewSize * aspect / 2;
        this.orthoCamera.right = viewSize * aspect / 2;
        this.orthoCamera.top = viewSize / 2;
        this.orthoCamera.bottom = -viewSize / 2;
        this.orthoCamera.updateProjectionMatrix();

        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private getOrthoViewSize(): number {
        // Derive ortho view size from camera distance to target
        const dist = this.persCamera.position.distanceTo(this.controls.target);
        const fovRad = this.persCamera.fov * (Math.PI / 180);
        return 2 * dist * Math.tan(fovRad / 2);
    }

    private animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.activeCamera);
        this.axesWidget.update(this.activeCamera);
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    public loadStl(buffer: ArrayBuffer) {
        try {
            const geometry = this.stlLoader.parse(buffer);

            const material = new THREE.MeshPhongMaterial({
                color: 0xf5d44f,
                specular: 0x111111,
                shininess: 50,
                flatShading: true
            });

            if (this.currentMesh) {
                this.scene.remove(this.currentMesh);
                this.currentMesh.geometry.dispose();
                (this.currentMesh.material as THREE.Material).dispose();
            }

            this.currentMesh = new THREE.Mesh(geometry, material);
            this.currentMesh.castShadow = true;
            this.currentMesh.receiveShadow = true;

            geometry.computeBoundingBox();
            const box = geometry.boundingBox;
            if (box) {
                const center = new THREE.Vector3();
                box.getCenter(center);
                geometry.translate(-center.x, -center.y, -center.z);

                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = this.persCamera.fov * (Math.PI / 180);
                const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 2.0;
                this.persCamera.position.set(cameraZ, cameraZ, cameraZ);
                this.persCamera.lookAt(0, 0, 0);
                this.controls.target.set(0, 0, 0);
                this.syncCameras();

                // Update ortho frustum to fit object
                const aspect = window.innerWidth / window.innerHeight;
                const vs = cameraZ * Math.tan(fov / 2) * 2;
                this.orthoCamera.left = -vs * aspect / 2;
                this.orthoCamera.right = vs * aspect / 2;
                this.orthoCamera.top = vs / 2;
                this.orthoCamera.bottom = -vs / 2;
                this.orthoCamera.updateProjectionMatrix();
            }

            this.scene.add(this.currentMesh);
        } catch (e) {
            console.error('Failed to parse STL arraybuffer:', e);
        }
    }

    public captureFrame(): string {
        this.renderer.render(this.scene, this.activeCamera);
        return this.renderer.domElement.toDataURL('image/png');
    }

    public setRenderMode(mode: 'solid' | 'wireframe' | 'xray') {
        if (!this.currentMesh) { return; }
        this.currentMesh.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) { return; }
            const mat = obj.material as THREE.MeshPhongMaterial;
            switch (mode) {
                case 'wireframe':
                    mat.wireframe = true;
                    mat.transparent = false;
                    mat.opacity = 1.0;
                    break;
                case 'xray':
                    mat.wireframe = false;
                    mat.transparent = true;
                    mat.opacity = 0.5;
                    break;
                case 'solid':
                    mat.wireframe = false;
                    mat.transparent = false;
                    mat.opacity = 1.0;
                    break;
            }
            mat.needsUpdate = true;
        });
    }

    public setCameraProjection(mode: 'perspective' | 'orthographic') {
        if (mode === 'perspective') {
            this.activeCamera = this.persCamera;
            // Re-attach controls to perspective camera
            this.controls.object = this.persCamera;
        } else {
            this.syncCameras();
            this.activeCamera = this.orthoCamera;
            this.controls.object = this.orthoCamera;
        }
        this.controls.update();
    }

    public setShadows(enabled: boolean) {
        this.renderer.shadowMap.enabled = enabled;
        if (this.currentMesh) {
            this.currentMesh.traverse((obj) => {
                if (obj instanceof THREE.Mesh) {
                    obj.castShadow = enabled;
                    obj.receiveShadow = enabled;
                }
            });
        }
    }

    public setTheme(bgColor: string) {
        this.applyBackground(bgColor);
        this.rebuildGrid(bgColor);
    }
}

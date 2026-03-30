import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// OpenSCAD uses Z as up, Three.js defaults to Y as up.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export class Viewer {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private currentMesh: THREE.Mesh | null = null;
    private stlLoader = new STLLoader();

    constructor() {
        // SCENE
        this.scene = new THREE.Scene();

        // Attempt to match VSCode theme background
        const bodyStyles = window.getComputedStyle(document.body);
        const bgColor = bodyStyles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e';
        this.scene.background = new THREE.Color(bgColor);

        // CAMERA
        this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 10000);
        this.camera.position.set(100, 100, 100);

        // RENDERER
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            preserveDrawingBuffer: true // Required for toDataURL() to work reliably
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        document.body.appendChild(this.renderer.domElement);

        // CONTROLS
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;

        // LIGHTING (OpenSCAD style)
        const ambientLight = new THREE.AmbientLight(0x555555);
        this.scene.add(ambientLight);

        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight1.position.set(200, 200, 200);
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.4);
        dirLight2.position.set(-200, -200, 50);
        this.scene.add(dirLight2);

        // ENVIRONMENT HELPERS
        // Grid matches OpenSCAD floor
        const gridHelper = new THREE.GridHelper(200, 20, 0x888888, 0x444444);
        // Grid is default drawn on XZ plane, so rotate it to XY plane (for Z-up)
        gridHelper.rotation.x = Math.PI / 2;
        this.scene.add(gridHelper);

        // Axes matches OpenSCAD axes (Red=X, Green=Y, Blue=Z)
        const axesHelper = new THREE.AxesHelper(100);
        this.scene.add(axesHelper);

        window.addEventListener('resize', this.onWindowResize.bind(this), false);
        this.animate();
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private animate() {
        requestAnimationFrame(this.animate.bind(this));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    public loadStl(buffer: ArrayBuffer) {
        try {
            const geometry = this.stlLoader.parse(buffer);

            // Classic OpenSCAD Yellow Material
            const material = new THREE.MeshPhongMaterial({
                color: 0xf5d44f,
                specular: 0x111111,
                shininess: 50,
                flatShading: true // Gives that crisp faceted look
            });

            if (this.currentMesh) {
                this.scene.remove(this.currentMesh);
                this.currentMesh.geometry.dispose();
                (this.currentMesh.material as THREE.Material).dispose();
            }

            this.currentMesh = new THREE.Mesh(geometry, material);

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
                const fov = this.camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
                cameraZ *= 2.0; // Zoom out a little
                this.camera.position.set(cameraZ, cameraZ, cameraZ);
                this.camera.lookAt(0, 0, 0);
                this.controls.target.set(0, 0, 0);
            }

            this.scene.add(this.currentMesh);
        } catch (e) {
            console.error('Failed to parse STL arraybuffer:', e);
        }
    }

    public captureFrame(): string {
        this.renderer.render(this.scene, this.camera);
        return this.renderer.domElement.toDataURL('image/png');
    }
}

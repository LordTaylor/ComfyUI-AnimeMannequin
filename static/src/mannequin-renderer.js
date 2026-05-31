import * as THREE from '../lib/three.module.js';
import { BONE_NAMES, BONE_CHILDREN, defaultScene, jsonToScene } from './mannequin-model.js';
import { buildSegments, computeBoneOffsets, WORLD_HEIGHT, OPENPOSE_COLORS, JOINT_COLOR } from './geometry-adapter-gltf.js';

function sobelCanny(sourceCanvas) {
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    const ctx = tmp.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);
    const src = ctx.getImageData(0, 0, W, H).data;
    const out = new Uint8ClampedArray(W * H * 4);

    const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            let gx = 0, gy = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const i = ((y + dy) * W + (x + dx)) * 4;
                    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
                    const ki = (dy + 1) * 3 + (dx + 1);
                    gx += lum * kx[ki];
                    gy += lum * ky[ki];
                }
            }
            const mag = Math.sqrt(gx * gx + gy * gy);
            const v = mag > 30 ? 255 : 0;
            const di = (y * W + x) * 4;
            out[di] = out[di + 1] = out[di + 2] = v;
            out[di + 3] = 255;
        }
    }

    const imgData = ctx.createImageData(W, H);
    imgData.data.set(out);
    ctx.putImageData(imgData, 0, 0);
    return tmp.toDataURL('image/png');
}

export class MannequinRenderer {
    constructor(canvas) {
        this._canvas = canvas;
        this._scene = new THREE.Scene();
        this._scene.background = new THREE.Color(0x4a4a4a);

        this._camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
        this._outputWidth  = 768;
        this._outputHeight = 1024;

        this._renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        this._renderer.setPixelRatio(window.devicePixelRatio);

        // Depth render target
        this._depthTarget = new THREE.WebGLRenderTarget(512, 512);
        this._depthCamera = this._camera.clone();
        this._depthMat = new THREE.MeshDepthMaterial();

        // Bone Object3D map: name → Object3D
        this._bones   = new Map();
        // Segment group map: name → THREE.Group (from adapter)
        this._segments = new Map();

        this._gender = 'F';
        this._mannequinRoot = new THREE.Group();
        this._mannequinRoot.name = 'mannequinRoot';
        this._scene.add(this._mannequinRoot);

        // Ambient + directional light for toon shading
        this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(1, 2, 1);
        this._scene.add(dir);

        // Floor grid — 10×10 cells, 0.2 scene units each (covers 2×2 m around origin)
        const grid = new THREE.GridHelper(2, 10, 0x888888, 0x555555);
        this._scene.add(grid);

        this._dirty = true;
        this._jointColorMode = 'openpose'; // 'openpose' | 'flat'
    }

    get camera() { return this._camera; }
    get scene()  { return this._scene; }
    get bones()  { return this._bones; }
    get mannequinRoot() { return this._mannequinRoot; }
    get outputWidth()  { return this._outputWidth; }
    get outputHeight() { return this._outputHeight; }

    setOutputSize(w, h) {
        this._outputWidth  = w;
        this._outputHeight = h;
        this._depthTarget.setSize(w, h);
        this._dirty = true;
    }

    markDirty() { this._dirty = true; }

    async buildMannequin(gender, sceneData) {
        this._gender = gender;
        this._mannequinRoot.traverse(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
        this._mannequinRoot.clear();
        this._bones.clear();
        this._segments.clear();

        const segments = await buildSegments(gender);
        const offsets  = await computeBoneOffsets(gender);

        // Create Object3D per bone
        for (const name of this._boneNames()) {
            const obj = new THREE.Object3D();
            obj.name = name;
            this._bones.set(name, obj);
        }

        // Position root bone so feet land at Y=0
        const torsoOffset = offsets.get('torso') ?? new THREE.Vector3();
        this._bones.get('torso').position.copy(torsoOffset);

        // Build hierarchy
        this._mannequinRoot.add(this._bones.get('torso'));
        this._buildHierarchy('torso', offsets);

        // Attach segments to bones
        for (const [name, group] of segments) {
            const bone = this._bones.get(name);
            if (bone) { bone.add(group); this._segments.set(name, group); }
        }

        // Restore pose from scene data
        if (sceneData) this.applyScene(sceneData);

        // Apply joint color mode after build
        this._applyJointColors(this._jointColorMode);

        this._dirty = true;
    }

    setJointColorMode(mode) {
        this._jointColorMode = mode;
        this._applyJointColors(mode);
        this._dirty = true;
    }

    _applyJointColors(mode) {
        this._scene.traverse(obj => {
            if (obj.userData.isJoint && !obj.userData.isHitTarget) {
                const color = mode === 'openpose'
                    ? (OPENPOSE_COLORS[obj.userData.boneName] ?? JOINT_COLOR)
                    : JOINT_COLOR;
                obj.userData.originalColor = color;
                obj.material.color.setHex(color);
            }
        });
    }

    _buildHierarchy(parentName, offsets) {
        const children = BONE_CHILDREN[parentName] ?? [];
        const parentObj  = this._bones.get(parentName);
        const parentWorld = offsets.get(parentName) ?? new THREE.Vector3();
        for (const childName of children) {
            const childObj   = this._bones.get(childName);
            const childWorld = offsets.get(childName) ?? new THREE.Vector3();
            // Local offset = child world target minus parent world target.
            // Using world-as-local caused deep bones to accumulate positions
            // (each ancestor's world position stacked on top of the child's).
            childObj.position.copy(childWorld.clone().sub(parentWorld));
            parentObj.add(childObj);
            this._buildHierarchy(childName, offsets);
        }
    }

    _boneNames() { return BONE_NAMES; }

    applyScene(sceneData) {
        for (const [name, bone] of this._bones) {
            const data = sceneData.bones?.[name];
            if (!data?.rotation) continue;
            const [x, y, z, w] = data.rotation;
            bone.quaternion.set(x, y, z, w);
        }
        if (sceneData.camera) {
            this._applyCameraFromScene(sceneData.camera);
        }
        this._dirty = true;
    }

    _applyCameraFromScene(cam) {
        const r = cam.distance * WORLD_HEIGHT;
        const azRad = THREE.MathUtils.degToRad(cam.azimuth);
        const elRad = THREE.MathUtils.degToRad(cam.elevation);
        this._camera.position.set(
            r * Math.sin(azRad) * Math.cos(elRad),
            r * Math.sin(elRad) + WORLD_HEIGHT * 0.5,
            r * Math.cos(azRad) * Math.cos(elRad)
        );
        this._camera.lookAt(0, WORLD_HEIGHT * 0.5, 0);
    }

    getSceneData(gender, cameraAzimuth = 0, cameraElevation = 5) {
        const bones = {};
        for (const [name, obj] of this._bones) {
            const q = obj.quaternion;
            bones[name] = { rotation: [q.x, q.y, q.z, q.w] };
        }
        return {
            version: '1.0',
            gender: this._gender,
            bones,
            camera: { azimuth: cameraAzimuth, elevation: cameraElevation, distance: 2.5 },
        };
    }

    render(viewW, viewH) {
        this._renderer.setSize(viewW, viewH);
        this._camera.aspect = viewW / viewH;
        this._camera.updateProjectionMatrix();
        this._renderer.render(this._scene, this._camera);
        this._dirty = false;
    }

    captureImages() {
        const W = this._outputWidth;
        const H = this._outputHeight;

        // --- POSE render ---
        this._renderer.setSize(W, H);
        this._camera.aspect = W / H;
        this._camera.updateProjectionMatrix();
        this._renderer.render(this._scene, this._camera);
        const poseDataUrl = this._renderer.domElement.toDataURL('image/png');

        // --- DEPTH render ---
        this._fitDepthCamera(W, H);
        this._depthTarget.setSize(W, H);

        // Swap materials to depth — always restore in finally to avoid permanent black screen
        const buf = new Uint8Array(W * H * 4);
        try {
            this._scene.overrideMaterial = this._depthMat;
            this._renderer.setSize(W, H);
            this._renderer.setRenderTarget(this._depthTarget);
            this._renderer.render(this._scene, this._depthCamera);
            this._renderer.readRenderTargetPixels(this._depthTarget, 0, 0, W, H, buf);
        } finally {
            this._renderer.setRenderTarget(null);
            this._scene.overrideMaterial = null;
        }

        // Invert: MeshDepthMaterial encodes far=black, we want near=white
        // Red channel = depth value, already 0(near)=255-ish, 1(far)=0
        // Flip Y (WebGL is bottom-up)
        const depthCanvas = document.createElement('canvas');
        depthCanvas.width = W; depthCanvas.height = H;
        const ctx = depthCanvas.getContext('2d');
        const imgData = ctx.createImageData(W, H);
        for (let row = 0; row < H; row++) {
            for (let col = 0; col < W; col++) {
                const srcIdx = ((H - 1 - row) * W + col) * 4;
                const dstIdx = (row * W + col) * 4;
                const v = buf[srcIdx]; // red channel = depth
                imgData.data[dstIdx]     = v;
                imgData.data[dstIdx + 1] = v;
                imgData.data[dstIdx + 2] = v;
                imgData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const depthDataUrl = depthCanvas.toDataURL('image/png');

        // --- CANNY render ---
        // Canny is derived from the pose image snapshot (captured before depth pass)
        const cannyDataUrl = sobelCanny(this._renderer.domElement);

        // Restore display size and trigger re-render so viewport isn't stuck at output resolution
        this._dirty = true;

        return { pose: poseDataUrl, depth: depthDataUrl, canny: cannyDataUrl };
    }

    _fitDepthCamera(W, H) {
        const bbox = new THREE.Box3().setFromObject(this._mannequinRoot);
        const center = bbox.getCenter(new THREE.Vector3());
        const size   = bbox.getSize(new THREE.Vector3()).length();
        const dist   = this._camera.position.distanceTo(center);

        this._depthCamera.copy(this._camera);
        this._depthCamera.aspect = W / H;
        this._depthCamera.near = Math.max(0.01, dist - size * 0.65);
        this._depthCamera.far  = dist + size * 0.65;
        this._depthCamera.updateProjectionMatrix();
    }

    dispose() {
        this._scene.traverse(obj => {
            obj.geometry?.dispose();
            obj.material?.dispose();
        });
        this._bones.clear();
        this._segments.clear();
        this._depthTarget.dispose();
        this._depthMat.dispose();
        this._renderer.forceContextLoss();
        this._renderer.dispose();
    }
}

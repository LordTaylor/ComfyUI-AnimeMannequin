import * as THREE from '../lib/three.module.js';
import { BONE_NAMES, BONE_CHILDREN, defaultScene, jsonToScene, defaultProportions } from './mannequin-model.js';
import { buildSegments, computeBoneOffsets, WORLD_HEIGHT, OPENPOSE_COLORS, JOINT_COLOR } from './geometry-adapter-gltf.js';

// How much the bust projects forward per unit of scale increase.
// 0 = grows only downward; increase for more forward projection.
const BUST_FWD_PROJECTION = 0.35;

// COCO-style limb connections shared by both the 3D skeleton overlay and the openpose capture.
// Each entry: [boneA, boneB, rgbHex]
const SKELETON_LIMBS = [
    ['neck',        'head',        0xff0055],
    ['neck',        'upper_arm_R', 0xff0000],
    ['neck',        'upper_arm_L', 0xff5500],
    ['upper_arm_R', 'upper_arm_L', 0xff2200],
    ['upper_arm_R', 'forearm_R',   0xffaa00],
    ['forearm_R',   'hand_R',      0xffff00],
    ['upper_arm_L', 'forearm_L',   0xaaff00],
    ['forearm_L',   'hand_L',      0x55ff00],
    ['neck',        'pelvis',      0x00ffaa],
    ['pelvis',      'thigh_R',     0x00ffcc],
    ['thigh_R',     'shin_R',      0x00ffff],
    ['shin_R',      'foot_R',      0x00aaff],
    ['pelvis',      'thigh_L',     0x0055ff],
    ['thigh_L',     'shin_L',      0x0000ff],
    ['shin_L',      'foot_L',      0x5500ff],
];

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

        // Floor grid — viewport only, hidden during captures
        this._grid = new THREE.GridHelper(2, 10, 0x888888, 0x555555);
        this._scene.add(this._grid);

        // Optional ground plane — shown in captures only when user enables it
        const groundGeo = new THREE.PlaneGeometry(3, 3);
        const groundMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide });
        this._ground = new THREE.Mesh(groundGeo, groundMat);
        this._ground.rotation.x = -Math.PI / 2;
        this._ground.position.y = 0.001; // avoid z-fighting with grid
        this._ground.visible = false;
        this._scene.add(this._ground);
        this._groundEnabled = false;

        this._dirty = true;
        this._jointColorMode = 'openpose'; // 'openpose' | 'flat'
        this._proportions = defaultProportions();
        this._skeletonLines = null; // THREE.LineSegments — built after mannequin loads
    }

    get camera() { return this._camera; }
    get scene()  { return this._scene; }
    get bones()  { return this._bones; }
    get mannequinRoot() { return this._mannequinRoot; }
    get outputWidth()  { return this._outputWidth; }
    get outputHeight() { return this._outputHeight; }
    get proportions() { return { ...this._proportions }; }
    get groundEnabled() { return this._groundEnabled; }

    setGroundVisible(enabled) {
        this._groundEnabled = enabled;
        this._ground.visible = enabled;
        this._dirty = true;
    }

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

        // Build skeleton line overlay (openpose viewport visualization)
        this._buildSkeletonLines();

        // Apply proportions (from sceneData or current stored proportions)
        this.applyProportions(sceneData?.proportions ?? {});

        this._dirty = true;
    }

    setJointColorMode(mode) {
        this._jointColorMode = mode;
        this._applyJointColors(mode);
        // In openpose mode: show skeleton lines, hide colored joint dots.
        // In flat mode: hide skeleton lines, show joint dots for editing feedback.
        if (this._skeletonLines) this._skeletonLines.visible = (mode === 'openpose');
        this._scene.traverse(o => {
            if (o.userData.isJoint && !o.userData.isHitTarget) {
                o.visible = (mode !== 'openpose');
            }
        });
        this._dirty = true;
    }

    applyProportions(proportions) {
        this._proportions = { ...this._proportions, ...proportions };
        const { head = 1, bust = 1, hips = 1, waist = 1, legs = 1, arms = 1 } = this._proportions;

        // Map proportion name → uniform scale multiplier
        const scaleFor = { head, bust, hips, waist, legs, arms };

        this._scene.traverse(obj => {
            if (!obj.isMesh || !obj.userData._baseScale || obj.userData.isJoint || obj.userData.isHitTarget) return;
            const pg = obj.userData.proportionGroup;
            const bs = obj.userData._baseScale;
            const bp = obj.userData._basePosition;
            const s = pg ? (scaleFor[pg] ?? 1) : 1;
            obj.scale.set(bs.x * s, bs.y * s, bs.z * s);
            if (!bp) return;
            if (pg === 'bust') {
                // Hinge model: top edge of breast stays attached to chest at all sizes.
                // halfH from actual geometry bounding box (set in adapter), fallback to 0.
                // new_top = bp.y + halfH = constant → new_center_y = bp.y - halfH*(s-1)
                const halfH = obj.userData._bustHalfH ?? 0;
                obj.position.set(
                    bp.x,
                    bp.y - halfH * (s - 1),                                         // top fixed, bottom sags
                    bp.z + Math.abs(bp.z) * BUST_FWD_PROJECTION * (s - 1)          // forward projection
                );
            } else {
                // All other extra nodes (ears, eyes, nose): scale offset proportionally
                obj.position.set(bp.x * s, bp.y * s, bp.z * s);
            }
        });

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
        if (sceneData.proportions) {
            this.applyProportions(sceneData.proportions);
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
            proportions: { ...this._proportions },
        };
    }

    render(viewW, viewH) {
        if (this._skeletonLines?.visible) this._updateSkeletonLines();
        this._renderer.setSize(viewW, viewH);
        this._camera.aspect = viewW / viewH;
        this._camera.updateProjectionMatrix();
        this._renderer.render(this._scene, this._camera);
        this._dirty = false;
    }

    captureImages() {
        const W = this._outputWidth;
        const H = this._outputHeight;

        // Collect visible joint spheres — hidden for canny/depth, restored after
        const jointMeshes = [];
        this._scene.traverse(o => { if (o.userData.isJoint && !o.userData.isHitTarget && o.visible) jointMeshes.push(o); });
        const setJointsVisible = v => jointMeshes.forEach(j => j.visible = v);

        // Grid/skeleton lines never appear in captures
        this._grid.visible = false;
        if (this._skeletonLines) this._skeletonLines.visible = false;

        this._renderer.setSize(W, H);
        this._camera.aspect = W / H;
        this._camera.updateProjectionMatrix();

        // --- POSE render (joints visible — gives user the reference image) ---
        this._renderer.render(this._scene, this._camera);
        const poseDataUrl = this._renderer.domElement.toDataURL('image/png');

        // --- DEPTH render (joints hidden — they'd register as near-surface noise) ---
        setJointsVisible(false);
        this._fitDepthCamera(W, H);
        this._depthTarget.setSize(W, H);

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
        setJointsVisible(true);

        // MeshDepthMaterial: near=0 (dark), far=255 (bright), background=0 (dark).
        // ControlNet wants near=bright, far=dark. Steps:
        //   1. Normalize non-background pixels to full [0,255] range for maximum contrast.
        //   2. Invert so near=255 (white), far=0 (black). Background stays black (no geometry).
        // Flip Y (WebGL is bottom-up).
        let minDepth = 255, maxDepth = 0;
        for (let i = 0; i < W * H; i++) {
            const v = buf[i * 4];
            if (v > 0) { if (v < minDepth) minDepth = v; if (v > maxDepth) maxDepth = v; }
        }
        const depthRange = maxDepth - minDepth || 1;

        const depthCanvas = document.createElement('canvas');
        depthCanvas.width = W; depthCanvas.height = H;
        const ctx = depthCanvas.getContext('2d');
        const imgData = ctx.createImageData(W, H);
        for (let row = 0; row < H; row++) {
            for (let col = 0; col < W; col++) {
                const srcIdx = ((H - 1 - row) * W + col) * 4;
                const dstIdx = (row * W + col) * 4;
                const v = buf[srcIdx];
                // Background (v=0) → 0; geometry: normalize then invert
                const norm = v === 0 ? 0 : 255 - Math.round((v - minDepth) / depthRange * 255);
                imgData.data[dstIdx]     = norm;
                imgData.data[dstIdx + 1] = norm;
                imgData.data[dstIdx + 2] = norm;
                imgData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const depthDataUrl = depthCanvas.toDataURL('image/png');

        // --- CANNY render — joints hidden so they don't appear as round artifacts ---
        setJointsVisible(false);
        this._renderer.setSize(W, H);
        this._renderer.render(this._scene, this._camera);
        const cannyDataUrl = sobelCanny(this._renderer.domElement);
        setJointsVisible(true);

        // --- OPENPOSE 2D render ---
        const openposeDataUrl = this._captureOpenPose(W, H);

        // Restore grid and skeleton overlay for viewport
        this._grid.visible = true;
        if (this._skeletonLines) this._skeletonLines.visible = (this._jointColorMode === 'openpose');
        this._dirty = true;
        return { pose: poseDataUrl, depth: depthDataUrl, canny: cannyDataUrl, openpose: openposeDataUrl };
    }

    _captureOpenPose(W, H) {
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Project bone world positions to 2D screen coords
        const sp = new Map();
        const tmp = new THREE.Vector3();
        for (const [name, bone] of this._bones) {
            bone.getWorldPosition(tmp);
            const p = tmp.project(this._camera);
            sp.set(name, { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H });
        }

        const dotR  = Math.max(5, Math.round(W / 70));
        const lineW = Math.max(3, Math.round(W / 90));

        function rgb(hex) {
            return `rgb(${(hex>>16)&0xff},${(hex>>8)&0xff},${hex&0xff})`;
        }

        ctx.lineWidth = lineW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw limb lines
        for (const [a, b, col] of SKELETON_LIMBS) {
            const pa = sp.get(a), pb = sp.get(b);
            if (!pa || !pb) continue;
            ctx.strokeStyle = rgb(col);
            ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
        }

        // Draw keypoint dots on top
        const drawn = new Set();
        for (const [a, b, col] of SKELETON_LIMBS) {
            for (const [k, c] of [[a, col],[b, col]]) {
                if (drawn.has(k)) continue;
                drawn.add(k);
                const p = sp.get(k);
                if (!p) continue;
                ctx.fillStyle = rgb(c);
                ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill();
            }
        }

        return canvas.toDataURL('image/png');
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

    _buildSkeletonLines() {
        // Remove old skeleton lines if any
        if (this._skeletonLines) {
            this._scene.remove(this._skeletonLines);
            this._skeletonLines.geometry.dispose();
            this._skeletonLines.material.dispose();
        }

        const N = SKELETON_LIMBS.length;
        const positions = new Float32Array(N * 2 * 3); // 2 verts × 3 floats per limb
        const colors    = new Float32Array(N * 2 * 3);

        // Pre-fill colors (static per limb)
        for (let i = 0; i < N; i++) {
            const hex = SKELETON_LIMBS[i][2];
            const r = ((hex >> 16) & 0xff) / 255;
            const g = ((hex >>  8) & 0xff) / 255;
            const b = (hex         & 0xff) / 255;
            colors[i * 6 + 0] = r; colors[i * 6 + 1] = g; colors[i * 6 + 2] = b;
            colors[i * 6 + 3] = r; colors[i * 6 + 4] = g; colors[i * 6 + 5] = b;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));

        const mat = new THREE.LineBasicMaterial({
            vertexColors: true,
            linewidth: 2,  // >1 only works on some platforms, but sets intent
            depthTest: false,
        });
        const lines = new THREE.LineSegments(geo, mat);
        lines.renderOrder = 3;
        lines.visible = (this._jointColorMode === 'openpose');
        this._skeletonLines = lines;
        this._scene.add(lines);

        // Populate initial positions
        this._updateSkeletonLines();
    }

    _updateSkeletonLines() {
        if (!this._skeletonLines || !this._bones.size) return;
        const posAttr = this._skeletonLines.geometry.getAttribute('position');
        const tmp = new THREE.Vector3();
        for (let i = 0; i < SKELETON_LIMBS.length; i++) {
            const [a, b] = SKELETON_LIMBS[i];
            const boneA = this._bones.get(a);
            const boneB = this._bones.get(b);
            if (boneA) { boneA.getWorldPosition(tmp); posAttr.setXYZ(i * 2,     tmp.x, tmp.y, tmp.z); }
            if (boneB) { boneB.getWorldPosition(tmp); posAttr.setXYZ(i * 2 + 1, tmp.x, tmp.y, tmp.z); }
        }
        posAttr.needsUpdate = true;
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

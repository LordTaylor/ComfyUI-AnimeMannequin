import * as THREE from '../lib/three.module.js';
import { BONE_NAMES, BONE_CHILDREN, defaultScene, jsonToScene, defaultProportions } from './mannequin-model.js';
import { buildSegments, computeBoneOffsets, WORLD_HEIGHT, OPENPOSE_COLORS, JOINT_COLOR } from './geometry-adapter-gltf.js';

export const BUST_DEFAULTS = {
    // Position — Local  (bone-relative, offset scaled by growth = halfH*(s-1))
    loc_x      :  0.1,  // X spread per unit of growth
    loc_y      :  0.0,  // Y spread per unit of growth
    loc_z      :  0.55,  // Z forward push per unit of growth
    loc_z_base :  0.00,  // Z constant base offset (independent of size)
    // Position — Global  (world-space, same for both breasts in same direction)
    glob_y_base:  0.00,  // world-Y constant separation (always, regardless of scale)
    glob_y     :  0.00,  // world-Y separation per (s-1)  — e.g. 0.05 → 5cm wider at s=2
    glob_z     :  0.20,  // world-Z sag per unit of growth (downward)
    // Rotation — Local  (bone-relative, angle in rad per (s-1), mirrors L/R)
    rot_x      :  0.050,  // rotation around X (forward tilt)
    rot_y      :  -0.50,  // rotation around Y (left/right)
    rot_z      : 0.750,  // rotation around Z (lateral tilt)
    // Rotation — Global  (world-space, same direction for both breasts, per (s-1))
    grot_x     :  0.00,  // global rotation around X
    grot_y     :  0.00,  // global rotation around Y
    grot_z     :  0.00,  // global rotation around Z
    // Scale
    scale_x    :  1.00,  // X scale multiplier (< 1 narrows each breast)
};




// COCO 18 limb connections — COCO standard (direct shoulder→elbow, hip→knee, etc.)
// Colors per Openpose-18-keypoints_coco_color_codes_v13 (100 % brightness joint colors).
// Each entry: [boneA, boneB, lineColorHex]
const SKELETON_LIMBS = [
    // Head
    ['neck',        'head',        0xff0000],  // 1-0
    // Right arm
    ['neck',        'shoulder_R',  0xffaa00],  // 1-2
    ['shoulder_R',  'forearm_R',   0xffff00],  // 2-3  (upper arm drawn as single segment)
    ['forearm_R',   'hand_R',      0xaaff00],  // 3-4
    // Left arm
    ['neck',        'shoulder_L',  0x55ff00],  // 1-5
    ['shoulder_L',  'forearm_L',   0x00ff00],  // 5-6
    ['forearm_L',   'hand_L',      0x00ff55],  // 6-7
    // Right leg (torso line goes neck→hip)
    ['neck',        'thigh_R',     0x00ffaa],  // 1-8  right torso
    ['thigh_R',     'shin_R',      0x00ffff],  // 8-9
    ['shin_R',      'foot_R',      0x00aaff],  // 9-10
    // Left leg
    ['neck',        'thigh_L',     0x0055ff],  // 1-11 left torso
    ['thigh_L',     'shin_L',      0x0000ff],  // 11-12
    ['shin_L',      'foot_L',      0x5500ff],  // 12-13
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
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./app-store.js').AppStore|null} store  optional — enables reactive sync
     */
    constructor(canvas, store = null) {
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
        this._bustCfg = { ...BUST_DEFAULTS };
        this._skeletonLines    = null;
        this._skeletonCylinders = null;

        // ── Store wiring (Phase 3) ─────────────────────────────────────────────
        this._store     = null;
        this._storeUnsub = null;
        if (store) this._connectStore(store);
    }

    /**
     * Connect to AppStore — renderer will react to state changes automatically.
     * Safe to call multiple times (disconnects previous store first).
     */
    _connectStore(store) {
        if (this._storeUnsub) this._storeUnsub();
        this._store    = store;
        this._prevSync = {};                                      // reset diff tracker
        const s = store.getState();
        // Apply initial state without triggering full applyProportions (mannequin not yet built)
        this._jointColorMode = s.jointColorMode ?? 'openpose';
        this._proportions    = { ...s.proportions };
        this._bustCfg        = { ...s.bustCfg };
        this._outputWidth    = s.outputWidth  ?? this._outputWidth;
        this._outputHeight   = s.outputHeight ?? this._outputHeight;
        this._prevSync     = { ...s };
        this._prevPropsJson = JSON.stringify(s.proportions);
        this._prevCfgJson   = JSON.stringify(s.bustCfg);
        this._storeUnsub = store.subscribe(state => this._onStoreChange(state));
    }

    /** React to store state changes — only re-applies what actually changed.
     *  _prevSync holds the RAW internal state snapshot (not the cloned getState() output)
     *  so reference equality checks work correctly.
     */
    _onStoreChange(state) {
        const prev = this._prevSync;
        let needsProportionSync = false;

        if (state.jointColorMode !== prev.jointColorMode) {
            this._jointColorMode = state.jointColorMode;
            this._applyJointColorModeInternal(state.jointColorMode);
        }

        // Compare by JSON to detect actual value changes (proportions/bustCfg are always new objects)
        const propsJson = JSON.stringify(state.proportions);
        const cfgJson   = JSON.stringify(state.bustCfg);
        if (propsJson !== this._prevPropsJson) {
            this._prevPropsJson = propsJson;
            this._proportions   = { ...state.proportions };
            needsProportionSync = true;
        }
        if (cfgJson !== this._prevCfgJson) {
            this._prevCfgJson = cfgJson;
            this._bustCfg     = { ...state.bustCfg };
            needsProportionSync = true;
        }

        if (needsProportionSync && this._bones.size) {
            this.applyProportions({});
        }

        if (state.outputWidth !== prev.outputWidth || state.outputHeight !== prev.outputHeight) {
            this._outputWidth  = state.outputWidth;
            this._outputHeight = state.outputHeight;
            this._depthTarget.setSize(state.outputWidth, state.outputHeight);
        }

        if (state.groundEnabled !== prev.groundEnabled) {
            this._groundEnabled = state.groundEnabled;
            this._ground.visible = state.groundEnabled;
        }

        this._prevSync = state;
        this._dirty = true;
    }

    /** Internal — sets joint color mode WITHOUT going through store (avoids infinite loop). */
    _applyJointColorModeInternal(mode) {
        this._applyJointColors(mode);
        if (this._skeletonLines) this._skeletonLines.visible = (mode === 'openpose');
        this._scene.traverse(o => {
            if (o.userData.isJoint && !o.userData.isHitTarget) o.visible = (mode !== 'openpose');
        });
        this._applyChestJointVisibility();
    }

    get camera() { return this._camera; }
    get scene()  { return this._scene; }
    get bones()  { return this._bones; }
    get mannequinRoot() { return this._mannequinRoot; }
    get outputWidth()  { return this._outputWidth; }
    get outputHeight() { return this._outputHeight; }
    get proportions() { return { ...this._proportions }; }
    get groundEnabled() { return this._groundEnabled; }
    get bustCfg() { return { ...this._bustCfg }; }
    setBustCfg(partial) {
        if (this._store) { this._store.setBustCfg(partial); return; }
        Object.assign(this._bustCfg, partial);
        this.applyProportions({});
    }

    setGroundVisible(enabled) {
        if (this._store) { this._store.setState({ groundEnabled: enabled }); return; }
        this._groundEnabled = enabled;
        this._ground.visible = enabled;
        this._dirty = true;
    }

    setOutputSize(w, h) {
        if (this._store) { this._store.setOutputSize(w, h); return; }
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

        // Build skeleton line overlay (openpose viewport visualization)
        this._buildSkeletonLines();

        // Sync joint colors AND visibility with current mode (must run after _buildSkeletonLines)
        this.setJointColorMode(this._jointColorMode);

        // Apply proportions (from sceneData or current stored proportions)
        this.applyProportions(sceneData?.proportions ?? {});

        this._dirty = true;
    }

    setJointColorMode(mode) {
        if (this._store) {
            // Delegate to store → _onStoreChange will apply internally
            this._store.setState({ jointColorMode: mode });
            return;
        }
        // Legacy (no store)
        this._jointColorMode = mode;
        this._applyJointColorModeInternal(mode);
        this._dirty = true;
    }

    // Hide chest joint sphere when bust scale > 1 so it doesn't float visibly
    // behind/between the bust meshes. Called from both setJointColorMode and applyProportions.
    _applyChestJointVisibility() {
        const bust = this._proportions?.bust ?? 1;
        const chestSegGroup = this._segments?.get('chest');
        if (!chestSegGroup) return;
        let bustHalfH = 0;
        chestSegGroup.traverse(c => {
            if (c.userData.proportionGroup === 'bust' && c.userData._bustHalfH)
                bustHalfH = Math.max(bustHalfH, c.userData._bustHalfH);
        });
        const bustGrowth = bustHalfH * Math.max(0, bust - 1);
        chestSegGroup.children.forEach(c => {
            if (c.userData.isJoint && !c.userData.isHitTarget) {
                c.position.z = -bustGrowth;
                // Hide when bust grows — renderOrder:2 ignores depthTest so hiding is safer.
                c.visible = (this._jointColorMode !== 'openpose') && (bust <= 1.01);
            }
        });
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
                const c = this._bustCfg;
                const halfH  = obj.userData._bustHalfH ?? 0;
                const growth = halfH * (s - 1);

                obj.scale.set(
                    bs.x * c.scale_x * Math.pow(s, 0.85),
                    bs.y * Math.pow(s, 0.7),
                    bs.z * Math.pow(s, 1.0)
                );

                const fwdSign  = Math.abs(bp.z) > 0.001 ? Math.sign(bp.z) : -1;
                const latSign  = Math.abs(bp.x) > 0.001 ? Math.sign(bp.x) : 1;
                const latSignY = Math.abs(bp.y) > 0.001 ? Math.sign(bp.y) : 1;

                obj.position.set(
                    bp.x + latSign  * growth * c.loc_x,
                    bp.y + latSignY * (growth * c.loc_y + (s - 1) * c.glob_y + c.glob_y_base),
                    bp.z + fwdSign  * (c.loc_z_base + growth * c.loc_z) - growth * c.glob_z
                );

                obj.rotation.set(
                    -fwdSign * c.rot_x * (s - 1) + c.grot_x * (s - 1),
                     latSign * c.rot_y * (s - 1) + c.grot_y * (s - 1),
                     latSign * c.rot_z * (s - 1) + c.grot_z * (s - 1)
                );
            } else {
                // All other extra nodes (ears, eyes, nose): scale offset proportionally
                obj.position.set(bp.x * s, bp.y * s, bp.z * s);
            }
        });

        // Hide chest joint sphere when bust > 1 (see _applyChestJointVisibility).
        this._applyChestJointVisibility();

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
        if (!sceneData) return;
        for (const [name, bone] of this._bones) {
            const data = sceneData.bones?.[name];
            const rot  = data?.rotation;
            // Only apply a well-formed quaternion. A non-array truthy value (e.g. a
            // number from a hand-edited / partial imported pose) would otherwise throw
            // "not iterable"; a wrong-length array would silently NaN the character.
            if (!Array.isArray(rot) || rot.length < 4) continue;
            const [x, y, z, w] = rot;
            if ([x, y, z, w].some(n => typeof n !== 'number' || Number.isNaN(n))) continue;
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
        // Defaults so a present-but-partial camera object can't produce a NaN position.
        const { azimuth = 0, elevation = 5, distance = 2.5 } = cam ?? {};
        const r = distance * WORLD_HEIGHT;
        const azRad = THREE.MathUtils.degToRad(azimuth);
        const elRad = THREE.MathUtils.degToRad(elevation);
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

        // Hide editor gizmos (TransformControls rotation rings, etc.) — must not appear in output
        const gizmos = [];
        this._scene.traverse(o => { if (o.userData.isGizmo && o.visible) { gizmos.push(o); o.visible = false; } });

        this._grid.visible = false;
        this._renderer.setSize(W, H);
        this._camera.aspect = W / H;
        this._camera.updateProjectionMatrix();

        // --- 3D REFERENCE render: body + COCO skeleton lines, no joint balls ---
        // Shown as the "openpose" output so users can see the pose on the body.
        setJointsVisible(false);
        if (this._skeletonLines) this._skeletonLines.visible = true;
        this._renderer.render(this._scene, this._camera);
        const refDataUrl = this._renderer.domElement.toDataURL('image/png');
        if (this._skeletonLines) this._skeletonLines.visible = false;

        // --- DEPTH render ---
        this._fitDepthCamera(W, H);
        this._depthTarget.setSize(W, H);

        // scene.background (grey) is rendered before geometry even with overrideMaterial —
        // setting it to null ensures background pixels come out as clear-color (black = 0),
        // so our background-detection check `v === 0` works correctly.
        const savedBackground = this._scene.background;
        const buf = new Uint8Array(W * H * 4);
        try {
            this._scene.background    = null;
            this._scene.overrideMaterial = this._depthMat;
            this._renderer.setClearColor(0x000000, 1);
            this._renderer.setSize(W, H);
            this._renderer.setRenderTarget(this._depthTarget);
            this._renderer.render(this._scene, this._depthCamera);
            this._renderer.readRenderTargetPixels(this._depthTarget, 0, 0, W, H, buf);
        } finally {
            this._renderer.setRenderTarget(null);
            this._scene.overrideMaterial = null;
            this._scene.background = savedBackground;
        }
        // MeshDepthMaterial (BasicDepthPacking): near=255 (bright), far=0 (dark), background=0 (dark).
        // This already matches ControlNet convention (near=bright). Steps:
        //   1. Stretch geometry pixels from [minDepth, maxDepth] → [DEPTH_MIN, 255].
        //      DEPTH_MIN=30: farthest character pixel = dark-grey, NOT black like background.
        //   2. Background (v===0) → 0 (true black). Flip Y (WebGL bottom-up).
        const DEPTH_MIN = 30; // farthest character pixel — dark-grey, never background-black
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
                // Background → true black (0). Geometry → [DEPTH_MIN, 255] stretched range.
                // BasicDepthPacking: near=bright → keep direction, just stretch to [DEPTH_MIN,255].
                const norm = v === 0 ? 0 : DEPTH_MIN + Math.round((v - minDepth) / depthRange * (255 - DEPTH_MIN));
                imgData.data[dstIdx]     = norm;
                imgData.data[dstIdx + 1] = norm;
                imgData.data[dstIdx + 2] = norm;
                imgData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imgData, 0, 0);
        const depthDataUrl = depthCanvas.toDataURL('image/png');

        // --- CANNY render — joints hidden so they don't appear as round artifacts ---
        let cannyDataUrl;
        setJointsVisible(false);
        try {
            this._renderer.setSize(W, H);
            this._renderer.render(this._scene, this._camera);
            cannyDataUrl = sobelCanny(this._renderer.domElement);
        } finally {
            setJointsVisible(true);
        }

        // --- POSE = 2D OpenPose skeleton (black bg + COCO colored lines + dots) ---
        // This is what goes into the OpenPose ControlNet.
        const poseDataUrl = this._captureOpenPose(W, H);

        // Restore gizmos, grid and skeleton overlay for viewport
        gizmos.forEach(o => o.visible = true);
        setJointsVisible(true);
        this._grid.visible = true;
        if (this._skeletonLines) this._skeletonLines.visible = (this._jointColorMode === 'openpose');
        this._dirty = true;
        // pose   = 2D OpenPose skeleton on black bg   → for OpenPose ControlNet
        // openpose = 3D body + skeleton overlay        → visual reference
        return { pose: poseDataUrl, depth: depthDataUrl, canny: cannyDataUrl, openpose: refDataUrl };
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

        // Draw keypoint dots with correct per-bone COCO-18 colors (not the line color)
        const drawn = new Set();
        for (const [a, b] of SKELETON_LIMBS) {
            for (const k of [a, b]) {
                if (drawn.has(k)) continue;
                drawn.add(k);
                const p = sp.get(k);
                if (!p) continue;
                const dotCol = OPENPOSE_COLORS[k] ?? 0xffffff;
                ctx.fillStyle = rgb(dotCol);
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
        // Dispose old skeleton group if any
        if (this._skeletonLines) {
            this._skeletonLines.traverse(obj => {
                obj.geometry?.dispose();
                obj.material?.dispose();
            });
            this._scene.remove(this._skeletonLines);
        }

        // WebGL ignores linewidth > 1 on all major platforms.
        // Use CylinderMesh per limb — thick colored tubes that look like classic OpenPose sticks.
        // SKELETON_CYLINDER_RADIUS controls visual thickness in scene units (character ~2m tall).
        const RADIUS = 0.015; // ~1.5cm on a 2m character (−30% from original 0.022)

        const group = new THREE.Group();
        group.renderOrder = 3;
        group.visible = (this._jointColorMode === 'openpose');

        // Unit cylinder (height=1 along Y) — scaled in _updateSkeletonLines
        const sharedGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, 1, 8, 1);

        this._skeletonCylinders = [];
        for (const [, , hex] of SKELETON_LIMBS) {
            const mat  = new THREE.MeshBasicMaterial({ color: hex, depthTest: false });
            const mesh = new THREE.Mesh(sharedGeo, mat);
            mesh.renderOrder = 3;
            group.add(mesh);
            this._skeletonCylinders.push(mesh);
        }

        this._skeletonLines = group;
        this._scene.add(group);
        this._updateSkeletonLines();
    }

    _updateSkeletonLines() {
        if (!this._skeletonCylinders || !this._bones.size) return;
        const pA = new THREE.Vector3();
        const pB = new THREE.Vector3();
        const up = new THREE.Vector3(0, 1, 0);

        for (let i = 0; i < SKELETON_LIMBS.length; i++) {
            const [a, b] = SKELETON_LIMBS[i];
            const boneA = this._bones.get(a);
            const boneB = this._bones.get(b);
            const cyl = this._skeletonCylinders[i];
            if (!boneA || !boneB) { cyl.visible = false; continue; }

            boneA.getWorldPosition(pA);
            boneB.getWorldPosition(pB);

            const dir = new THREE.Vector3().subVectors(pB, pA);
            const len = dir.length();
            if (len < 0.001) { cyl.visible = false; continue; }

            cyl.visible = true;
            // Position at midpoint, scale Y to match limb length, rotate Y→dir
            cyl.position.addVectors(pA, pB).multiplyScalar(0.5);
            cyl.scale.set(1, len, 1);
            cyl.quaternion.setFromUnitVectors(up, dir.normalize());
        }
    }

    dispose() {
        if (this._storeUnsub) { this._storeUnsub(); this._storeUnsub = null; }
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

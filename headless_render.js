#!/usr/bin/env node
/**
 * headless_render.js  —  server-side mannequin renderer (no WebGL required)
 *
 * Usage:  node headless_render.js <W> <H> <scene_json_base64>
 * Stdout: one JSON line  { pose, depth, canny, openpose }  (data-URLs, PNG)
 * Exit:   0 ok  |  1 error (message on stderr)
 *
 * How it works:
 *   - Forward kinematics via THREE.Object3D (pure math, no WebGLRenderer)
 *   - 2D projection via THREE.PerspectiveCamera.project()
 *   - Image output via node-canvas (2D canvas API)
 *   - Depth via per-pixel capsule raycasting (CPU)
 *   - Canny via Sobel filter on depth
 */

import { createCanvas } from 'canvas';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

// ── Browser shims (needed by Three.js at construction time) ─────────────────
global.window    = { devicePixelRatio: 1 };
global.document  = { createElement: () => ({ style: {} }) };
global.self      = global;

// ── Three.js (math only — no WebGLRenderer) ──────────────────────────────────
const THREE = await import('./lib/three.module.js');

// ── Constants (inlined from mannequin-model.js / geometry-adapter-gltf.js) ──

const BONE_NAMES = [
    'torso', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'upper_arm_L', 'forearm_L', 'hand_L',
    'shoulder_R', 'upper_arm_R', 'forearm_R', 'hand_R',
    'pelvis',
    'thigh_L', 'shin_L', 'foot_L',
    'thigh_R', 'shin_R', 'foot_R',
];

const BONE_CHILDREN = {
    torso:       ['spine', 'pelvis'],
    spine:       ['chest'],
    chest:       ['neck', 'shoulder_L', 'shoulder_R'],
    neck:        ['head'],
    head:        [],
    shoulder_L:  ['upper_arm_L'],
    upper_arm_L: ['forearm_L'],
    forearm_L:   ['hand_L'],
    hand_L:      [],
    shoulder_R:  ['upper_arm_R'],
    upper_arm_R: ['forearm_R'],
    forearm_R:   ['hand_R'],
    hand_R:      [],
    pelvis:      ['thigh_L', 'thigh_R'],
    thigh_L:     ['shin_L'],
    shin_L:      ['foot_L'],
    foot_L:      [],
    thigh_R:     ['shin_R'],
    shin_R:      ['foot_R'],
    foot_R:      [],
};

// Bone → parent bone (inverse of BONE_CHILDREN)
const BONE_PARENT = {};
for (const [parent, children] of Object.entries(BONE_CHILDREN)) {
    for (const child of children) BONE_PARENT[child] = parent;
}

// Proportions from mannequin-model.js (PROPORTIONS['F'/'M'])
const PROPORTIONS = {
    F: {
        spine:       { length: 0.060, radius: 0.038 },
        chest:       { length: 0.175, width: 0.130, depth: 0.085, radius: 0.050 },
        neck:        { length: 0.055, radius: 0.030 },
        head:        { radius: 0.115 },
        shoulder_L:  { length: 0.040, radius: 0.038 },
        upper_arm_L: { length: 0.155, radius: 0.028 },
        forearm_L:   { length: 0.130, radius: 0.022 },
        hand_L:      { length: 0.060, radius: 0.022 },
        shoulder_R:  { length: 0.040, radius: 0.038 },
        upper_arm_R: { length: 0.155, radius: 0.028 },
        forearm_R:   { length: 0.130, radius: 0.022 },
        hand_R:      { length: 0.060, radius: 0.022 },
        pelvis:      { length: 0.080, width: 0.155, depth: 0.090, radius: 0.050 },
        thigh_L:     { length: 0.230, radius: 0.042 },
        shin_L:      { length: 0.210, radius: 0.032 },
        foot_L:      { length: 0.080, radius: 0.028 },
        thigh_R:     { length: 0.230, radius: 0.042 },
        shin_R:      { length: 0.210, radius: 0.032 },
        foot_R:      { length: 0.080, radius: 0.028 },
        shoulderSpan: 0.270,
    },
    M: {
        spine:       { length: 0.060, radius: 0.044 },
        chest:       { length: 0.185, width: 0.155, depth: 0.100, radius: 0.060 },
        neck:        { length: 0.055, radius: 0.036 },
        head:        { radius: 0.100 },
        shoulder_L:  { length: 0.040, radius: 0.044 },
        upper_arm_L: { length: 0.165, radius: 0.034 },
        forearm_L:   { length: 0.140, radius: 0.028 },
        hand_L:      { length: 0.065, radius: 0.028 },
        shoulder_R:  { length: 0.040, radius: 0.044 },
        upper_arm_R: { length: 0.165, radius: 0.034 },
        forearm_R:   { length: 0.140, radius: 0.028 },
        hand_R:      { length: 0.065, radius: 0.028 },
        pelvis:      { length: 0.080, width: 0.130, depth: 0.090, radius: 0.048 },
        thigh_L:     { length: 0.220, radius: 0.048 },
        shin_L:      { length: 0.210, radius: 0.038 },
        foot_L:      { length: 0.085, radius: 0.032 },
        thigh_R:     { length: 0.220, radius: 0.048 },
        shin_R:      { length: 0.210, radius: 0.038 },
        foot_R:      { length: 0.085, radius: 0.032 },
        shoulderSpan: 0.340,
    },
};

// OpenPose-18 colours (from geometry-adapter-gltf.js / OPENPOSE_COLORS)
const OPENPOSE_COLORS = {
    head:        0xff0000,
    neck:        0xff5500,
    chest:       0xffaa00,
    shoulder_R:  0xffff00, shoulder_L:  0xaaff00,
    upper_arm_R: 0x55ff00, upper_arm_L: 0x00ff55,
    forearm_R:   0x00ffaa, forearm_L:   0x00ffff,
    hand_R:      0x00aaff, hand_L:      0x0055ff,
    pelvis:      0xaa00ff,
    thigh_R:     0xff00aa, thigh_L:     0xaa00aa,
    shin_R:      0x0000ff, shin_L:      0x5500ff,
    foot_R:      0xaaaaff, foot_L:      0xff55ff,
    torso:       0xaaaaaa, spine:       0x888888,
};

// COCO limb connections (from mannequin-renderer.js SKELETON_LIMBS)
const SKELETON_LIMBS = [
    ['neck',        'head',        0xff0000],
    ['neck',        'shoulder_R',  0xffaa00],
    ['shoulder_R',  'forearm_R',   0xffff00],
    ['forearm_R',   'hand_R',      0xaaff00],
    ['neck',        'shoulder_L',  0x55ff00],
    ['shoulder_L',  'forearm_L',   0x00ff00],
    ['forearm_L',   'hand_L',      0x00ff55],
    ['neck',        'thigh_R',     0x00ffaa],
    ['thigh_R',     'shin_R',      0x00ffff],
    ['shin_R',      'foot_R',      0x00aaff],
    ['neck',        'thigh_L',     0x0055ff],
    ['thigh_L',     'shin_L',      0x0000ff],
    ['shin_L',      'foot_L',      0x5500ff],
];

const WORLD_HEIGHT = 2.0;

// ── Helpers ──────────────────────────────────────────────────────────────────

function rgb(hex) {
    return `rgb(${(hex >> 16) & 0xff},${(hex >> 8) & 0xff},${hex & 0xff})`;
}

// Rest-pose offsets in parent-local space.
// T-pose: spine/neck/head go up (+Y), arms go outward (±X), legs go down (-Y).
function getBoneOffset(childName, props) {
    const parent = BONE_PARENT[childName];
    if (!parent) return new THREE.Vector3(0, 0, 0);
    const pp = props[parent] ?? {};
    const cp = props[childName] ?? {};
    const span = props.shoulderSpan ?? 0.27;
    const hw   = (props.pelvis?.width ?? 0.155) / 2;

    switch (childName) {
        // Spine chain — up (+Y)
        case 'spine':  return new THREE.Vector3(0,  0,                    0);
        case 'chest':  return new THREE.Vector3(0,  pp.length ?? 0.060,   0);
        case 'neck':   return new THREE.Vector3(0,  pp.length ?? 0.175,   0);
        case 'head':   return new THREE.Vector3(0,  pp.length ?? 0.055,   0);

        // Shoulders — sides of chest top
        case 'shoulder_L': return new THREE.Vector3(-span / 2,  pp.length ?? 0.175, 0);
        case 'shoulder_R': return new THREE.Vector3(+span / 2,  pp.length ?? 0.175, 0);

        // Arms — outward along ±X
        case 'upper_arm_L': return new THREE.Vector3(-(pp.length ?? 0.040), 0, 0);
        case 'upper_arm_R': return new THREE.Vector3(+(pp.length ?? 0.040), 0, 0);
        case 'forearm_L':   return new THREE.Vector3(-(pp.length ?? 0.155), 0, 0);
        case 'forearm_R':   return new THREE.Vector3(+(pp.length ?? 0.155), 0, 0);
        case 'hand_L':      return new THREE.Vector3(-(pp.length ?? 0.130), 0, 0);
        case 'hand_R':      return new THREE.Vector3(+(pp.length ?? 0.130), 0, 0);

        // Pelvis — below torso
        case 'pelvis':  return new THREE.Vector3(0, 0, 0); // torso origin IS the pelvis-top

        // Thighs — sides of pelvis, going down
        case 'thigh_L': return new THREE.Vector3(-hw, -(pp.length ?? 0.080), 0);
        case 'thigh_R': return new THREE.Vector3(+hw, -(pp.length ?? 0.080), 0);

        // Legs — down (-Y)
        case 'shin_L':  return new THREE.Vector3(0, -(pp.length ?? 0.230), 0);
        case 'shin_R':  return new THREE.Vector3(0, -(pp.length ?? 0.230), 0);
        case 'foot_L':  return new THREE.Vector3(0, -(pp.length ?? 0.210), 0);
        case 'foot_R':  return new THREE.Vector3(0, -(pp.length ?? 0.210), 0);

        default: return new THREE.Vector3(0, pp.length ?? 0, 0);
    }
}

// ── Build bone hierarchy ──────────────────────────────────────────────────────

function buildBones(scene, sceneData, props) {
    const bones = new Map();

    // Create Object3D per bone
    for (const name of BONE_NAMES) {
        const obj = new THREE.Object3D();
        obj.name = name;
        bones.set(name, obj);
    }

    // Build parent-child hierarchy and set rest-pose positions
    function attach(parentName) {
        const parentObj = bones.get(parentName);
        for (const childName of (BONE_CHILDREN[parentName] ?? [])) {
            const childObj = bones.get(childName);
            parentObj.add(childObj);
            childObj.position.copy(getBoneOffset(childName, props));
            attach(childName);
        }
    }

    // Position torso so feet end up at Y≈0
    const torso = bones.get('torso');
    scene.add(torso);
    attach('torso');

    // Compute total character height and position torso so feet rest at Y=0
    const aboveTorso = (props.spine?.length   ?? 0.060)
        + (props.chest?.length  ?? 0.175)
        + (props.neck?.length   ?? 0.055)
        + (props.head?.radius   ?? 0.115) * 2;
    const belowTorso = (props.pelvis?.length  ?? 0.080)
        + (props.thigh_L?.length ?? 0.230)
        + (props.shin_L?.length  ?? 0.210)
        + (props.foot_L?.length  ?? 0.080);
    const totalHeight = aboveTorso + belowTorso;
    const scale = WORLD_HEIGHT / totalHeight;
    torso.scale.setScalar(scale);
    // Move torso up so the bottom of the leg chain (feet) is near Y=0
    torso.position.set(0, belowTorso * scale + 0.04, 0);

    // Apply quaternion rotations from scene JSON
    for (const [name, boneData] of Object.entries(sceneData.bones ?? {})) {
        const bone = bones.get(name);
        if (!bone || !boneData.rotation) continue;
        const [x, y, z, w] = boneData.rotation;
        bone.quaternion.set(x, y, z, w);
    }

    // Apply proportions from scene (scale per region)
    const proportionsFromScene = sceneData.proportions ?? {};
    const scaleFor = {
        head: proportionsFromScene.head ?? 1,
        bust: proportionsFromScene.bust ?? 1,
        hips: proportionsFromScene.hips ?? 1,
        waist: proportionsFromScene.waist ?? 1,
        legs: proportionsFromScene.legs ?? 1,
        arms: proportionsFromScene.arms ?? 1,
    };
    const PROP_GROUP = {
        head: 'head', neck: 'head',
        chest: 'bust', shoulder_L: 'arms', shoulder_R: 'arms',
        upper_arm_L: 'arms', forearm_L: 'arms', hand_L: 'arms',
        upper_arm_R: 'arms', forearm_R: 'arms', hand_R: 'arms',
        pelvis: 'hips',
        thigh_L: 'legs', shin_L: 'legs', foot_L: 'legs',
        thigh_R: 'legs', shin_R: 'legs', foot_R: 'legs',
        spine: 'waist',
    };
    for (const name of BONE_NAMES) {
        const group = PROP_GROUP[name];
        if (!group) continue;
        const s = scaleFor[group] ?? 1;
        if (Math.abs(s - 1) > 0.001) {
            bones.get(name).scale.setScalar(s);
        }
    }

    scene.updateMatrixWorld(true);
    return bones;
}

// ── Camera setup ─────────────────────────────────────────────────────────────

function buildCamera(W, H, sceneCamera) {
    const { azimuth = 0, elevation = 5, distance = 2.5 } = sceneCamera ?? {};
    const camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 100);

    const az  = (azimuth  * Math.PI) / 180;
    const el  = (elevation * Math.PI) / 180;
    const cx  = distance * Math.sin(az) * Math.cos(el);
    const cy  = distance * Math.sin(el) + WORLD_HEIGHT * 0.5;
    const cz  = distance * Math.cos(az) * Math.cos(el);
    camera.position.set(cx, cy, cz);
    camera.lookAt(0, WORLD_HEIGHT * 0.5, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
}

// ── 2D projection helper ──────────────────────────────────────────────────────

function projectBones(bones, camera, W, H) {
    const sp = new Map();
    const tmp = new THREE.Vector3();
    for (const [name, bone] of bones) {
        bone.getWorldPosition(tmp);
        const p = tmp.clone().project(camera);
        sp.set(name, {
            x:  (p.x *  0.5 + 0.5) * W,
            y:  (p.y * -0.5 + 0.5) * H,
            z:  p.z,   // NDC depth [-1,1], closer to camera = more negative
        });
    }
    return sp;
}

// ── Render: POSE (2D OpenPose skeleton on black) ─────────────────────────────

function renderPose(sp, W, H) {
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const dotR  = Math.max(5, Math.round(W / 70));
    const lineW = Math.max(3, Math.round(W / 90));
    ctx.lineWidth = lineW;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    for (const [a, b, col] of SKELETON_LIMBS) {
        const pa = sp.get(a), pb = sp.get(b);
        if (!pa || !pb) continue;
        ctx.strokeStyle = rgb(col);
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    const drawn = new Set();
    for (const [a, b] of SKELETON_LIMBS) {
        for (const k of [a, b]) {
            if (drawn.has(k)) continue;
            drawn.add(k);
            const p = sp.get(k);
            if (!p) continue;
            const col = OPENPOSE_COLORS[k] ?? 0xffffff;
            ctx.fillStyle = rgb(col);
            ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2); ctx.fill();
        }
    }
    return canvas.toDataURL('image/png');
}

// ── Depth ray helpers ─────────────────────────────────────────────────────────

function _raySphereT(px, py, pz, dx, dy, dz, cx, cy, cz, r) {
    const ox = px - cx, oy = py - cy, oz = pz - cz;
    const b  = dx * ox + dy * oy + dz * oz;
    const c  = ox * ox + oy * oy + oz * oz - r * r;
    const disc = b * b - c;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t > 0 ? t : Infinity;
}

function _rayCapsuleT(px, py, pz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
    const segX = bx - ax, segY = by - ay, segZ = bz - az;
    const seg2 = segX * segX + segY * segY + segZ * segZ;
    if (seg2 < 1e-10) return _raySphereT(px, py, pz, dx, dy, dz, ax, ay, az, r);

    const ox = px - ax, oy = py - ay, oz = pz - az;
    const inv2   = 1 / seg2;
    const d_s    = (dx * segX + dy * segY + dz * segZ) * inv2;
    const o_s    = (ox * segX + oy * segY + oz * segZ) * inv2;

    // Component of ray dir perpendicular to capsule axis
    const nx = dx - segX * d_s, ny = dy - segY * d_s, nz = dz - segZ * d_s;
    // Component of origin-offset perpendicular to capsule axis
    const fx = ox - segX * o_s, fy = oy - segY * o_s, fz = oz - segZ * o_s;

    const a = nx * nx + ny * ny + nz * nz;
    const b_c = 2 * (nx * fx + ny * fy + nz * fz);
    const c_c = fx * fx + fy * fy + fz * fz - r * r;

    if (a < 1e-12) {
        // Ray nearly parallel to capsule axis — just test sphere caps
        return Math.min(
            _raySphereT(px, py, pz, dx, dy, dz, ax, ay, az, r),
            _raySphereT(px, py, pz, dx, dy, dz, bx, by, bz, r),
        );
    }

    const disc = b_c * b_c - 4 * a * c_c;
    if (disc >= 0) {
        const sq = Math.sqrt(disc);
        for (const t of [(-b_c - sq) / (2 * a), (-b_c + sq) / (2 * a)]) {
            if (t <= 0) continue;
            // Project hit point onto capsule segment; must be in [0,1]
            const proj = ((ox + t * dx) * segX + (oy + t * dy) * segY + (oz + t * dz) * segZ) * inv2;
            if (proj >= 0 && proj <= 1) return t;
        }
    }
    // Check hemisphere end-caps
    return Math.min(
        _raySphereT(px, py, pz, dx, dy, dz, ax, ay, az, r),
        _raySphereT(px, py, pz, dx, dy, dz, bx, by, bz, r),
    );
}

// ── Render: DEPTH via capsule + sphere raycast ────────────────────────────────
// Body = set of capsules (limb segments) + sphere for head.
// Float32 buffer → no precision loss; correct normalisation to [DEPTH_MIN, 255].

function renderDepth(bones, camera, W, H, props) {
    const torsoScale = bones.get('torso').scale.x;
    const tmp1 = new THREE.Vector3();
    const tmp2 = new THREE.Vector3();

    // Capsule: [parentBone, childBone, radiusSourceBone]
    const SEGMENTS = [
        ['torso',       'spine',       'spine'],
        ['spine',       'chest',       'chest'],
        ['chest',       'neck',        'neck'],
        ['chest',       'shoulder_L',  'shoulder_L'],
        ['shoulder_L',  'upper_arm_L', 'upper_arm_L'],
        ['upper_arm_L', 'forearm_L',   'forearm_L'],
        ['forearm_L',   'hand_L',      'hand_L'],
        ['chest',       'shoulder_R',  'shoulder_R'],
        ['shoulder_R',  'upper_arm_R', 'upper_arm_R'],
        ['upper_arm_R', 'forearm_R',   'forearm_R'],
        ['forearm_R',   'hand_R',      'hand_R'],
        ['torso',       'pelvis',      'pelvis'],
        ['pelvis',      'thigh_L',     'thigh_L'],
        ['thigh_L',     'shin_L',      'shin_L'],
        ['shin_L',      'foot_L',      'foot_L'],
        ['pelvis',      'thigh_R',     'thigh_R'],
        ['thigh_R',     'shin_R',      'shin_R'],
        ['shin_R',      'foot_R',      'foot_R'],
    ];

    const capsules = [];
    for (const [pName, cName, rName] of SEGMENTS) {
        const pb = bones.get(pName), cb = bones.get(cName);
        if (!pb || !cb) continue;
        pb.getWorldPosition(tmp1); cb.getWorldPosition(tmp2);
        const bp = props[rName] ?? {};
        const r  = (bp.radius ?? (bp.width ?? 0.05) * 0.5) * torsoScale;
        capsules.push({ ax: tmp1.x, ay: tmp1.y, az: tmp1.z,
                        bx: tmp2.x, by: tmp2.y, bz: tmp2.z, r });
    }

    // Head sphere (special — larger than capsule radius)
    bones.get('head').getWorldPosition(tmp1);
    const headR  = (props.head?.radius ?? 0.115) * torsoScale;
    const headSphere = { cx: tmp1.x, cy: tmp1.y, cz: tmp1.z, r: headR };

    // Unproject camera ray per pixel
    const invPV = new THREE.Matrix4()
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
        .invert();
    const cp = camera.position;

    const buf = new Float32Array(W * H);  // 0 = background
    let minD = Infinity, maxD = -Infinity;

    for (let row = 0; row < H; row++) {
        for (let col = 0; col < W; col++) {
            const nx  = (col + 0.5) / W * 2 - 1;
            const ny  = -(row + 0.5) / H * 2 + 1;
            const far = new THREE.Vector4(nx, ny, 1, 1).applyMatrix4(invPV);
            const fx  = far.x / far.w, fy = far.y / far.w, fz = far.z / far.w;
            const rdx = fx - cp.x, rdy = fy - cp.y, rdz = fz - cp.z;
            const rl  = Math.sqrt(rdx * rdx + rdy * rdy + rdz * rdz);
            const rx  = rdx / rl, ry = rdy / rl, rz = rdz / rl;

            let tMin = _raySphereT(cp.x, cp.y, cp.z, rx, ry, rz,
                                   headSphere.cx, headSphere.cy, headSphere.cz, headSphere.r);
            for (const { ax, ay, az, bx, by, bz, r } of capsules) {
                const t = _rayCapsuleT(cp.x, cp.y, cp.z, rx, ry, rz, ax, ay, az, bx, by, bz, r);
                if (t < tMin) tMin = t;
            }

            if (tMin < Infinity) {
                buf[row * W + col] = tMin;
                if (tMin < minD) minD = tMin;
                if (tMin > maxD) maxD = tMin;
            }
        }
    }

    // Normalise: near → 255 (bright), far → DEPTH_MIN (dark), background → 0
    const DEPTH_MIN = 30;
    const range     = maxD - minD || 1;
    const canvas    = createCanvas(W, H);
    const ctx       = canvas.getContext('2d');
    const imgData   = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
        const v    = buf[i];
        const norm = v === 0 ? 0 : Math.round(255 - (v - minD) / range * (255 - DEPTH_MIN));
        imgData.data[i * 4]     = norm;
        imgData.data[i * 4 + 1] = norm;
        imgData.data[i * 4 + 2] = norm;
        imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
}

// ── Render: CANNY via Sobel on depth canvas ───────────────────────────────────

function renderCanny(depthDataUrl, W, H) {
    const img    = new (require('canvas').Image)();
    img.src      = Buffer.from(depthDataUrl.split(',')[1], 'base64');
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const src = ctx.getImageData(0, 0, W, H).data;
    const out = new Uint8ClampedArray(W * H * 4);
    const kx  = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const ky  = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            let gx = 0, gy = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const lum = src[((y + dy) * W + (x + dx)) * 4]; // R = G = B for greyscale
                    const ki  = (dy + 1) * 3 + (dx + 1);
                    gx += lum * kx[ki];
                    gy += lum * ky[ki];
                }
            }
            const v = Math.sqrt(gx * gx + gy * gy) > 30 ? 255 : 0;
            const d = (y * W + x) * 4;
            out[d] = out[d + 1] = out[d + 2] = v;
            out[d + 3] = 255;
        }
    }
    const id = ctx.createImageData(W, H);
    id.data.set(out);
    ctx.putImageData(id, 0, 0);
    return canvas.toDataURL('image/png');
}

// ── Render: OPENPOSE reference (coloured blobs + skeleton lines, grey bg) ────

function renderOpenposeRef(sp, W, H, props) {
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext('2d');
    ctx.fillStyle = '#4a4a4a';
    ctx.fillRect(0, 0, W, H);

    // Draw coloured filled circles per joint (radius scaled to image size)
    const baseR = W / 14;
    for (const name of BONE_NAMES) {
        const p = sp.get(name);
        if (!p) continue;
        const col = OPENPOSE_COLORS[name] ?? 0xaaaaaa;
        // Depth-based scaling: closer joints appear slightly larger
        const depthS = Math.max(0.6, Math.min(1.3, 1 - p.z * 0.25));
        const r = baseR * (props[name]?.radius ?? 0.04) * 18 * depthS;
        ctx.fillStyle = rgb(col);
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    }

    // Skeleton lines on top
    const lineW = Math.max(2, Math.round(W / 100));
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    for (const [a, b, col] of SKELETON_LIMBS) {
        const pa = sp.get(a), pb = sp.get(b);
        if (!pa || !pb) continue;
        ctx.strokeStyle = rgb(col);
        ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return canvas.toDataURL('image/png');
}

// ── Main ─────────────────────────────────────────────────────────────────────

import * as fs from 'fs';

try {
    const [,, W_str, H_str, sceneB64, outPath] = process.argv;
    if (!W_str || !H_str || !sceneB64) {
        process.stderr.write('Usage: headless_render.js <W> <H> <scene_json_base64> [output_file]\n');
        process.exit(1);
    }
    const W     = parseInt(W_str, 10);
    const H     = parseInt(H_str, 10);
    const scene = JSON.parse(Buffer.from(sceneB64, 'base64').toString('utf8'));

    if (!W || !H || W < 1 || H < 1) throw new Error(`Invalid dimensions: ${W}x${H}`);

    const gender = (scene.gender === 'M') ? 'M' : 'F';
    const props  = PROPORTIONS[gender];

    // Build Three.js scene (pure math, no WebGLRenderer)
    const threeScene = new THREE.Scene();
    const bones      = buildBones(threeScene, scene, props);
    const camera     = buildCamera(W, H, scene.camera);

    // Project all bones to 2D screen coords
    const sp = projectBones(bones, camera, W, H);

    // Render 4 outputs
    const pose     = renderPose(sp, W, H);
    const depth    = renderDepth(bones, camera, W, H, props);
    const canny    = renderCanny(depth, W, H);
    const openpose = renderOpenposeRef(sp, W, H, props);

    // Collect bone world transforms for Python GLB posed rendering
    const boneTransforms = {};
    for (const [name, bone] of bones) {
        const pos  = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        bone.getWorldPosition(pos);
        bone.getWorldQuaternion(quat);
        boneTransforms[name] = {
            pos:  [pos.x, pos.y, pos.z],
            quat: [quat.x, quat.y, quat.z, quat.w],
        };
    }
    const result = JSON.stringify({ pose, depth, canny, openpose, bones: boneTransforms });

    if (outPath) {
        // Write to file (avoids stdout pipe-buffer truncation for large images)
        fs.writeFileSync(outPath, result, 'utf8');
    } else {
        process.stdout.write(result + '\n');
    }
    process.exit(0);

} catch (err) {
    process.stderr.write(`ERROR: ${err.message}\n${err.stack}\n`);
    process.exit(1);
}

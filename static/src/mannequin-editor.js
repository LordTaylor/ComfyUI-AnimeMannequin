import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { TransformControls } from '../lib/TransformControls.js';
import { SELECT_COLOR, JOINT_COLOR } from './geometry-adapter-gltf.js';
import { defaultScene } from './mannequin-model.js';

const UNDO_LIMIT = 20;

export class MannequinEditor {
    constructor(renderer, canvas) {
        this._renderer  = renderer;
        this._canvas    = canvas;
        this._raycaster = new THREE.Raycaster();
        this._mouse     = new THREE.Vector2();
        this._selectedBone = null;
        this._selectedSphere = null;

        this._undoStack  = [];            // array of scene JSON snapshots
        this._gender     = 'F';
        this._buildChain = Promise.resolve(); // serialises concurrent buildMannequin calls

        // OrbitControls
        this._orbit = new OrbitControls(renderer.camera, canvas);
        this._orbit.target.set(0, 1.0, 0);   // look at torso center
        this._orbit.enableDamping = true;
        this._orbit.addEventListener('change', () => renderer.markDirty());

        // TransformControls — rotation in local space
        this._transform = new TransformControls(renderer.camera, canvas);
        this._transform.setMode('rotate');
        this._transform.setSpace('local');
        renderer.scene.add(this._transform);

        this._transform.addEventListener('dragging-changed', (e) => {
            this._orbit.enabled = !e.value;
            if (!e.value) this._saveUndoSnapshot(); // capture after drag ends
        });
        this._transform.addEventListener('change', () => renderer.markDirty());

        // Pointer events — store bound refs so dispose() can remove them
        this._boundClick   = this._onCanvasClick.bind(this);
        this._boundKeyDown = this._onKeyDown.bind(this);
        canvas.addEventListener('click',   this._boundClick);
        window.addEventListener('keydown', this._boundKeyDown);
    }

    get gender() { return this._gender; }

    buildMannequin(gender, sceneData) {
        // Serialise calls — prevents race condition when gender is toggled rapidly
        this._buildChain = this._buildChain.then(() => this._doBuildMannequin(gender, sceneData));
        return this._buildChain;
    }

    async _doBuildMannequin(gender, sceneData) {
        this._gender = gender;
        this._deselect();
        await this._renderer.buildMannequin(gender, sceneData);
        this._undoStack = [];
        this._saveUndoSnapshot();
        this._renderer.markDirty();
    }

    async setGender(gender) {
        const currentScene = this._renderer.getSceneData(this._gender);
        currentScene.gender = gender;
        await this.buildMannequin(gender, currentScene);
    }

    getSceneData() {
        return this._renderer.getSceneData(this._gender);
    }

    undo() {
        if (this._undoStack.length <= 1) return;
        this._undoStack.pop();
        const snap = this._undoStack[this._undoStack.length - 1];
        this._renderer.applyScene(JSON.parse(snap));
        this._deselect();
        this._renderer.markDirty();
    }

    resetPose() {
        const scene = defaultScene(this._gender);
        this._renderer.applyScene(scene);
        this._undoStack = [];
        this._saveUndoSnapshot();
        this._deselect();
        this._renderer.markDirty();
    }

    mirrorPose(direction = 'L_to_R') {
        const pairs = [
            ['shoulder_L', 'shoulder_R'],
            ['upper_arm_L', 'upper_arm_R'],
            ['forearm_L',   'forearm_R'],
            ['hand_L',      'hand_R'],
            ['thigh_L',     'thigh_R'],
            ['shin_L',      'shin_R'],
            ['foot_L',      'foot_R'],
        ];
        for (const [l, r] of pairs) {
            const [src, dst] = direction === 'L_to_R' ? [l, r] : [r, l];
            const srcBone = this._renderer.bones.get(src);
            const dstBone = this._renderer.bones.get(dst);
            if (!srcBone || !dstBone) continue;
            const q = srcBone.quaternion;
            // L→R: negate qx (left-bone local frame convention).
            // R→L: negate qy+qz instead — right-bone local frames share orientation with left,
            //       so the mirror is the conjugate of the L→R formula.
            if (direction === 'L_to_R') {
                dstBone.quaternion.set(-q.x,  q.y,  q.z, q.w);
            } else {
                dstBone.quaternion.set( q.x, -q.y, -q.z, q.w);
            }
        }
        this._saveUndoSnapshot();
        this._renderer.markDirty();
    }

    // Applies a scene and saves undo snapshot — use this from external callers (pose library, bridge)
    applySceneWithUndo(sceneData) {
        this._saveUndoSnapshot(); // save BEFORE applying so we can undo back to current state
        this._renderer.applyScene(sceneData);
        this._renderer.markDirty();
    }

    // [minX, maxX, minY, maxY, minZ, maxZ] in degrees
    // Hinge joints (forearm, shin) constrained to one bending direction only,
    // near-zero Y/Z — they do NOT bend backwards or sideways.
    static RANDOM_LIMITS_SAFE = {
        torso:       null,
        spine:       [ -8,  8, -12, 12,  -6,  6],
        chest:       [ -8,  8,  -8,  8,  -5,  5],
        neck:        [-15, 15, -20, 20, -10, 10],
        head:        [-12, 12, -20, 20,  -8,  8],
        shoulder_L:  [-20, 40, -18, 18, -50, 25],
        upper_arm_L: [-55, 30, -35, 35, -18, 18],
        forearm_L:   [  0, 80,  -4,  4,  -4,  4], // hinge: X≥0 only
        hand_L:      [-18, 18, -18, 18, -10, 10],
        shoulder_R:  [-20, 40, -18, 18, -25, 50],
        upper_arm_R: [-55, 30, -35, 35, -18, 18],
        forearm_R:   [  0, 80,  -4,  4,  -4,  4], // hinge
        hand_R:      [-18, 18, -18, 18, -10, 10],
        pelvis:      [ -6,  6,  -6,  6,  -4,  4],
        thigh_L:     [-35, 20, -18, 18, -20, 10],
        shin_L:      [-70,  0,  -4,  4,  -4,  4], // hinge: X≤0 only
        foot_L:      [-18, 18,  -8,  8,  -8,  8],
        thigh_R:     [-35, 20, -18, 18, -10, 20],
        shin_R:      [-70,  0,  -4,  4,  -4,  4], // hinge
        foot_R:      [-18, 18,  -8,  8,  -8,  8],
    };

    static RANDOM_LIMITS_WILD = {
        torso:       null,
        spine:       [-45, 45, -45, 45, -30, 30],
        chest:       [-35, 35, -35, 35, -25, 25],
        neck:        [-55, 55, -70, 70, -35, 35],
        head:        [-40, 40, -65, 65, -30, 30],
        shoulder_L:  [-60,130, -60, 60, -120, 90],
        upper_arm_L: [-130, 90, -90, 90, -60, 60],
        forearm_L:   [  0, 145,  -6,  6,  -6,  6], // hinge: never backwards, minimal Y/Z
        hand_L:      [-60, 60, -60, 60, -40, 40],
        shoulder_R:  [-60,130, -60, 60,  -90,120],
        upper_arm_R: [-130, 90, -90, 90, -60, 60],
        forearm_R:   [  0, 145,  -6,  6,  -6,  6], // hinge
        hand_R:      [-60, 60, -60, 60, -40, 40],
        pelvis:      [-30, 30, -30, 30, -20, 20],
        thigh_L:     [-100, 75, -55, 55, -75, 40],
        shin_L:      [-140,   0,  -6,  6,  -6,  6], // hinge: never forward
        foot_L:      [-60, 60, -30, 30, -30, 30],
        thigh_R:     [-100, 75, -55, 55, -40, 75],
        shin_R:      [-140,   0,  -6,  6,  -6,  6], // hinge
        foot_R:      [-60, 60, -30, 30, -30, 30],
    };

    generateRandomPose(mode = 'safe') {
        const DEG    = Math.PI / 180;
        const rnd    = (lo, hi) => (lo + Math.random() * (hi - lo)) * DEG;
        const LIMITS = mode === 'wild'
            ? MannequinEditor.RANDOM_LIMITS_WILD
            : MannequinEditor.RANDOM_LIMITS_SAFE;

        this._saveUndoSnapshot();
        const euler = new THREE.Euler();
        const quat  = new THREE.Quaternion();

        for (const [boneName, limits] of Object.entries(LIMITS)) {
            if (!limits) continue;
            const bone = this._renderer.bones.get(boneName);
            if (!bone) continue;
            const [x0,x1,y0,y1,z0,z1] = limits;
            euler.set(rnd(x0,x1), rnd(y0,y1), rnd(z0,z1), 'XYZ');
            quat.setFromEuler(euler);
            bone.quaternion.copy(quat);
        }

        this._renderer.markDirty();
        return this._renderer.getSceneData(this._gender);
    }

    _saveUndoSnapshot() {
        const json = JSON.stringify(this._renderer.getSceneData(this._gender));
        // Skip duplicate snapshots (e.g. mousedown+immediate mouseup with no rotation)
        if (this._undoStack.length && this._undoStack[this._undoStack.length - 1] === json) return;
        this._undoStack.push(json);
        if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
    }

    _onCanvasClick(e) {
        const rect = this._canvas.getBoundingClientRect();
        this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this._renderer.camera);
        // Raycast against joint spheres (hit targets) AND body segment meshes.
        // This lets the user click anywhere on a limb, not just the small pivot dot.
        const pickables = [];
        this._renderer.scene.traverse(obj => {
            if (obj.userData.isJoint || (obj.isMesh && obj.userData.boneName && !obj.userData.isJoint))
                pickables.push(obj);
        });
        const hits = this._raycaster.intersectObjects(pickables, false);

        if (hits.length > 0) {
            const hit = hits[0].object;
            const boneName = hit.userData.boneName;
            // Resolve the visible joint sphere for visual highlight
            let sphere = null;
            const boneGroup = hit.parent;
            if (boneGroup) {
                sphere = boneGroup.children.find(c => c.userData.isJoint && !c.userData.isHitTarget) ?? null;
            }
            this._selectBone(boneName, sphere);
        } else {
            this._deselect();
        }
        this._renderer.markDirty();
    }

    _selectBone(boneName, sphereMesh) {
        this._deselect();
        this._selectedBone   = boneName;
        this._selectedSphere = sphereMesh ?? null;
        if (sphereMesh) sphereMesh.material.color.setHex(SELECT_COLOR);

        const boneObj = this._renderer.bones.get(boneName);
        if (boneObj) this._transform.attach(boneObj);
        this._renderer.markDirty();
    }

    _deselect() {
        if (this._selectedSphere) {
            const origColor = this._selectedSphere.userData.originalColor ?? JOINT_COLOR;
            this._selectedSphere.material.color.setHex(origColor);
            this._selectedSphere = null;
        }
        this._selectedBone = null;
        this._transform.detach();
    }

    _onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
        }
    }

    update() {
        this._orbit.update();
    }

    dispose() {
        this._canvas.removeEventListener('click',   this._boundClick);
        window.removeEventListener('keydown',       this._boundKeyDown);
        this._orbit.dispose();
        this._transform.dispose();
    }
}

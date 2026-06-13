import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { TransformControls } from '../lib/TransformControls.js';
import { SELECT_COLOR, JOINT_COLOR } from './geometry-adapter-gltf.js';
import { defaultScene } from './mannequin-model.js';
import {
    CommandHistory,
    RotateBoneCommand,
    SetGenderCommand,
    ResetPoseCommand,
    MirrorPoseCommand,
    RandomPoseCommand,
    SetJointColorModeCommand,
    TransformPropCommand,
} from './commands.js';

/** Read a prop Object3D's transform into the prop-state shape (uniform scale = scale.x). */
export function propTransformFromObject(obj) {
    return {
        position: [obj.position.x, obj.position.y, obj.position.z],
        rotation: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w],
        scale: obj.scale.x,
    };
}

const UNDO_LIMIT = 20;

export class MannequinEditor {
    /**
     * @param {import('./mannequin-renderer.js').MannequinRenderer} renderer
     * @param {HTMLCanvasElement} canvas
     * @param {import('./app-store.js').AppStore} store
     */
    constructor(renderer, canvas, store) {
        this._renderer  = renderer;
        this._canvas    = canvas;
        this._store     = store;
        this._raycaster = new THREE.Raycaster();
        this._mouse     = new THREE.Vector2();
        this._selectedBone   = null;
        this._selectedSphere = null;

        // Phase 4: CommandHistory replaces private undo stack
        this._history = new CommandHistory(UNDO_LIMIT);

        this._gender     = store?.getState().gender ?? 'F';
        this._buildChain = Promise.resolve();

        // Prop selection state
        this._selectedProp   = null;   // { id, obj } when a prop is selected
        this._propBeforeDrag = null;   // propTransformFromObject snapshot before drag

        // OrbitControls
        this._orbit = new OrbitControls(renderer.camera, canvas);
        this._orbit.target.set(0, 1.0, 0);
        this._orbit.enableDamping = true;
        this._orbit.addEventListener('change', () => renderer.markDirty());

        // TransformControls — rotation in local space
        this._transform = new TransformControls(renderer.camera, canvas);
        this._transform.setMode('rotate');
        this._transform.setSpace('local');
        this._transform.userData.isGizmo = true;
        renderer.scene.add(this._transform);

        // Capture bone/prop transform before drag starts (for undo)
        this._quatBeforeDrag = null;
        this._transform.addEventListener('mouseDown', () => {
            if (this._selectedBone) {
                const bone = this._renderer.bones.get(this._selectedBone);
                if (bone) {
                    const q = bone.quaternion;
                    this._quatBeforeDrag = { x: q.x, y: q.y, z: q.z, w: q.w };
                }
            }
            if (this._selectedProp?.obj) {
                this._propBeforeDrag = propTransformFromObject(this._selectedProp.obj);
            }
        });

        this._transform.addEventListener('dragging-changed', (e) => {
            this._orbit.enabled = !e.value;
            if (!e.value) {
                // Bone drag ended
                if (this._selectedBone && this._quatBeforeDrag) {
                    const bone = this._renderer.bones.get(this._selectedBone);
                    if (bone) {
                        const q = bone.quaternion;
                        const nextQuat = { x: q.x, y: q.y, z: q.z, w: q.w };
                        // Only commit if rotation actually changed
                        const prev = this._quatBeforeDrag;
                        if (prev.x !== nextQuat.x || prev.y !== nextQuat.y ||
                            prev.z !== nextQuat.z || prev.w !== nextQuat.w) {
                            if (this._store) {
                                this._history.execute(
                                    new RotateBoneCommand(this._selectedBone, prev, nextQuat),
                                    this._store
                                );
                            }
                        }
                    }
                    this._quatBeforeDrag = null;
                }

                // Prop drag ended
                if (this._selectedProp && this._propBeforeDrag) {
                    const next = propTransformFromObject(this._selectedProp.obj);
                    const prev = this._propBeforeDrag;
                    // Only commit if something actually changed
                    const changed =
                        prev.scale !== next.scale ||
                        prev.position.some((v, i) => v !== next.position[i]) ||
                        prev.rotation.some((v, i) => v !== next.rotation[i]);
                    if (changed && this._store) {
                        this._history.execute(
                            new TransformPropCommand(this._selectedProp.id, prev, next),
                            this._store
                        );
                    }
                    this._propBeforeDrag = null;
                }
            }
        });
        this._transform.addEventListener('change', () => renderer.markDirty());

        // Pointer events
        this._boundClick   = this._onCanvasClick.bind(this);
        this._boundKeyDown = this._onKeyDown.bind(this);
        canvas.addEventListener('click',   this._boundClick);
        window.addEventListener('keydown', this._boundKeyDown);
    }

    get gender()  { return this._gender; }
    get history() { return this._history; }

    // ── Build ──────────────────────────────────────────────────────────────────

    buildMannequin(gender, sceneData) {
        this._buildChain = this._buildChain.then(() => this._doBuildMannequin(gender, sceneData));
        return this._buildChain;
    }

    async _doBuildMannequin(gender, sceneData) {
        this._gender = gender;
        this._deselect();
        await this._renderer.buildMannequin(gender, sceneData);
        this._history.clear();
        this._renderer.markDirty();
    }

    async setGender(gender) {
        const currentState = this._store?.getState();
        const prevGender   = currentState?.gender ?? this._gender;
        const prevPose     = currentState?.pose   ?? {};
        const defPose      = {};  // default = empty pose (renderer resets to A-pose)

        if (this._store) {
            this._history.execute(
                new SetGenderCommand(prevGender, gender, prevPose, defPose),
                this._store
            );
        }

        this._gender = gender;
        await this._renderer.buildMannequin(gender, null);
        this._renderer.markDirty();
    }

    getSceneData() {
        return this._renderer.getSceneData(this._gender);
    }

    // ── Undo / Redo ────────────────────────────────────────────────────────────

    undo() {
        if (!this._history.canUndo) return;
        this._history.undo(this._store);
        this._applyPoseFromStore();
        this._deselect();
        this._renderer.markDirty();
    }

    redo() {
        if (!this._history.canRedo) return;
        this._history.redo(this._store);
        this._applyPoseFromStore();
        this._renderer.markDirty();
    }

    // ── Pose operations ────────────────────────────────────────────────────────

    resetPose() {
        const prevPose = this._store?.getState().pose ?? {};
        const defPose  = {};
        if (this._store) {
            this._history.execute(new ResetPoseCommand(prevPose, defPose), this._store);
        }
        const scene = defaultScene(this._gender);
        this._renderer.applyScene(scene);
        this._deselect();
        this._renderer.markDirty();
    }

    static MIRROR_PAIRS = [
        ['shoulder_L', 'shoulder_R'], ['upper_arm_L', 'upper_arm_R'],
        ['forearm_L',  'forearm_R'],  ['hand_L',      'hand_R'],
        ['thigh_L',    'thigh_R'],    ['shin_L',      'shin_R'],
        ['foot_L',     'foot_R'],
        ['thumb_L_1', 'thumb_R_1'],  ['thumb_L_2', 'thumb_R_2'],
        ['index_L_1', 'index_R_1'],  ['index_L_2', 'index_R_2'],  ['index_L_3', 'index_R_3'],
        ['middle_L_1','middle_R_1'], ['middle_L_2','middle_R_2'], ['middle_L_3','middle_R_3'],
        ['ring_L_1',  'ring_R_1'],   ['ring_L_2',  'ring_R_2'],   ['ring_L_3',  'ring_R_3'],
        ['pinky_L_1', 'pinky_R_1'],  ['pinky_L_2', 'pinky_R_2'],  ['pinky_L_3', 'pinky_R_3'],
    ];

    mirrorPose(direction = 'L_to_R') {
        const prevPose     = this._store?.getState().pose ?? {};
        // Compute mirrored pose AND apply to renderer in one pass
        const mirroredPose = { ...prevPose };
        for (const [l, r] of MannequinEditor.MIRROR_PAIRS) {
            const [src, dst] = direction === 'L_to_R' ? [l, r] : [r, l];
            const srcBone = this._renderer.bones.get(src);
            const dstBone = this._renderer.bones.get(dst);
            if (!srcBone || !dstBone) continue;
            const q = srcBone.quaternion;
            const newQ = direction === 'L_to_R'
                ? { x: -q.x,  y:  q.y,  z:  q.z, w: q.w }
                : { x:  q.x,  y: -q.y,  z: -q.z, w: q.w };
            dstBone.quaternion.set(newQ.x, newQ.y, newQ.z, newQ.w);
            mirroredPose[dst] = newQ;
        }
        if (this._store) {
            this._history.execute(new MirrorPoseCommand(prevPose, mirroredPose, direction), this._store);
        }
        this._renderer.markDirty();
    }

    applySceneWithUndo(sceneData) {
        const prevPose  = this._store?.getState().pose ?? {};
        // Build next pose from sceneData bones
        const nextPose  = {};
        if (sceneData?.bones) {
            for (const [name, data] of Object.entries(sceneData.bones)) {
                if (data?.rotation) {
                    const [x,y,z,w] = data.rotation;
                    nextPose[name] = { x, y, z, w };
                }
            }
        }
        if (this._store) this._history.execute(new ResetPoseCommand(prevPose, nextPose), this._store);
        this._renderer.applyScene(sceneData);
        this._renderer.markDirty();
    }

    /**
     * Apply a finger preset (map { boneName: [x,y,z,w] } over the 10 finger bones).
     * Body bones are preserved. Commits a ResetPoseCommand so undo/redo works.
     */
    applyFingerPreset(presetPose) {
        const prevPose = this._store?.getState().pose ?? {};
        const nextPose = { ...prevPose };
        for (const [name, rot] of Object.entries(presetPose)) {
            if (!Array.isArray(rot) || rot.length < 4) continue;
            const [x, y, z, w] = rot;
            nextPose[name] = { x, y, z, w };
            const bone = this._renderer.bones.get(name);
            if (bone) bone.quaternion.set(x, y, z, w);
        }
        if (this._store) {
            this._history.execute(new ResetPoseCommand(prevPose, nextPose), this._store);
        }
        this._renderer.markDirty();
    }

    generateRandomPose(mode = 'safe') {
        const DEG    = Math.PI / 180;
        const rnd    = (lo, hi) => (lo + Math.random() * (hi - lo)) * DEG;
        const LIMITS = mode === 'wild'
            ? MannequinEditor.RANDOM_LIMITS_WILD
            : MannequinEditor.RANDOM_LIMITS_SAFE;

        const prevPose = this._store?.getState().pose ?? {};
        const euler    = new THREE.Euler();
        const quat     = new THREE.Quaternion();
        const nextPose = { ...prevPose };

        for (const [boneName, limits] of Object.entries(LIMITS)) {
            if (!limits) continue;
            const bone = this._renderer.bones.get(boneName);
            if (!bone) continue;
            const [x0,x1,y0,y1,z0,z1] = limits;
            euler.set(rnd(x0,x1), rnd(y0,y1), rnd(z0,z1), 'XYZ');
            quat.setFromEuler(euler);
            bone.quaternion.copy(quat);
            nextPose[boneName] = { x: quat.x, y: quat.y, z: quat.z, w: quat.w };
        }

        if (this._store) {
            this._history.execute(new RandomPoseCommand(prevPose, nextPose), this._store);
        }

        this._renderer.markDirty();
        return this._renderer.getSceneData(this._gender);
    }

    // ── Store ↔ Renderer sync ─────────────────────────────────────────────────

    /** Write all renderer bone quats into the store (after Three.js drag). */
    _syncPoseToStore() {
        if (!this._store) return;
        const pose = {};
        for (const [name, bone] of this._renderer.bones) {
            const q = bone.quaternion;
            pose[name] = { x: q.x, y: q.y, z: q.z, w: q.w };
        }
        this._store.setPose(pose);
    }

    /** Apply store pose to renderer bones (after undo/redo command). */
    _applyPoseFromStore() {
        if (!this._store) return;
        const pose = this._store.getState().pose;
        for (const [name, bone] of this._renderer.bones) {
            const q = pose[name];
            if (q) bone.quaternion.set(q.x, q.y, q.z, q.w);
        }
    }

    // ── Selection ─────────────────────────────────────────────────────────────

    _onCanvasClick(e) {
        const rect = this._canvas.getBoundingClientRect();
        this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this._renderer.camera);
        const pickables = [];
        this._renderer.scene.traverse(obj => {
            if (obj.userData.isJoint || (obj.isMesh && obj.userData.boneName && !obj.userData.isJoint)) {
                pickables.push(obj);
                return;
            }
            if (obj.isMesh) {
                // include meshes that belong to a prop (walk ancestors for isProp)
                let n = obj;
                while (n) { if (n.userData && n.userData.isProp) { pickables.push(obj); break; } n = n.parent; }
            }
        });
        const hits = this._raycaster.intersectObjects(pickables, false);

        if (hits.length > 0) {
            const hit = hits[0].object;

            // Check if the hit object belongs to a prop — walk up to find isProp ancestor
            let propObj = null;
            let node = hit;
            while (node) {
                if (node.userData?.isProp) { propObj = node; break; }
                node = node.parent ?? null;
            }

            if (propObj) {
                // Prop hit — deselect bone, select prop
                this._deselect();
                this._selectedProp = { id: propObj.userData.propId, obj: propObj };
                this._transform.attach(propObj);
                this._propBeforeDrag = propTransformFromObject(propObj);
            } else {
                // Bone hit (existing path)
                const boneName = hit.userData.boneName;
                let sphere = null;
                const boneGroup = hit.parent;
                if (boneGroup) {
                    sphere = boneGroup.children.find(c => c.userData.isJoint && !c.userData.isHitTarget) ?? null;
                }
                this._selectBone(boneName, sphere);
            }
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
        this._selectedBone   = null;
        this._selectedProp   = null;
        this._propBeforeDrag = null;
        this._transform.detach();
    }

    /**
     * Set the gizmo transform mode — useful for prop manipulation.
     * @param {'translate'|'rotate'|'scale'} mode
     */
    setGizmoMode(mode) {
        this._transform.setMode(mode);
    }

    _onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') { e.preventDefault(); this.redo(); }
    }

    update() { this._orbit.update(); }

    dispose() {
        this._canvas.removeEventListener('click',   this._boundClick);
        window.removeEventListener('keydown',       this._boundKeyDown);
        this._orbit.dispose();
        this._transform.dispose();
    }

    // ── Pose limits ────────────────────────────────────────────────────────────

    static RANDOM_LIMITS_SAFE = {
        torso:       null,
        spine:       [ -8,  8, -12, 12,  -6,  6],
        chest:       [ -8,  8,  -8,  8,  -5,  5],
        neck:        [-15, 15, -20, 20, -10, 10],
        head:        [-12, 12, -20, 20,  -8,  8],
        shoulder_L:  [-20, 40, -18, 18, -50, 25],
        upper_arm_L: [-55, 30, -35, 35, -18, 18],
        forearm_L:   [  0, 80,  -4,  4,  -4,  4],
        hand_L:      [-18, 18, -18, 18, -10, 10],
        shoulder_R:  [-20, 40, -18, 18, -25, 50],
        upper_arm_R: [-55, 30, -35, 35, -18, 18],
        forearm_R:   [  0, 80,  -4,  4,  -4,  4],
        hand_R:      [-18, 18, -18, 18, -10, 10],
        pelvis:      [ -6,  6,  -6,  6,  -4,  4],
        thigh_L:     [-35, 20, -18, 18, -20, 10],
        shin_L:      [-70,  0,  -4,  4,  -4,  4],
        foot_L:      [-18, 18,  -8,  8,  -8,  8],
        thigh_R:     [-35, 20, -18, 18, -10, 20],
        shin_R:      [-70,  0,  -4,  4,  -4,  4],
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
        forearm_L:   [  0, 145,  -6,  6,  -6,  6],
        hand_L:      [-60, 60, -60, 60, -40, 40],
        shoulder_R:  [-60,130, -60, 60,  -90,120],
        upper_arm_R: [-130, 90, -90, 90, -60, 60],
        forearm_R:   [  0, 145,  -6,  6,  -6,  6],
        hand_R:      [-60, 60, -60, 60, -40, 40],
        pelvis:      [-30, 30, -30, 30, -20, 20],
        thigh_L:     [-100, 75, -55, 55, -75, 40],
        shin_L:      [-140,   0,  -6,  6,  -6,  6],
        foot_L:      [-60, 60, -30, 30, -30, 30],
        thigh_R:     [-100, 75, -55, 55, -40, 75],
        shin_R:      [-140,   0,  -6,  6,  -6,  6],
        foot_R:      [-60, 60, -30, 30, -30, 30],
    };
}

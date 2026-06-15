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
    IKPoseCommand,
    PosePresetCommand,
} from './commands.js';
import { presetById, presetToPose } from './pose-presets.js';
import { IKController, IK_CHAINS } from './ik-controller.js';
import { INTENSITY, pickBasePreset, jitterPose, randomOffsetVec } from './smart-pose.js';
import { createIKHandles, setIKHandlesVisible, syncIKHandles } from './mannequin-renderer.js';

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

        // ── IK mode ───────────────────────────────────────────────────────────────
        this._ikMode        = false;
        this._ikController  = new IKController({ bones: renderer.bones });
        this._ikHandles     = createIKHandles(renderer.scene);
        this._ikActiveChain = null;          // chainId currently driven by the gizmo
        this._poseBeforeIK  = null;          // full pose snapshot for undo

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
            if (this._ikActiveChain) {
                const pose = this._store?.getState().pose ?? {};
                this._poseBeforeIK = { ...pose };
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

                // IK drag ended
                if (this._ikActiveChain && this._poseBeforeIK && this._store) {
                    const nextPose = this._store.getState().pose;
                    const prev = this._poseBeforeIK;
                    const changed = JSON.stringify(prev) !== JSON.stringify(nextPose);
                    if (changed) {
                        this._history.execute(new IKPoseCommand(prev, nextPose), this._store);
                    }
                    this._poseBeforeIK = null;
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

        this._transform.addEventListener('objectChange', () => {
            if (!this._ikActiveChain) return;
            const handle = this._ikHandles.get(this._ikActiveChain);
            if (!handle) return;
            const target = handle.getWorldPosition(new THREE.Vector3());
            this._ikController.solve(this._ikActiveChain, target);
            this._syncPoseToStore();
            this._renderer.markDirty();
        });

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
        this._deselect();
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

    /**
     * Apply a built-in pose preset by id. Sets bone rotations only — gender, proportions,
     * and props are untouched (attached props follow because they are bone children).
     * Commits a PosePresetCommand so undo/redo works.
     */
    applyPosePreset(id) {
        const preset = presetById(id);
        if (!preset) return;
        // If an IK handle is being dragged, clear it so the handles re-sync to the new
        // pose (update() only re-syncs handles while no chain is active).
        if (this._ikActiveChain) this._deselect();
        const prevPose = this._store?.getState().pose ?? {};
        const nextPose = presetToPose(preset);
        for (const [name, q] of Object.entries(nextPose)) {
            const bone = this._renderer.bones.get(name);
            if (bone) bone.quaternion.set(q.x, q.y, q.z, q.w);
        }
        if (this._store) {
            this._history.execute(new PosePresetCommand(prevPose, nextPose), this._store);
        }
        this._renderer.markDirty();
    }

    generateRandomPose(mode = 'safe', rng = Math.random) {
        const intensity = INTENSITY[mode] ?? INTENSITY.safe;
        const prevPose  = this._store?.getState().pose ?? {};

        // If an IK handle is mid-drag, clear it so handles re-sync to the new pose.
        if (this._ikActiveChain) this._deselect();

        // 1) base preset → 2) jitter torso
        const preset   = pickBasePreset(rng);
        const base     = presetToPose(preset);
        const jittered = jitterPose(base, rng, intensity.jitterDeg);

        // 3) apply base+jitter to renderer bones
        for (const [name, q] of Object.entries(jittered)) {
            const bone = this._renderer.bones.get(name);
            if (bone) bone.quaternion.set(q.x, q.y, q.z, q.w);
        }

        // 4) IK-settle each limb to a randomly offset reachable target
        for (const chain of IK_CHAINS) {
            const rootB = this._renderer.bones.get(chain.root);
            const midB  = this._renderer.bones.get(chain.mid);
            const endB  = this._renderer.bones.get(chain.end);
            if (!rootB || !midB || !endB) continue;
            const rootW = rootB.getWorldPosition(new THREE.Vector3());
            const midW  = midB.getWorldPosition(new THREE.Vector3());
            const endW  = endB.getWorldPosition(new THREE.Vector3());
            const limbLen = rootW.distanceTo(midW) + midW.distanceTo(endW);
            const target  = endW.clone().add(randomOffsetVec(rng, intensity.reachFrac * limbLen));
            this._ikController.solve(chain.id, target);
        }

        // 5) read the final pose back from the bones
        const nextPose = {};
        for (const [name, bone] of this._renderer.bones) {
            const q = bone.quaternion;
            nextPose[name] = { x: q.x, y: q.y, z: q.z, w: q.w };
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

        if (this._ikMode) {
            const handleMeshes = [...this._ikHandles.values()];
            const ikHits = this._raycaster.intersectObjects(handleMeshes, false);
            if (ikHits.length > 0) {
                const handle = ikHits[0].object;
                this._deselect();
                this._ikActiveChain = handle.userData.chainId;
                this._transform.setMode('translate');
                this._transform.setSpace('world');
                this._transform.attach(handle);
                this._renderer.markDirty();
                return;
            }
        }

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
        this._transform.setMode('rotate');
        this._transform.setSpace('local');
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
        this._ikActiveChain  = null;
        this._poseBeforeIK   = null;
        this._transform.detach();
    }

    /**
     * Set the gizmo transform mode — useful for prop manipulation.
     * @param {'translate'|'rotate'|'scale'} mode
     */
    setGizmoMode(mode) {
        this._transform.setMode(mode);
    }

    setIKMode(on) {
        this._ikMode = !!on;
        if (!this._ikMode) {
            if (this._ikActiveChain) { this._transform.detach(); this._ikActiveChain = null; }
            this._poseBeforeIK = null;
            this._transform.setMode('rotate');
            this._transform.setSpace('local');
        } else {
            this._deselect();
            syncIKHandles(this._ikHandles, this._renderer.bones);
        }
        setIKHandlesVisible(this._ikHandles, this._ikMode);
        this._renderer.markDirty();
    }

    get ikMode() { return this._ikMode; }

    _onKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Z') { e.preventDefault(); this.redo(); }
    }

    update() {
        this._orbit.update();
        if (this._ikMode && !this._ikActiveChain) {
            syncIKHandles(this._ikHandles, this._renderer.bones);
        }
    }

    dispose() {
        this._canvas.removeEventListener('click',   this._boundClick);
        window.removeEventListener('keydown',       this._boundKeyDown);
        this._orbit.dispose();
        this._transform.dispose();
    }

}

import * as THREE from '../lib/three.module.js';
import { OrbitControls } from '../lib/OrbitControls.js';
import { TransformControls } from '../lib/TransformControls.js';
import { SELECT_COLOR, JOINT_COLOR } from './geometry-adapter-capsule.js';
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

        this._undoStack = [];   // array of scene JSON snapshots
        this._gender    = 'F';

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

        // Pointer events
        canvas.addEventListener('click',     this._onCanvasClick.bind(this));
        window.addEventListener('keydown',   this._onKeyDown.bind(this));
    }

    get gender() { return this._gender; }

    buildMannequin(gender, sceneData) {
        this._gender = gender;
        this._deselect();
        this._renderer.buildMannequin(gender, sceneData);
        this._undoStack = [];
        this._saveUndoSnapshot();
        this._renderer.markDirty();
    }

    setGender(gender) {
        const currentScene = this._renderer.getSceneData(this._gender);
        currentScene.gender = gender;
        this.buildMannequin(gender, currentScene);
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

    _saveUndoSnapshot() {
        const json = JSON.stringify(this._renderer.getSceneData(this._gender));
        this._undoStack.push(json);
        if (this._undoStack.length > UNDO_LIMIT) this._undoStack.shift();
    }

    _onCanvasClick(e) {
        const rect = this._canvas.getBoundingClientRect();
        this._mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
        this._mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;

        this._raycaster.setFromCamera(this._mouse, this._renderer.camera);
        // Raycast against all joint spheres
        const joints = [];
        this._renderer.scene.traverse(obj => {
            if (obj.userData.isJoint) joints.push(obj);
        });
        const hits = this._raycaster.intersectObjects(joints, false);

        if (hits.length > 0) {
            const hit = hits[0].object;
            this._selectBone(hit.userData.boneName, hit);
        } else {
            this._deselect();
        }
        this._renderer.markDirty();
    }

    _selectBone(boneName, sphereMesh) {
        this._deselect();
        this._selectedBone   = boneName;
        this._selectedSphere = sphereMesh;
        sphereMesh.material.color.setHex(SELECT_COLOR);

        const boneObj = this._renderer.bones.get(boneName);
        if (boneObj) this._transform.attach(boneObj);
        this._renderer.markDirty();
    }

    _deselect() {
        if (this._selectedSphere) {
            this._selectedSphere.material.color.setHex(JOINT_COLOR);
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
        this._canvas.removeEventListener('click', this._onCanvasClick.bind(this));
        window.removeEventListener('keydown', this._onKeyDown.bind(this));
        this._orbit.dispose();
        this._transform.dispose();
    }
}

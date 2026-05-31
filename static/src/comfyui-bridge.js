import { jsonToScene, BONE_NAMES, BONE_CHILDREN } from './mannequin-model.js';

// Generate a simple unique ID (no crypto needed — just unique per session)
let _idCounter = 0;
function genId() { return `req-${Date.now()}-${++_idCounter}`; }

export class ComfyuiBridge {
    constructor(editor, renderer) {
        this._editor   = editor;
        this._renderer = renderer;
        this._pending  = new Map(); // requestId → { resolve, reject, timer }

        this._boundMessage = this._onMessage.bind(this);
        window.addEventListener('message', this._boundMessage);
    }

    _onMessage(e) {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (!d || d.cmd !== 'mannequin') return;

        if (d.type === 'call') {
            this._handleCall(d, e.source);
            return;
        }

        // return / error — resolve pending promise
        if (d.requestId && this._pending.has(d.requestId)) {
            const { resolve, reject, timer } = this._pending.get(d.requestId);
            this._pending.delete(d.requestId);
            clearTimeout(timer);
            if (d.type === 'error') reject(new Error(d.error));
            else resolve(d.payload);
        }
    }

    async _handleCall(msg, source) {
        const reply = (type, payload, error) => {
            source.postMessage(
                { cmd: 'mannequin', requestId: msg.requestId, method: msg.method, type, payload, error },
                window.location.origin
            );
        };

        try {
            let result;
            const [arg] = msg.payload ?? [];
            switch (msg.method) {

                // ── Size / output ────────────────────────────────────────────
                case 'GetWidth':
                    result = this._renderer.outputWidth;
                    break;
                case 'GetHeight':
                    result = this._renderer.outputHeight;
                    break;
                case 'GetOutputSize':
                    result = { width: this._renderer.outputWidth, height: this._renderer.outputHeight };
                    break;
                case 'OutputWidth':
                    this._renderer.setOutputSize(arg, this._renderer.outputHeight);
                    result = true;
                    break;
                case 'OutputHeight':
                    this._renderer.setOutputSize(this._renderer.outputWidth, arg);
                    result = true;
                    break;

                // ── Scene / pose ─────────────────────────────────────────────
                case 'GetSceneData':
                    result = this._editor.getSceneData();
                    break;
                case 'SetSceneData':
                    // applySceneWithUndo saves a snapshot so agent changes are undoable
                    this._editor.applySceneWithUndo(arg);
                    result = true;
                    break;
                case 'ResetPose':
                    this._editor.resetPose();
                    result = true;
                    break;
                case 'MirrorPose':
                    this._editor.mirrorPose(arg ?? 'L_to_R');
                    result = true;
                    break;

                // ── Single-bone / batch bone control (for AI agents) ─────────
                case 'GetBoneRotation': {
                    // arg = bone name
                    const bone = this._renderer.bones.get(arg);
                    if (!bone) throw Object.assign(new Error(`Bone not found: ${arg}`), { code: 'BONE_NOT_FOUND' });
                    const q = bone.quaternion;
                    result = [q.x, q.y, q.z, q.w];
                    break;
                }
                case 'RotateBone': {
                    // arg = { name: string, quaternion: [x,y,z,w] }
                    const bone = this._renderer.bones.get(arg?.name);
                    if (!bone) throw Object.assign(new Error(`Bone not found: ${arg?.name}`), { code: 'BONE_NOT_FOUND' });
                    const [x, y, z, w] = arg.quaternion;
                    bone.quaternion.set(x, y, z, w);
                    this._editor._saveUndoSnapshot();
                    this._renderer.markDirty();
                    result = true;
                    break;
                }
                case 'SetBones': {
                    // arg = { boneName: [x,y,z,w], ... }  — atomic batch, unspecified bones unchanged
                    const skipped = [];
                    for (const [name, qArr] of Object.entries(arg ?? {})) {
                        const bone = this._renderer.bones.get(name);
                        if (!bone) { skipped.push(name); continue; }
                        bone.quaternion.set(...qArr);
                    }
                    this._editor._saveUndoSnapshot();
                    this._renderer.markDirty();
                    result = { ok: true, skipped };
                    break;
                }

                // ── Camera ───────────────────────────────────────────────────
                case 'GetCamera':
                    result = this._editor.getSceneData().camera ?? null;
                    break;
                case 'SetCamera':
                    // arg = { azimuth, elevation, distance }
                    this._renderer._applyCameraFromScene(arg);
                    this._renderer.markDirty();
                    result = true;
                    break;

                // ── Gender ───────────────────────────────────────────────────
                case 'SetGender':
                    await this._editor.setGender(arg);
                    result = true;
                    break;

                // ── Capture ──────────────────────────────────────────────────
                case 'MakeImages':
                    result = this._renderer.captureImages();
                    break;

                // ── Discovery / capabilities ─────────────────────────────────
                case 'GetBoneNames':
                    result = BONE_NAMES;
                    break;
                case 'GetSkeleton':
                    result = { bones: BONE_NAMES, hierarchy: BONE_CHILDREN, gender: this._editor.gender };
                    break;
                case 'GetCapabilities':
                    result = {
                        apiVersion: '1.1',
                        sceneVersion: '1.0',
                        bones: BONE_NAMES,
                        methods: [
                            'GetWidth','GetHeight','GetOutputSize',
                            'OutputWidth','OutputHeight',
                            'GetSceneData','SetSceneData','ResetPose','MirrorPose',
                            'GetBoneRotation','RotateBone','SetBones',
                            'GetCamera','SetCamera',
                            'SetGender',
                            'MakeImages',
                            'GetBoneNames','GetSkeleton','GetCapabilities',
                        ],
                        timeoutHints: { MakeImages: 20000, SetGender: 15000 },
                    };
                    break;

                default:
                    throw Object.assign(new Error(`Unknown method: ${msg.method}`), { code: 'METHOD_NOT_FOUND' });
            }
            reply('return', result);
        } catch (err) {
            reply('error', null, { code: err.code ?? 'RUNTIME_ERROR', message: err.message });
        }
    }

    dispose() {
        window.removeEventListener('message', this._boundMessage);
    }

    // Called by mannequin_node.js on the PARENT side to invoke editor methods
    // (Not used inside the iframe — only on the ComfyUI parent side)
    static invoke(iframeWin, method, payload = [], timeoutMs = 5000) {
        const requestId = genId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                window.removeEventListener('message', handler);
                reject(new Error(`Timeout waiting for ${method} (${timeoutMs}ms)`));
            }, timeoutMs);

            function handler(e) {
                if (e.origin !== window.location.origin) return;
                const d = e.data;
                if (d?.cmd === 'mannequin' && d?.requestId === requestId) {
                    window.removeEventListener('message', handler);
                    clearTimeout(timer);
                    if (d.type === 'error') reject(new Error(d.error));
                    else resolve(d.payload);
                }
            }
            window.addEventListener('message', handler);
            iframeWin.postMessage(
                { cmd: 'mannequin', requestId, method, type: 'call', payload },
                window.location.origin
            );
        });
    }
}

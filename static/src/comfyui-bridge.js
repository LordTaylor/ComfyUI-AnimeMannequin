import { jsonToScene } from './mannequin-model.js';

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
                case 'GetWidth':
                    result = this._renderer.outputWidth;
                    break;
                case 'OutputWidth':
                    this._renderer.setOutputSize(arg, this._renderer.outputHeight);
                    result = true;
                    break;
                case 'OutputHeight':
                    this._renderer.setOutputSize(this._renderer.outputWidth, arg);
                    result = true;
                    break;
                case 'GetSceneData':
                    result = this._editor.getSceneData();
                    break;
                case 'SetSceneData':
                    this._renderer.applyScene(arg);
                    this._renderer.markDirty();
                    result = true;
                    break;
                case 'SetGender':
                    this._editor.setGender(arg);
                    result = true;
                    break;
                case 'MakeImages':
                    result = await this._renderer.captureImages();
                    break;
                default:
                    throw new Error(`Unknown method: ${msg.method}`);
            }
            reply('return', result);
        } catch (err) {
            reply('error', null, err.message);
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

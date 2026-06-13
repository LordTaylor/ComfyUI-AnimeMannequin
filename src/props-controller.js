import * as realLoaders from './props.js';
import * as realCache from './prop-cache.js';

export class PropsController {
    /** deps overridable for tests: {loadLibraryProp, parsePropGLB, getPropBlob, putPropBlob} */
    constructor(renderer, deps = {}) {
        this._renderer = renderer;
        this._loadLibraryProp = deps.loadLibraryProp ?? realLoaders.loadLibraryProp;
        this._parsePropGLB    = deps.parsePropGLB    ?? realLoaders.parsePropGLB;
        this._getPropBlob     = deps.getPropBlob     ?? realCache.getPropBlob;
        this._putPropBlob     = deps.putPropBlob     ?? realCache.putPropBlob;
        this._missing = new Map(); // id → propState
    }

    /** Load geometry for a prop state and attach it; track as missing if unavailable. */
    async realize(propState) {
        let obj = null;
        try {
            if (propState.source === 'lib') {
                obj = await this._loadLibraryProp(propState.ref);
            } else {
                const buf = await this._getPropBlob(propState.ref);
                if (buf) obj = await this._parsePropGLB(buf);
            }
        } catch {
            obj = null;
        }
        if (obj) {
            this._missing.delete(propState.id);
            this._renderer.attachProp(propState, obj);
        } else {
            this._missing.set(propState.id, { ...propState });
        }
    }

    /** Register an uploaded GLB (cache it) then realize. */
    async addUpload(propState, arrayBuffer) {
        await this._putPropBlob(propState.ref, arrayBuffer);
        await this.realize(propState);
    }

    /** Remove a prop from the scene and forget any missing record. */
    remove(id) {
        this._missing.delete(id);
        this._renderer.removeProp(id);
    }

    /** Props whose geometry could not be loaded (e.g. upload not in cache). */
    missingProps() {
        return [...this._missing.values()];
    }
}

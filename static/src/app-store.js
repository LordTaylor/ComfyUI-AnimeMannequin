/**
 * AppStore — centralny store stanu aplikacji.
 *
 * Architektura: Command + Store (unidirectional data flow)
 *
 * Stan jest immutable z zewnątrz — zmienia się TYLKO przez:
 *   store.setState(partial)   ← używane przez Commands
 *   store.replaceState(full)  ← używane przy reset / wczytaniu sceny
 *
 * Subskrybenci dostają powiadomienie po każdej zmianie.
 */

import { defaultProportions } from './mannequin-model.js';
import { BUST_DEFAULTS } from './mannequin-renderer.js';

// ── Domyślny stan ──────────────────────────────────────────────────────────────

export function defaultState(gender = 'F') {
    return {
        gender,
        pose:          {},           // { [boneName]: { x, y, z, w } }
        proportions:   defaultProportions(),
        bustCfg:       { ...BUST_DEFAULTS },
        jointColorMode: 'openpose',  // 'openpose' | 'flat'
        groundEnabled:  false,
        outputWidth:    768,
        outputHeight:   1024,
    };
}

// ── AppStore ───────────────────────────────────────────────────────────────────

export class AppStore {
    constructor(initialState) {
        this._state     = initialState ?? defaultState();
        this._listeners = new Set();
    }

    // Zwraca shallow kopię stanu (nie mutuj bezpośrednio).
    getState() {
        return { ...this._state };
    }

    // Patch stanu — merge płytki, notyfikuje subskrybentów.
    setState(partial) {
        this._state = { ...this._state, ...partial };
        this._notify();
    }

    // Pełne zastąpienie stanu (np. wczytanie zapisanej sceny).
    replaceState(full) {
        this._state = { ...full };
        this._notify();
    }

    // Subskrypcja — zwraca funkcję do anulowania.
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        for (const fn of this._listeners) fn(this._state);
    }
}

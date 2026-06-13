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
        jointColorMode: 'openpose',  // 'openpose' | 'flat' | 'all'
        groundEnabled:  false,
        outputWidth:    768,
        outputHeight:   1024,
        bgImage:   { dataUrl: null, opacity: 0.5, zoom: 1.0, offsetX: 0, offsetY: 0 },
        cropFrame: { color: '#ffffff', opacity: 0.55 },
        props:     [],
    };
}

// ── AppStore ───────────────────────────────────────────────────────────────────

export class AppStore {
    constructor(initialState) {
        this._state     = initialState ?? defaultState();
        this._listeners = new Set();
    }

    // Zwraca kopię stanu. Zagnieżdżone obiekty (pose, proportions, bustCfg) są płytko klonowane
    // żeby zewnętrzna mutacja getState().pose.head nie wpłynęła na store.
    getState() {
        const pose = {};
        // `?? {}` guards against a state restored without a `pose` key (legacy/partial
        // schema via replaceState) — Object.entries(null/undefined) would otherwise throw.
        for (const [k, v] of Object.entries(this._state.pose ?? {})) pose[k] = { ...v };
        return {
            ...this._state,
            pose,
            proportions: { ...this._state.proportions },
            bustCfg:     { ...this._state.bustCfg },
            bgImage:     { ...this._state.bgImage },
            cropFrame:   { ...this._state.cropFrame },
            props: (this._state.props ?? []).map(p => ({ ...p, position: [...p.position], rotation: [...p.rotation] })),
        };
    }

    // Patch stanu — merge płytki dla pól top-level.
    // UWAGA: dla zagnieżdżonych pól (pose, proportions, bustCfg) używaj specific setterów poniżej.
    setState(partial) {
        this._state = { ...this._state, ...partial };
        this._notify();
    }

    // Pełne zastąpienie stanu (np. wczytanie zapisanej sceny).
    // Normalizujemy względem defaultState, żeby częściowy/legacy obiekt nie zostawił
    // brakujących pól (np. pose) które wywróciłyby getState().
    replaceState(full) {
        const base = defaultState(full?.gender ?? this._state.gender);
        this._state = { ...base, ...full };
        this._notify();
    }

    // ── Specific setters (bezpieczny deep-patch dla zagnieżdżonych pól) ─────────

    /** Ustaw obrót jednej kości — pozostałe kości bez zmian. */
    setPoseBone(boneName, quat) {
        this._state = { ...this._state, pose: { ...this._state.pose, [boneName]: { ...quat } } };
        this._notify();
    }

    /** Zastąp całą mapę poz (np. reset / mirror / random). */
    setPose(pose) {
        this._state = { ...this._state, pose: { ...pose } };
        this._notify();
    }

    /** Patch proporcji — niezmienione pola zostają. */
    setProportions(partial) {
        this._state = { ...this._state, proportions: { ...this._state.proportions, ...partial } };
        this._notify();
    }

    /** Patch bust config — niezmienione pola zostają. */
    setBustCfg(partial) {
        this._state = { ...this._state, bustCfg: { ...this._state.bustCfg, ...partial } };
        this._notify();
    }

    /** Ustaw rozmiar wyjściowy. */
    setOutputSize(w, h) {
        this._state = { ...this._state, outputWidth: w, outputHeight: h };
        this._notify();
    }

    /** Patch background image config — niezmienione pola zostają. */
    setBgImage(partial) {
        this._state = { ...this._state, bgImage: { ...this._state.bgImage, ...partial } };
        this._notify();
    }

    /** Patch crop frame style — niezmienione pola zostają. */
    setCropFrame(partial) {
        this._state = { ...this._state, cropFrame: { ...this._state.cropFrame, ...partial } };
        this._notify();
    }

    /** Dodaj prop. */
    addProp(prop) {
        this._state = { ...this._state, props: [...(this._state.props ?? []), { ...prop }] };
        this._notify();
    }

    /** Usuń prop po id. */
    removeProp(id) {
        this._state = { ...this._state, props: (this._state.props ?? []).filter(p => p.id !== id) };
        this._notify();
    }

    /** Patch jednego propa po id (nieznane id → no-op). */
    updateProp(id, partial) {
        this._state = { ...this._state, props: (this._state.props ?? []).map(p => p.id === id ? { ...p, ...partial } : p) };
        this._notify();
    }

    /** Subskrypcja — zwraca funkcję do anulowania. */
    subscribe(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notify() {
        const s = this._state;
        for (const fn of this._listeners) fn(s);
    }
}

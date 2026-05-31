/**
 * Command Pattern — Phase 2 + 3
 *
 * Każda akcja użytkownika = Command z execute() / undo().
 * CommandHistory zarządza stosem undo/redo.
 *
 * Commands NIE wywołują renderera bezpośrednio —
 * mutują AppStore, a renderer reaguje na zmiany przez subscribe().
 */

// ── Base ───────────────────────────────────────────────────────────────────────

export class Command {
    /** @param {import('./app-store.js').AppStore} store */
    execute(store) { throw new Error('execute() not implemented'); }
    undo(store)    { throw new Error('undo() not implemented'); }
    get description() { return this.constructor.name; }
}

// ── CommandHistory ─────────────────────────────────────────────────────────────

export class CommandHistory {
    constructor(limit = 20) {
        this._limit   = limit;
        this._undoStack = [];
        this._redoStack = [];
    }

    /** Wykonaj command i zapisz do undo stack. */
    execute(command, store) {
        command.execute(store);
        this._undoStack.push(command);
        this._redoStack = [];                      // redo stack kasujemy przy nowej akcji
        if (this._undoStack.length > this._limit) this._undoStack.shift();
    }

    /** Cofnij ostatni command. */
    undo(store) {
        if (!this.canUndo) return;
        const cmd = this._undoStack.pop();
        cmd.undo(store);
        this._redoStack.push(cmd);
    }

    /** Ponów cofnięty command. */
    redo(store) {
        if (!this.canRedo) return;
        const cmd = this._redoStack.pop();
        cmd.execute(store);
        this._undoStack.push(cmd);
    }

    get canUndo() { return this._undoStack.length > 0; }
    get canRedo() { return this._redoStack.length > 0; }
    get undoDescription() { return this._undoStack.at(-1)?.description ?? null; }
    get redoDescription() { return this._redoStack.at(-1)?.description ?? null; }

    clear() { this._undoStack = []; this._redoStack = []; }
}

// ── Concrete Commands ──────────────────────────────────────────────────────────

/**
 * Obrót kości — zapisuje poprzedni kwaternion do undo.
 * prevQuat i nextQuat: { x, y, z, w }
 */
export class RotateBoneCommand extends Command {
    constructor(boneName, prevQuat, nextQuat) {
        super();
        this._boneName = boneName;
        this._prev     = { ...prevQuat };
        this._next     = { ...nextQuat };
    }

    execute(store) {
        const pose = { ...store.getState().pose, [this._boneName]: { ...this._next } };
        store.setState({ pose });
    }

    undo(store) {
        const pose = { ...store.getState().pose, [this._boneName]: { ...this._prev } };
        store.setState({ pose });
    }

    get description() { return `Rotate ${this._boneName}`; }
}

/**
 * Zmiana proporcji (head / bust / hips / waist / legs / arms).
 */
export class SetProportionsCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = { ...prev };
        this._next = { ...next };
    }

    execute(store) { store.setState({ proportions: { ...this._next } }); }
    undo(store)    { store.setState({ proportions: { ...this._prev } }); }
    get description() { return 'Set proportions'; }
}

/**
 * Zmiana jednego lub wielu parametrów bust config.
 */
export class SetBustCfgCommand extends Command {
    constructor(prevCfg, nextCfg) {
        super();
        this._prev = { ...prevCfg };
        this._next = { ...nextCfg };
    }

    execute(store) { store.setState({ bustCfg: { ...this._next } }); }
    undo(store)    { store.setState({ bustCfg: { ...this._prev } }); }
    get description() { return 'Set bust config'; }
}

/**
 * Zmiana płci — resetuje posę do domyślnej.
 */
export class SetGenderCommand extends Command {
    constructor(prevGender, nextGender, prevPose, defaultPose) {
        super();
        this._prevGender  = prevGender;
        this._nextGender  = nextGender;
        this._prevPose    = { ...prevPose };
        this._defaultPose = { ...defaultPose };
    }

    execute(store) { store.setState({ gender: this._nextGender, pose: { ...this._defaultPose } }); }
    undo(store)    { store.setState({ gender: this._prevGender, pose: { ...this._prevPose } }); }
    get description() { return `Set gender ${this._nextGender}`; }
}

/**
 * Reset pozy — przywraca domyślną pozę przy zachowaniu proporcji.
 */
export class ResetPoseCommand extends Command {
    constructor(prevPose, defaultPose) {
        super();
        this._prev    = { ...prevPose };
        this._default = { ...defaultPose };
    }

    execute(store) { store.setState({ pose: { ...this._default } }); }
    undo(store)    { store.setState({ pose: { ...this._prev } }); }
    get description() { return 'Reset pose'; }
}

/**
 * Odbicie pozy (L↔R mirror).
 */
export class MirrorPoseCommand extends Command {
    constructor(prevPose, mirroredPose, direction) {
        super();
        this._prev     = { ...prevPose };
        this._mirrored = { ...mirroredPose };
        this._dir      = direction;
    }

    execute(store) { store.setState({ pose: { ...this._mirrored } }); }
    undo(store)    { store.setState({ pose: { ...this._prev } }); }
    get description() { return `Mirror pose ${this._dir}`; }
}

/**
 * Losowa poza.
 */
export class RandomPoseCommand extends Command {
    constructor(prevPose, randomPose) {
        super();
        this._prev   = { ...prevPose };
        this._random = { ...randomPose };
    }

    execute(store) { store.setState({ pose: { ...this._random } }); }
    undo(store)    { store.setState({ pose: { ...this._prev } }); }
    get description() { return 'Random pose'; }
}

/**
 * Zmiana trybu kolorów jointów.
 */
export class SetJointColorModeCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = prev;
        this._next = next;
    }

    execute(store) { store.setState({ jointColorMode: this._next }); }
    undo(store)    { store.setState({ jointColorMode: this._prev }); }
    get description() { return `Joint color mode: ${this._next}`; }
}

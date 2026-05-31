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

    execute(store) { store.setPoseBone(this._boneName, this._next); }
    undo(store)    { store.setPoseBone(this._boneName, this._prev); }
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

    execute(store) { store.setProportions(this._next); }
    undo(store)    { store.setProportions(this._prev); }
    get description() { return 'Set proportions'; }
}

export class SetBustCfgCommand extends Command {
    constructor(prevCfg, nextCfg) {
        super();
        this._prev = { ...prevCfg };
        this._next = { ...nextCfg };
    }

    execute(store) { store.setBustCfg(this._next); }
    undo(store)    { store.setBustCfg(this._prev); }
    get description() { return 'Set bust config'; }
}

export class SetGenderCommand extends Command {
    constructor(prevGender, nextGender, prevPose, defaultPose) {
        super();
        this._prevGender  = prevGender;
        this._nextGender  = nextGender;
        this._prevPose    = { ...prevPose };
        this._defaultPose = { ...defaultPose };
    }

    // Single setState → single notification (avoid double renderer sync)
    execute(store) { store.setState({ gender: this._nextGender, pose: { ...this._defaultPose } }); }
    undo(store)    { store.setState({ gender: this._prevGender, pose: { ...this._prevPose } }); }
    get description() { return `Set gender ${this._nextGender}`; }
}

export class ResetPoseCommand extends Command {
    constructor(prevPose, defaultPose) {
        super();
        this._prev    = { ...prevPose };
        this._default = { ...defaultPose };
    }

    execute(store) { store.setPose(this._default); }
    undo(store)    { store.setPose(this._prev); }
    get description() { return 'Reset pose'; }
}

export class MirrorPoseCommand extends Command {
    constructor(prevPose, mirroredPose, direction) {
        super();
        this._prev     = { ...prevPose };
        this._mirrored = { ...mirroredPose };
        this._dir      = direction;
    }

    execute(store) { store.setPose(this._mirrored); }
    undo(store)    { store.setPose(this._prev); }
    get description() { return `Mirror pose ${this._dir}`; }
}

export class RandomPoseCommand extends Command {
    constructor(prevPose, randomPose) {
        super();
        if (!randomPose || typeof randomPose !== 'object') throw new Error('RandomPoseCommand: randomPose is required');
        this._prev   = { ...prevPose };
        this._random = { ...randomPose };
    }

    execute(store) { store.setPose(this._random); }
    undo(store)    { store.setPose(this._prev); }
    get description() { return 'Random pose'; }
}

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

/**
 * Zmiana background image (dataUrl, opacity, zoom).
 * Undo obrazu "load" → przywraca poprzedni obraz (lub null).
 */
export class SetBgImageCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = { ...prev };
        this._next = { ...next };
    }

    execute(store) { store.setBgImage(this._next); }
    undo(store)    { store.setBgImage(this._prev); }
    get description() { return 'Set background image'; }
}

/**
 * Zmiana stylu ramki kadrowania (color, opacity).
 */
export class SetCropFrameCfgCommand extends Command {
    constructor(prev, next) {
        super();
        this._prev = { ...prev };
        this._next = { ...next };
    }

    execute(store) { store.setCropFrame(this._next); }
    undo(store)    { store.setCropFrame(this._prev); }
    get description() { return 'Set crop frame style'; }
}

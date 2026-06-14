/**
 * Tests: Commands + CommandHistory — Phase 2 + 3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../static/src/mannequin-renderer.js', () => ({
    BUST_DEFAULTS: { loc_z_base:0, loc_z:0.65, glob_z:0.2, loc_x:0.18, loc_y:0.3, glob_y_base:0.0, glob_y:0.0,
                     rot_x:0.6, rot_z:-0.5, rot_y:0.5, grot_x:0.0, grot_y:0.0, grot_z:0.0, scale_x:1.0 },
}));
vi.mock('../../static/src/mannequin-model.js', () => ({
    defaultProportions: () => ({ head:1, bust:1, hips:1, waist:1, legs:1, arms:1 }),
}));

const { AppStore, defaultState } = await import('../../static/src/app-store.js');
const {
    CommandHistory,
    RotateBoneCommand, SetProportionsCommand, SetBustCfgCommand,
    SetGenderCommand, ResetPoseCommand, MirrorPoseCommand,
    RandomPoseCommand, SetJointColorModeCommand,
    SetBgImageCommand, SetCropFrameCfgCommand,
    AddPropCommand, RemovePropCommand, TransformPropCommand,
} = await import('../../static/src/commands.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const Q0 = { x:0, y:0, z:0, w:1 };
const Q1 = { x:0.1, y:0.2, z:0.3, w:0.9 };
const mkStore = () => new AppStore(defaultState());
const mkHistory = () => new CommandHistory(5);

// ── CommandHistory ────────────────────────────────────────────────────────────

describe('CommandHistory', () => {
    it('canUndo is false when empty', () => {
        expect(mkHistory().canUndo).toBe(false);
    });

    it('canUndo is true after execute', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        expect(h.canUndo).toBe(true);
    });

    it('undo reverts state', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        expect(s.getState().pose.head).toEqual(Q1);
        h.undo(s);
        expect(s.getState().pose.head).toEqual(Q0);
    });

    it('redo re-applies command', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        h.undo(s);
        h.redo(s);
        expect(s.getState().pose.head).toEqual(Q1);
    });

    it('new execute clears redo stack', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        h.undo(s);
        expect(h.canRedo).toBe(true);
        h.execute(new RotateBoneCommand('neck', Q0, Q1), s);
        expect(h.canRedo).toBe(false);
    });

    it('respects limit — oldest entry dropped', () => {
        const h = new CommandHistory(3); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        h.execute(new RotateBoneCommand('neck', Q0, Q1), s);
        h.execute(new RotateBoneCommand('shoulder_L', Q0, Q1), s);
        h.execute(new RotateBoneCommand('shoulder_R', Q0, Q1), s); // drops 'head'
        // undo 3 times should exhaust the stack
        h.undo(s); h.undo(s); h.undo(s);
        expect(h.canUndo).toBe(false);
    });

    it('undoDescription returns last command description', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        expect(h.undoDescription).toBe('Rotate head');
    });

    it('clear() empties both stacks', () => {
        const h = mkHistory(); const s = mkStore();
        h.execute(new RotateBoneCommand('head', Q0, Q1), s);
        h.clear();
        expect(h.canUndo).toBe(false);
    });
});

// ── RotateBoneCommand ─────────────────────────────────────────────────────────

describe('RotateBoneCommand', () => {
    it('execute sets bone quat', () => {
        const s = mkStore();
        new RotateBoneCommand('head', Q0, Q1).execute(s);
        expect(s.getState().pose.head).toEqual(Q1);
    });

    it('undo restores previous quat', () => {
        const s = mkStore();
        const cmd = new RotateBoneCommand('head', Q0, Q1);
        cmd.execute(s); cmd.undo(s);
        expect(s.getState().pose.head).toEqual(Q0);
    });

    it('does not mutate other bones', () => {
        const s = mkStore();
        s.setState({ pose: { neck: Q1 } });
        new RotateBoneCommand('head', Q0, Q1).execute(s);
        expect(s.getState().pose.neck).toEqual(Q1);
    });
});

// ── SetProportionsCommand ─────────────────────────────────────────────────────

describe('SetProportionsCommand', () => {
    const prev = { head:1, bust:1, hips:1, waist:1, legs:1, arms:1 };
    const next = { head:1, bust:1.5, hips:1, waist:0.9, legs:1, arms:1 };

    it('execute sets new proportions', () => {
        const s = mkStore();
        new SetProportionsCommand(prev, next).execute(s);
        expect(s.getState().proportions).toEqual(next);
    });

    it('undo restores previous', () => {
        const s = mkStore();
        const cmd = new SetProportionsCommand(prev, next);
        cmd.execute(s); cmd.undo(s);
        expect(s.getState().proportions).toEqual(prev);
    });
});

// ── SetBustCfgCommand ─────────────────────────────────────────────────────────

describe('SetBustCfgCommand', () => {
    it('execute + undo round-trip', () => {
        const s = mkStore();
        const prev = s.getState().bustCfg;
        const next = { ...prev, loc_y: 0.9 };
        const cmd = new SetBustCfgCommand(prev, next);
        cmd.execute(s);
        expect(s.getState().bustCfg.loc_y).toBe(0.9);
        cmd.undo(s);
        expect(s.getState().bustCfg.loc_y).toBe(prev.loc_y);
    });
});

// ── SetGenderCommand ──────────────────────────────────────────────────────────

describe('SetGenderCommand', () => {
    const prevPose    = { head: Q1 };
    const defaultPose = {};

    it('execute changes gender and resets pose', () => {
        const s = mkStore();
        s.setState({ pose: prevPose });
        new SetGenderCommand('F', 'M', prevPose, defaultPose).execute(s);
        expect(s.getState().gender).toBe('M');
        expect(s.getState().pose).toEqual(defaultPose);
    });

    it('undo restores gender and prev pose', () => {
        const s = mkStore();
        s.setState({ pose: prevPose });
        const cmd = new SetGenderCommand('F', 'M', prevPose, defaultPose);
        cmd.execute(s); cmd.undo(s);
        expect(s.getState().gender).toBe('F');
        expect(s.getState().pose).toEqual(prevPose);
    });
});

// ── ResetPoseCommand ──────────────────────────────────────────────────────────

describe('ResetPoseCommand', () => {
    it('execute resets to default, undo restores', () => {
        const s = mkStore();
        const prev = { head: Q1 };
        const def  = {};
        s.setState({ pose: prev });
        const cmd = new ResetPoseCommand(prev, def);
        cmd.execute(s);
        expect(s.getState().pose).toEqual(def);
        cmd.undo(s);
        expect(s.getState().pose).toEqual(prev);
    });
});

// ── MirrorPoseCommand ─────────────────────────────────────────────────────────

describe('MirrorPoseCommand', () => {
    it('execute applies mirrored pose', () => {
        const s = mkStore();
        const prev     = { shoulder_L: Q0 };
        const mirrored = { shoulder_L: Q0, shoulder_R: Q1 };
        const cmd = new MirrorPoseCommand(prev, mirrored, 'L_to_R');
        cmd.execute(s);
        expect(s.getState().pose.shoulder_R).toEqual(Q1);
        cmd.undo(s);
        expect(s.getState().pose).toEqual(prev);
    });
});

// ── SetJointColorModeCommand ──────────────────────────────────────────────────

describe('SetJointColorModeCommand', () => {
    it('toggles mode and undoes', () => {
        const s = mkStore();
        const cmd = new SetJointColorModeCommand('openpose', 'flat');
        cmd.execute(s);
        expect(s.getState().jointColorMode).toBe('flat');
        cmd.undo(s);
        expect(s.getState().jointColorMode).toBe('openpose');
    });
});

// ── SetBgImageCommand ─────────────────────────────────────────────────────────

describe('SetBgImageCommand', () => {
    it('execute sets dataUrl and opacity', () => {
        const s = mkStore();
        const prev = s.getState().bgImage;
        const next = { ...prev, dataUrl: 'data:image/png;base64,abc', opacity: 0.3 };
        new SetBgImageCommand(prev, next).execute(s);
        expect(s.getState().bgImage.dataUrl).toBe('data:image/png;base64,abc');
        expect(s.getState().bgImage.opacity).toBe(0.3);
    });

    it('undo restores previous state', () => {
        const s = mkStore();
        const prev = s.getState().bgImage;
        const next = { ...prev, dataUrl: 'data:image/png;base64,abc' };
        const cmd = new SetBgImageCommand(prev, next);
        cmd.execute(s);
        cmd.undo(s);
        expect(s.getState().bgImage.dataUrl).toBe(null);
    });

    it('undo of remove restores dataUrl', () => {
        const s = mkStore();
        s.setBgImage({ dataUrl: 'data:image/png;base64,xyz' });
        const prev = s.getState().bgImage;
        const cmd = new SetBgImageCommand(prev, { ...prev, dataUrl: null });
        cmd.execute(s);
        expect(s.getState().bgImage.dataUrl).toBeNull();
        cmd.undo(s);
        expect(s.getState().bgImage.dataUrl).toBe('data:image/png;base64,xyz');
    });
});

// ── SetCropFrameCfgCommand ────────────────────────────────────────────────────

describe('SetCropFrameCfgCommand', () => {
    it('execute sets color and opacity', () => {
        const s = mkStore();
        const prev = s.getState().cropFrame;
        const next = { ...prev, color: '#ff0000', opacity: 0.8 };
        new SetCropFrameCfgCommand(prev, next).execute(s);
        expect(s.getState().cropFrame.color).toBe('#ff0000');
        expect(s.getState().cropFrame.opacity).toBe(0.8);
    });

    it('undo restores previous crop frame', () => {
        const s = mkStore();
        const prev = s.getState().cropFrame;
        const cmd = new SetCropFrameCfgCommand(prev, { ...prev, color: '#ff0000' });
        cmd.execute(s); cmd.undo(s);
        expect(s.getState().cropFrame.color).toBe('#ffffff');
    });
});

// ── prop commands ─────────────────────────────────────────────────────────────

describe('prop commands', () => {
    const mkProp = () => ({ id:'p1', source:'lib', ref:'hat_01', bone:'head', position:[0,0,0], rotation:[0,0,0,1], scale:1 });
    it('AddPropCommand adds; undo removes', () => {
        const s = new AppStore(defaultState());
        const c = new AddPropCommand(mkProp());
        c.execute(s); expect(s.getState().props).toHaveLength(1);
        c.undo(s);    expect(s.getState().props).toHaveLength(0);
    });
    it('RemovePropCommand removes; undo re-adds with same id', () => {
        const s = new AppStore(defaultState()); s.addProp(mkProp());
        const c = new RemovePropCommand(mkProp());
        c.execute(s); expect(s.getState().props).toHaveLength(0);
        c.undo(s);    expect(s.getState().props[0].id).toBe('p1');
    });
    it('TransformPropCommand applies next; undo restores prev', () => {
        const s = new AppStore(defaultState()); s.addProp(mkProp());
        const c = new TransformPropCommand('p1', { scale:1, bone:'head' }, { scale:3, bone:'hand_R' });
        c.execute(s); expect(s.getState().props[0].scale).toBe(3); expect(s.getState().props[0].bone).toBe('hand_R');
        c.undo(s);    expect(s.getState().props[0].scale).toBe(1); expect(s.getState().props[0].bone).toBe('head');
    });
});

import { IKPoseCommand } from '../../static/src/commands.js';

describe('IKPoseCommand', () => {
    function makeStore(initialPose) {
        let pose = { ...initialPose };
        return {
            setPose: (p) => { pose = { ...p }; },
            getPose: () => pose,
        };
    }

    it('execute sets next pose, undo restores prev pose', () => {
        const prev = { upper_arm_L: { x: 0, y: 0, z: 0, w: 1 } };
        const next = { upper_arm_L: { x: 0, y: 0, z: 0.1, w: 0.99 }, forearm_L: { x: 0.2, y: 0, z: 0, w: 0.97 } };
        const store = makeStore(prev);
        const cmd = new IKPoseCommand(prev, next);
        cmd.execute(store);
        expect(store.getPose()).toEqual(next);
        cmd.undo(store);
        expect(store.getPose()).toEqual(prev);
    });

    it('description names IK', () => {
        const cmd = new IKPoseCommand({}, {});
        expect(cmd.description).toBe('IK pose');
    });
});

import * as THREE from '../lib/three.module.js';
import { MannequinRenderer } from './mannequin-renderer.js';
import { MannequinEditor }   from './mannequin-editor.js';
import { ComfyuiBridge }     from './comfyui-bridge.js';
import { defaultScene, jsonToScene } from './mannequin-model.js';
import { PoseLibrary } from './panels/pose-library.js';
import { ProportionsPanel } from './panels/proportions-panel.js';
import { BustDebugPanel } from './panels/bust-debug-panel.js';
import { OverlaysPanel } from './panels/overlays-panel.js';
import { AppStore, defaultState } from './app-store.js';
import { CommandHistory, SetBgImageCommand } from './commands.js';
import { parseCustomGLB, setCustomGLB, clearCustomGLB } from './geometry-adapter-gltf.js';

const params = new URLSearchParams(location.search);
const mode   = params.get('mode') ?? 'standalone';

// ── Store + History ────────────────────────────────────────────────────────────
const gender = params.get('gender') ?? 'F';
const store   = new AppStore(defaultState(gender));
const history = new CommandHistory(20);

const canvas   = document.getElementById('c');
const renderer = new MannequinRenderer(canvas, store);
const editor   = new MannequinEditor(renderer, canvas, store);
const poseLib  = new PoseLibrary(editor, renderer);
poseLib.mount(document.body);

const propsPanel = new ProportionsPanel(store, history);
propsPanel.mount(document.body);

const bustDbg = new BustDebugPanel(store, history);
bustDbg.mount(document.body);

const overlaysPanel = new OverlaysPanel(store, history);
overlaysPanel.mount(document.body);
const btnOverlays = document.getElementById('btn-overlays');
// (panel toggles wired together below via the side-panel coordinator)

// ── Background image picker ────────────────────────────────────────────────────
document.getElementById('bg-file-input')?.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const prev = store.getState().bgImage;
        history.execute(
            new SetBgImageCommand(prev, { ...prev, dataUrl: ev.target.result }),
            store
        );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
});

// ── Custom model loader ────────────────────────────────────────────────────────
const btnCustomModel   = document.getElementById('btn-custom-model');
const customModelInput = document.getElementById('custom-model-input');
let _customModelName   = null;

btnCustomModel?.addEventListener('click', () => customModelInput?.click());

customModelInput?.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    customModelInput.value = '';
    btnCustomModel.disabled = true;
    showLoading(`Loading ${file.name}…`);
    try {
        const buf     = await file.arrayBuffer();
        const nodeMap = await parseCustomGLB(buf);
        setCustomGLB(nodeMap);
        _customModelName = file.name;
        await editor.buildMannequin('custom', null);
        btnCustomModel.classList.add('active');
        btnCustomModel.title = `Custom: ${file.name} — click to replace`;
    } catch (err) {
        loadingMsg.textContent = `Failed — ${err.message}`;
        loadingMsg.style.color = '#f44';
        return;
    } finally {
        btnCustomModel.disabled = false;
        hideLoading();
    }
});

function resetCustomModel() {
    if (!_customModelName) return;
    clearCustomGLB();
    _customModelName = null;
    btnCustomModel.classList.remove('active');
    btnCustomModel.title = 'Load custom GLB humanoid model';
}

// ── Loading overlay ────────────────────────────────────────────────────────────
const loadingOverlay = document.getElementById('loading-overlay');
const loadingMsg     = document.getElementById('loading-msg');
function showLoading(msg = 'Loading model…') { loadingMsg.textContent = msg; loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }

// ── Initial model load ─────────────────────────────────────────────────────────
let initScene = null;
try {
    const sceneParam = params.get('scene');
    if (sceneParam) initScene = jsonToScene(decodeURIComponent(sceneParam));
} catch { /* malformed */ }

showLoading(`Loading ${gender === 'F' ? 'female' : 'male'} model…`);
try {
    if (initScene?.proportions) store.setProportions(initScene.proportions);
    await editor.buildMannequin(gender, initScene ?? defaultScene(gender));
    hideLoading();
} catch (err) {
    loadingMsg.textContent = `Failed to load model — ${err.message}`;
    loadingMsg.style.color = '#f44';
    document.querySelector('.spinner').style.display = 'none';
}

// ── Toolbar ────────────────────────────────────────────────────────────────────
const btnGender = document.getElementById('btn-gender');
if (btnGender) btnGender.textContent = gender;
btnGender?.addEventListener('click', async () => {
    if (btnGender.disabled) return;
    btnGender.disabled = true;
    resetCustomModel();
    const curGender = (editor.gender === 'F' || editor.gender === 'M') ? editor.gender : btnGender.textContent;
    const next = curGender === 'F' ? 'M' : 'F';
    showLoading(`Loading ${next === 'F' ? 'female' : 'male'} model…`);
    try {
        await editor.setGender(next);
        btnGender.textContent = next;
    } finally {
        btnGender.disabled = false;
        hideLoading();
    }
});

document.getElementById('btn-undo')?.addEventListener('click', () => editor.undo());
document.getElementById('btn-redo')?.addEventListener('click', () => editor.redo());
document.getElementById('btn-reset')?.addEventListener('click', () => editor.resetPose());
document.getElementById('btn-mirror-lr')?.addEventListener('click', () => editor.mirrorPose('L_to_R'));
document.getElementById('btn-mirror-rl')?.addEventListener('click', () => editor.mirrorPose('R_to_L'));
let randomMode = 'safe';
const btnRandomMode = document.getElementById('btn-random-mode');
btnRandomMode?.addEventListener('click', () => {
    randomMode = randomMode === 'safe' ? 'wild' : 'safe';
    btnRandomMode.textContent = randomMode === 'safe' ? '🔒' : '🔓';
    btnRandomMode.classList.toggle('wild', randomMode === 'wild');
    btnRandomMode.title = randomMode === 'safe'
        ? 'Safe: anatomical limits  |  click for Wild'
        : 'Wild: anything goes  |  click for Safe';
});
document.getElementById('btn-random')?.addEventListener('click', () => editor.generateRandomPose(randomMode));

const btnProps = document.getElementById('btn-props');

// ── Docked side panels — only one open at a time (Poses ⟷ Model) ─────────────────
// Floating panels (Overlays, Bust) stay independent and are wired separately below.
const SIDE_PANELS = [
    { panel: poseLib,    btn: document.getElementById('btn-poses') },
    { panel: propsPanel, btn: btnProps },
];
function toggleSidePanel(target) {
    const willOpen = !target.panel.isVisible();
    for (const e of SIDE_PANELS) {
        const open = (e === target) && willOpen;
        open ? e.panel.show() : e.panel.hide();
        if (e.btn) e.btn.classList.toggle('active', open);
    }
}
for (const e of SIDE_PANELS) {
    if (e.btn) e.btn.addEventListener('click', () => toggleSidePanel(e));
}

// ── Floating panels — independent toggles ───────────────────────────────────────
// All wiring below is null-safe: a missing toolbar button (e.g. an embedded host
// serving a cached older index.html) must NEVER crash init — the 3-D editor and the
// ComfyUI bridge are created further down and have to run regardless.
document.getElementById('btn-bust-dbg')?.addEventListener('click', () => bustDbg.toggle());
btnOverlays?.addEventListener('click', () => {
    overlaysPanel.toggle();
    btnOverlays.classList.toggle('active', overlaysPanel.isVisible());
});

const btnColors = document.getElementById('btn-colors');
btnColors?.addEventListener('click', () => {
    const current = store.getState().jointColorMode;
    const next    = current === 'openpose' ? 'flat' : 'openpose';
    store.setState({ jointColorMode: next });
    btnColors.textContent = next === 'openpose' ? 'OpenPose' : 'Flat';
    btnColors.classList.toggle('active', next === 'openpose');
});

// ── Mini overflow menu (⋯) ──────────────────────────────────────────────────────
const btnMore  = document.getElementById('btn-more');
const moreMenu = document.getElementById('more-menu');
if (btnMore && moreMenu) {
    const closeMoreMenu = () => { moreMenu.classList.remove('open'); btnMore.classList.remove('open'); };
    btnMore.addEventListener('click', e => {
        e.stopPropagation();
        const open = moreMenu.classList.toggle('open');
        btnMore.classList.toggle('open', open);
    });
    // Close after picking any tool inside the menu
    moreMenu.addEventListener('click', () => closeMoreMenu());
    // Close when clicking anywhere else
    document.addEventListener('click', e => {
        if (moreMenu.classList.contains('open') &&
            !moreMenu.contains(e.target) && e.target !== btnMore) {
            closeMoreMenu();
        }
    });
}

// ── Reactive overlay updates ───────────────────────────────────────────────────
store.subscribe(state => {
    const bgImg = document.getElementById('bg-image');
    if (!bgImg) return;
    const { dataUrl, opacity, zoom, offsetX = 0, offsetY = 0 } = state.bgImage;
    if (dataUrl) {
        if (bgImg.src !== dataUrl) bgImg.src = dataUrl;
        bgImg.style.display = 'block';
    } else {
        bgImg.style.display = 'none';
    }
    bgImg.style.opacity   = opacity;
    bgImg.style.transform = `translate(${offsetX}%, ${offsetY}%) scale(${zoom})`;

    const frame = document.getElementById('crop-frame');
    if (!frame) return;
    const { color, opacity: cfOpacity } = state.cropFrame;
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    frame.style.borderColor  = `rgba(${r},${g},${b},${cfOpacity})`;
    frame.style.outlineColor = `rgba(0,0,0,${Math.min(1, cfOpacity * 0.65)})`;
});

// ── ComfyUI mode ───────────────────────────────────────────────────────────────
if (mode === 'comfyui') {
    // Bridge first — the node depends on it; nothing below may block its creation.
    new ComfyuiBridge(editor, renderer);
    const statusBar = document.getElementById('status-bar');
    const statusEl  = document.getElementById('status');
    if (statusBar) statusBar.style.display = 'block';

    const btnSave = document.getElementById('btn-save');
    if (btnSave) {
        btnSave.style.display = 'inline-block';
        btnSave.addEventListener('click', () => {
            if (btnSave.disabled) return;
            btnSave.disabled = true;
            btnSave.textContent = 'Saving…';
            btnSave.classList.add('saving');
            if (statusEl) statusEl.textContent = 'Uploading…';
            window.parent.postMessage(
                { cmd: 'mannequin', type: 'event', method: 'UserSaved' },
                window.location.origin
            );
            setTimeout(() => {
                btnSave.disabled = false;
                btnSave.textContent = 'Close & Save';
                btnSave.classList.remove('saving');
                if (statusEl && statusEl.textContent === 'Uploading…') statusEl.textContent = 'Ready';
            }, 30000);
        });
    }
}

// ── Standalone mode ────────────────────────────────────────────────────────────
if (mode === 'standalone') {
    const exportBar = document.getElementById('export-bar');
    exportBar.style.display = 'flex';

    // Show GitHub link (hidden in ComfyUI embedded mode)
    const btnGithub = document.getElementById('btn-github');
    if (btnGithub) btnGithub.style.display = 'inline-block';

    function download(dataUrl, name) {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = name; a.click();
    }
    function withFeedback(btn, fn) {
        btn.addEventListener('click', async () => {
            if (btn.disabled) return;
            btn.disabled = true;
            const orig = btn.textContent;
            btn.textContent = '…';
            try { fn(); } finally {
                btn.disabled = false;
                btn.textContent = orig;
            }
        });
    }
    withFeedback(document.getElementById('btn-dl-pose'),  () => { const { pose }  = renderer.captureImages(); download(pose,  'pose.png');  });
    withFeedback(document.getElementById('btn-dl-depth'), () => { const { depth } = renderer.captureImages(); download(depth, 'depth.png'); });
    withFeedback(document.getElementById('btn-dl-canny'), () => { const { canny } = renderer.captureImages(); download(canny, 'canny.png'); });
}

// ── Crop frame ─────────────────────────────────────────────────────────────────
const CROP_PAD_TOP    = 0.04;
const CROP_PAD_BOTTOM = 0.09;
const CROP_PAD_SIDE   = 0.04;

const cropFrame = document.getElementById('crop-frame');
function updateCropFrame() {
    const wrap = document.getElementById('canvas-wrap');
    const cW = wrap.clientWidth, cH = wrap.clientHeight;
    const oW = renderer.outputWidth, oH = renderer.outputHeight;
    if (!cW || !cH || !oW || !oH) { cropFrame.style.display = 'none'; return; }

    const safeW  = cW * (1 - 2 * CROP_PAD_SIDE);
    const safeH  = cH * (1 - CROP_PAD_TOP - CROP_PAD_BOTTOM);
    const safeX0 = cW * CROP_PAD_SIDE;
    const safeY0 = cH * CROP_PAD_TOP;

    const safeAR   = safeW / safeH;
    const outputAR = oW / oH;
    let fW, fH;
    if (outputAR < safeAR) {
        fH = safeH; fW = safeH * outputAR;
    } else {
        fW = safeW; fH = safeW / outputAR;
    }

    const fX = Math.round(safeX0 + (safeW - fW) / 2);
    const fY = Math.round(safeY0 + (safeH - fH) / 2);

    cropFrame.style.display = 'block';
    cropFrame.style.left   = fX + 'px';
    cropFrame.style.top    = fY + 'px';
    cropFrame.style.width  = Math.round(fW) + 'px';
    cropFrame.style.height = Math.round(fH) + 'px';
}

new ResizeObserver(updateCropFrame).observe(document.getElementById('canvas-wrap'));

// ── Render loop ────────────────────────────────────────────────────────────────
function loop() {
    requestAnimationFrame(loop);
    editor.update();
    if (renderer._dirty) {
        const wrap = document.getElementById('canvas-wrap');
        renderer.render(wrap.clientWidth, wrap.clientHeight);
        updateCropFrame();
    }
}
loop();

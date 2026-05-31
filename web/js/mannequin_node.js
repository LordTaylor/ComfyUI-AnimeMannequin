import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

const EXT_NAME   = "AnimeMannequin";
const NODE_NAME  = "AnimeMannequinNode";
const EDITOR_URL = "/mannequin_editor/index.html";

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resolve width/height — follows upstream links (same as OpenPoseEditor fix)
function readUpstreamNumber(node, inputName) {
    const input = node.inputs?.find(i => i.name === inputName);
    if (!input || input.link == null) return null;
    const link = app.graph.links?.[input.link];
    if (!link) return null;
    const src = app.graph.getNodeById?.(link.origin_id);
    return src?.widgets?.find(w => typeof w.value === "number")?.value ?? null;
}

function resolveNodeSize(node) {
    const w = readUpstreamNumber(node, "width")  ?? node.widgets?.find(w => w.name === "width")?.value  ?? 768;
    const h = readUpstreamNumber(node, "height") ?? node.widgets?.find(w => w.name === "height")?.value ?? 1024;
    const g = node.widgets?.find(w => w.name === "gender")?.value ?? "F";
    return { w, h, g };
}

// postMessage invoke with requestId (matches comfyui-bridge.js protocol)
let _reqCounter = 0;
function invoke(iframeWin, method, payload = [], timeoutMs = 5000) {
    const requestId = `node-${Date.now()}-${++_reqCounter}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error(`Timeout: ${method}`));
        }, timeoutMs);
        function handler(e) {
            if (e.origin !== window.location.origin) return;
            const d = e.data;
            if (d?.cmd === "mannequin" && d?.requestId === requestId) {
                window.removeEventListener("message", handler);
                clearTimeout(timer);
                if (d.type === "error") reject(new Error(d.error));
                else resolve(d.payload);
            }
        }
        window.addEventListener("message", handler);
        iframeWin.postMessage({ cmd: "mannequin", requestId, method, type: "call", payload }, window.location.origin);
    });
}

async function waitForEditorReady(iframeWin, retries = 40) {
    for (let i = 0; i < retries; i++) {
        try {
            const w = await invoke(iframeWin, "GetWidth", [], 1000);
            if (typeof w === "number" && w > 0) return true;
        } catch { /* not ready */ }
        await sleep(300);
    }
    return false;
}

async function applyOutputSize(iframeWin, w, h) {
    for (let i = 0; i < 8; i++) {
        try {
            const okW = await invoke(iframeWin, "OutputWidth",  [w], 800);
            const okH = await invoke(iframeWin, "OutputHeight", [h], 800);
            if (okW === true && okH === true) return true;
        } catch { /* retry */ }
        await sleep(200);
    }
    return false;
}

function dataUrlToBlob(dataUrl) {
    if (!dataUrl?.includes(",")) throw new Error("Invalid data URL");
    const [header, data] = dataUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1];
    if (!mime) throw new Error("Invalid mime in data URL");
    const bytes = atob(data);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

async function uploadImage(dataUrl, filename) {
    const form = new FormData();
    form.append("image", dataUrlToBlob(dataUrl), filename);
    form.append("overwrite", "true");
    const resp = await api.fetchApi("/upload/image", { method: "POST", body: form });
    if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
    const json = await resp.json();
    if (!json.name) throw new Error("Upload missing filename");
    return json.name;
}

function openMannequinModal(node) {
    const { w, h, g } = resolveNodeSize(node);
    const savedScene = node.properties?.mannequin_scene;

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10000;";

    const container = document.createElement("div");
    container.style.cssText = "width:90vw;height:90vh;display:flex;flex-direction:column;background:#1a1a1a;border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.5);";

    const statusBar = document.createElement("div");
    statusBar.style.cssText = "padding:4px 16px;background:#111;color:#aaa;font-size:11px;flex-shrink:0;min-height:22px;";
    statusBar.textContent = "Loading editor...";
    const setStatus = (msg, color = "#aaa") => { statusBar.textContent = msg; statusBar.style.color = color; };

    // Build iframe URL
    let src = `${EDITOR_URL}?mode=comfyui&gender=${g}`;
    if (savedScene) src += `&scene=${encodeURIComponent(savedScene)}`;

    const iframe = document.createElement("iframe");
    iframe.src = src;
    iframe.style.cssText = "flex:1;border:none;width:100%;";

    container.appendChild(iframe);
    container.appendChild(statusBar);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    let closing = false;

    function cleanup() {
        window.removeEventListener("message", onMessage);
        window.removeEventListener("keydown", keyHandler);
    }

    // Listen for UserSaved event from editor
    async function onMessage(e) {
        if (e.origin !== window.location.origin) return;
        const d = e.data;
        if (d?.cmd !== "mannequin" || d?.method !== "UserSaved") return;
        if (closing) return;
        closing = true;
        cleanup();

        try {
            setStatus("Capturing...", "#FFA500");
            const images = await invoke(iframe.contentWindow, "MakeImages", [], 20000);

            // Upload pose + depth + canny
            const poseFile  = await uploadImage(images.pose,  "mannequin_pose.png");
            const depthFile = await uploadImage(images.depth, "mannequin_depth.png");
            const cannyFile = images.canny ? await uploadImage(images.canny, "mannequin_canny.png") : "";

            // Update node widgets
            const pw = node.widgets?.find(w => w.name === "pose_file");
            const dw = node.widgets?.find(w => w.name === "depth_file");
            const cw = node.widgets?.find(w => w.name === "canny_file");
            if (pw) pw.value = poseFile;
            if (dw) dw.value = depthFile;
            if (cw) cw.value = cannyFile;

            // Save scene for restore
            const scene = await invoke(iframe.contentWindow, "GetSceneData", [], 5000);
            node.properties = node.properties || {};
            node.properties.mannequin_scene = JSON.stringify(scene);

            // Update thumbnail
            if (node._thumbnailImg) node._thumbnailImg.src = images.pose;

            app.graph.setDirtyCanvas(true, true);
            setStatus("Saved to node", "#4CAF50");
            setTimeout(() => overlay.remove(), 600);
        } catch (err) {
            console.error("[AnimeMannequin] save error:", err);
            setStatus(`Error: ${err.message}`, "#f44");
            closing = false;
        }
    }
    window.addEventListener("message", onMessage);

    iframe.onload = async () => {
        const ready = await waitForEditorReady(iframe.contentWindow);
        if (!ready) { setStatus("Editor failed to load", "#f44"); return; }
        const sized = await applyOutputSize(iframe.contentWindow, w, h);
        setStatus(
            sized ? `Ready - ${w}x${h} - pose then Close & Save` : `Ready (size ${w}x${h} may not have applied)`,
            sized ? "#4CAF50" : "#FFA500"
        );
    };

    // ESC to cancel
    const keyHandler = e => {
        if (e.key === "Escape") { cleanup(); overlay.remove(); }
    };
    window.addEventListener("keydown", keyHandler);
}

app.registerExtension({
    name: EXT_NAME,

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const orig = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            orig?.apply(this, arguments);

            // Open editor button
            const btn = document.createElement("button");
            btn.textContent = "Open Mannequin Editor";
            btn.style.cssText = [
                "width:calc(100% - 16px)", "margin:6px 8px 2px 8px",
                "padding:8px 12px", "background:#1565c0", "color:#fff",
                "border:none", "border-radius:6px", "cursor:pointer",
                "font-size:13px", "font-weight:bold", "display:block",
            ].join(";");
            const self = this;
            btn.onclick = e => { e.stopPropagation(); openMannequinModal(self); };
            this.addDOMWidget("open_editor_btn", "btn", btn, {
                getValue() { return ""; }, setValue() {},
                computeSize() { return [0, 42]; }, serialize: false,
            });

            // Thumbnail preview image
            const img = document.createElement("img");
            img.style.cssText = "width:calc(100% - 16px);margin:2px 8px;border-radius:4px;display:block;background:#111;min-height:40px;object-fit:contain;";
            img.alt = "No pose captured yet";
            this._thumbnailImg = img;
            this.addDOMWidget("thumbnail", "thumbnail", img, {
                getValue() { return ""; }, setValue() {},
                computeSize() { return [0, 80]; }, serialize: false,
            });

            // Make file widgets read-only
            setTimeout(() => {
                for (const w of this.widgets ?? []) {
                    if (["pose_file", "depth_file", "canny_file"].includes(w.name)) w.disabled = true;
                }
            }, 100);
        };
    },
});

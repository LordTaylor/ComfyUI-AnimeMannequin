import { FINGER_PRESETS, buildPresetPose } from '../finger-presets.js';

export class HandsPanel {
    constructor(editor) {
        this._editor  = editor;
        this._panel   = null;
        this._visible = false;
    }

    isVisible() { return this._visible; }
    show() { this._visible = true;  if (this._panel) this._panel.style.display = 'flex'; }
    hide() { this._visible = false; if (this._panel) this._panel.style.display = 'none'; }
    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:40px', 'bottom:0', 'width:200px',
            'background:#222', 'border-left:1px solid #444', 'overflow:hidden',
            'z-index:100', 'display:none', 'flex-direction:column',
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'padding:8px;border-bottom:1px solid #444;display:flex;align-items:center;';
        const title = document.createElement('span');
        title.textContent = 'Hands';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Close panel';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;';
        closeBtn.onclick = () => this.toggle();
        header.appendChild(title);
        header.appendChild(closeBtn);

        const list = document.createElement('div');
        list.style.cssText = 'flex:1;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:6px;';
        for (const name of Object.keys(FINGER_PRESETS)) {
            const btn = document.createElement('button');
            btn.textContent = name;
            btn.dataset.fingerPreset = name;
            btn.style.cssText = 'width:100%;padding:8px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:12px;text-align:left;';
            btn.onmouseenter = () => { btn.style.background = '#444'; };
            btn.onmouseleave = () => { btn.style.background = '#333'; };
            btn.onclick = () => this._editor.applyFingerPreset(buildPresetPose(name));
            list.appendChild(btn);
        }

        this._panel.appendChild(header);
        this._panel.appendChild(list);
        container.appendChild(this._panel);
    }
}

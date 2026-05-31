const STORAGE_KEY = 'mannequin_poses';

export class PoseLibrary {
    constructor(editor, renderer) {
        this._editor   = editor;
        this._renderer = renderer;
        this._panel    = null;
        this._listEl   = null;
        this._visible  = false;
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
        catch { return []; }
    }

    _save(poses) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(poses));
    }

    saveCurrent(name) {
        const scene     = this._editor.getSceneData();
        const thumbnail = this._renderer._renderer.domElement.toDataURL('image/jpeg', 0.6);
        const poses     = this._load();
        poses.unshift({ id: `${Date.now()}`, name, thumbnail, scene });
        this._save(poses.slice(0, 50)); // cap at 50 poses
        this._renderList();
    }

    deletePose(id) {
        this._save(this._load().filter(p => p.id !== id));
        this._renderList();
    }

    loadPose(id) {
        const pose = this._load().find(p => p.id === id);
        if (!pose) return;
        this._renderer.applyScene(pose.scene);
        this._renderer.markDirty();
    }

    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:0', 'bottom:0', 'width:220px',
            'background:#222', 'border-left:1px solid #444', 'overflow:hidden',
            'z-index:100', 'display:none', 'flex-direction:column',
        ].join(';');

        const header = document.createElement('div');
        header.style.cssText = 'padding:8px;border-bottom:1px solid #444;flex-shrink:0;';

        const title = document.createElement('span');
        title.textContent = 'Poses';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;display:block;margin-bottom:6px;';
        header.appendChild(title);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '+ Save current';
        saveBtn.style.cssText = 'width:100%;padding:6px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;';
        saveBtn.onclick = () => {
            const name = prompt('Pose name:', 'Pose');
            if (name?.trim()) this.saveCurrent(name.trim());
        };
        header.appendChild(saveBtn);

        this._listEl = document.createElement('div');
        this._listEl.style.cssText = 'flex:1;overflow-y:auto;padding:4px;';

        this._panel.appendChild(header);
        this._panel.appendChild(this._listEl);
        container.appendChild(this._panel);
        this._renderList();
    }

    _renderList() {
        if (!this._listEl) return;
        const poses = this._load();
        this._listEl.innerHTML = '';
        if (!poses.length) {
            this._listEl.innerHTML = '<p style="color:#666;font-size:11px;padding:8px;">No saved poses.</p>';
            return;
        }
        for (const pose of poses) {
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px;border-bottom:1px solid #333;cursor:pointer;';
            item.onmouseenter = () => { item.style.background = '#333'; };
            item.onmouseleave = () => { item.style.background = ''; };
            item.onclick = () => this.loadPose(pose.id);

            const thumb = document.createElement('img');
            thumb.src = pose.thumbnail;
            thumb.style.cssText = 'width:48px;height:64px;object-fit:cover;border-radius:3px;flex-shrink:0;';

            const info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            const nameEl = document.createElement('div');
            nameEl.textContent = pose.name;
            nameEl.style.cssText = 'color:#eee;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            info.appendChild(nameEl);

            const del = document.createElement('button');
            del.textContent = '×';
            del.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0;';
            del.onclick = e => { e.stopPropagation(); this.deletePose(pose.id); };

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(del);
            this._listEl.appendChild(item);
        }
    }
}

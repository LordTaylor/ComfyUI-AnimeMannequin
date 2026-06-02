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
        // Route through editor so undo snapshot is saved before applying
        this._editor.applySceneWithUndo(pose.scene);
    }

    // ── Import / Export ──────────────────────────────────────────────────────────

    _download(filename, obj) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }

    exportAll() {
        const poses = this._load();
        if (!poses.length) { alert('No saved poses to export.'); return; }
        this._download('mannequin-poses.json',
            { type: 'mannequin-pose-collection', version: 1, poses });
    }

    exportOne(id) {
        const pose = this._load().find(p => p.id === id);
        if (!pose) return;
        const safe = (pose.name || 'pose').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
        this._download(`pose-${safe}.json`, { type: 'mannequin-pose', version: 1, pose });
    }

    /** Accepts a collection {poses:[…]}, a single {pose:{…}}, a raw array, or a raw pose. */
    importData(data) {
        let incoming = [];
        if (Array.isArray(data))            incoming = data;
        else if (Array.isArray(data?.poses)) incoming = data.poses;
        else if (data?.pose)                 incoming = [data.pose];
        else if (data?.scene)                incoming = [data];
        incoming = incoming.filter(p => p && p.scene);
        if (!incoming.length) { alert('No valid poses found in this file.'); return; }

        let n = 0;
        const base = Date.now();
        const stamped = incoming.map(p => ({
            id:        `${base}_${n++}`,            // fresh ids — never collide with existing
            name:      (p.name || 'Imported').toString().slice(0, 60),
            thumbnail: p.thumbnail || '',
            scene:     p.scene,
        }));
        this._save([...stamped, ...this._load()].slice(0, 50));
        this._renderList();
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

        // Title row with close button
        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display:flex;align-items:center;margin-bottom:6px;';
        const title = document.createElement('span');
        title.textContent = 'Poses';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Close panel';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;';
        closeBtn.onclick = () => this.toggle();
        titleRow.appendChild(title);
        titleRow.appendChild(closeBtn);
        header.appendChild(titleRow);

        const saveBtn = document.createElement('button');
        saveBtn.textContent = '+ Save current';
        saveBtn.style.cssText = 'width:100%;padding:6px;background:#1565c0;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:11px;';
        saveBtn.onclick = () => {
            const name = prompt('Pose name:', 'Pose');
            if (name?.trim()) this.saveCurrent(name.trim());
        };
        header.appendChild(saveBtn);

        // ── Import / Export row ────────────────────────────────────────────────
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'application/json,.json';
        fileInput.style.display = 'none';
        fileInput.addEventListener('change', e => {
            const file = e.target.files[0];
            e.target.value = '';
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try { this.importData(JSON.parse(reader.result)); }
                catch { alert('Invalid JSON file.'); }
            };
            reader.readAsText(file);
        });

        const ioRow = document.createElement('div');
        ioRow.style.cssText = 'display:flex;gap:4px;margin-top:6px;';
        const importBtn = document.createElement('button');
        importBtn.textContent = '⬆ Import';
        importBtn.title = 'Import poses from a .json file';
        importBtn.style.cssText = 'flex:1;padding:5px;background:#333;color:#cce;border:none;border-radius:4px;cursor:pointer;font-size:11px;';
        importBtn.onclick = () => fileInput.click();
        const exportBtn = document.createElement('button');
        exportBtn.textContent = '⬇ Export all';
        exportBtn.title = 'Export the whole library to a .json file';
        exportBtn.style.cssText = 'flex:1;padding:5px;background:#333;color:#cce;border:none;border-radius:4px;cursor:pointer;font-size:11px;';
        exportBtn.onclick = () => this.exportAll();
        ioRow.appendChild(importBtn);
        ioRow.appendChild(exportBtn);
        header.appendChild(ioRow);
        header.appendChild(fileInput);

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
            thumb.style.cssText = 'width:48px;height:64px;object-fit:cover;border-radius:3px;flex-shrink:0;background:#444;';
            if (pose.thumbnail) thumb.src = pose.thumbnail;
            else thumb.alt = '';            // imported pose without a thumbnail → grey box
            thumb.onerror = () => { thumb.removeAttribute('src'); };

            const info = document.createElement('div');
            info.style.cssText = 'flex:1;min-width:0;';
            const nameEl = document.createElement('div');
            nameEl.textContent = pose.name;
            nameEl.style.cssText = 'color:#eee;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
            info.appendChild(nameEl);

            const exp = document.createElement('button');
            exp.textContent = '⬇';
            exp.title = 'Export this pose';
            exp.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:12px;padding:0 4px;flex-shrink:0;';
            exp.onclick = e => { e.stopPropagation(); this.exportOne(pose.id); };

            const del = document.createElement('button');
            del.textContent = '×';
            del.title = 'Delete this pose';
            del.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:0 4px;flex-shrink:0;';
            del.onclick = e => { e.stopPropagation(); this.deletePose(pose.id); };

            item.appendChild(thumb);
            item.appendChild(info);
            item.appendChild(exp);
            item.appendChild(del);
            this._listEl.appendChild(item);
        }
    }
}

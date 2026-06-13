import { PROP_LIBRARY } from '../props.js';

export class PropsPanel {
    constructor(api) {
        this._api     = api;
        this._panel   = null;
        this._list    = null;
        this._visible = false;
    }

    isVisible() { return this._visible; }
    show()   { this._visible = true;  if (this._panel) this._panel.style.display = 'flex'; }
    hide()   { this._visible = false; if (this._panel) this._panel.style.display = 'none'; }
    toggle() {
        this._visible = !this._visible;
        if (this._panel) this._panel.style.display = this._visible ? 'flex' : 'none';
    }

    mount(container) {
        this._panel = document.createElement('div');
        this._panel.style.cssText = [
            'position:fixed', 'right:0', 'top:40px', 'bottom:0', 'width:220px',
            'background:#222', 'border-left:1px solid #444', 'overflow:hidden',
            'z-index:100', 'display:none', 'flex-direction:column',
        ].join(';');

        // ── Header ──────────────────────────────────────────────────────────────
        const header = document.createElement('div');
        header.style.cssText = 'padding:8px;border-bottom:1px solid #444;display:flex;align-items:center;';
        const title = document.createElement('span');
        title.textContent = 'Props';
        title.style.cssText = 'color:#fff;font-size:12px;font-weight:bold;flex:1;';
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.title = 'Close panel';
        closeBtn.style.cssText = 'background:none;border:none;color:#aaa;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;';
        closeBtn.onclick = () => this.toggle();
        header.appendChild(title);
        header.appendChild(closeBtn);

        // ── Library section ──────────────────────────────────────────────────────
        const libSection = document.createElement('div');
        libSection.style.cssText = 'padding:6px;border-bottom:1px solid #333;display:flex;flex-direction:column;gap:4px;';

        if (PROP_LIBRARY.length > 0) {
            const libLabel = document.createElement('div');
            libLabel.textContent = 'Library';
            libLabel.style.cssText = 'color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:2px;';
            libSection.appendChild(libLabel);
        }

        for (const entry of PROP_LIBRARY) {
            const btn = document.createElement('button');
            btn.textContent = entry.name ?? entry.id;
            btn.dataset.libProp = entry.id;
            btn.style.cssText = 'width:100%;padding:6px 8px;background:#333;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:12px;text-align:left;';
            btn.onmouseenter = () => { btn.style.background = '#444'; };
            btn.onmouseleave = () => { btn.style.background = '#333'; };
            btn.onclick = () => this._api.addLibraryProp(entry.id);
            libSection.appendChild(btn);
        }

        // ── Upload control ───────────────────────────────────────────────────────
        const uploadLabel = document.createElement('label');
        uploadLabel.style.cssText = 'padding:6px 8px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid #333;';
        const uploadTitle = document.createElement('span');
        uploadTitle.textContent = 'Upload GLB';
        uploadTitle.style.cssText = 'color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;';
        const uploadInput = document.createElement('input');
        uploadInput.type = 'file';
        uploadInput.accept = '.glb';
        uploadInput.dataset.propUpload = '';
        uploadInput.style.cssText = 'font-size:11px;color:#aaa;';
        uploadInput.addEventListener('change', () => {
            const file = uploadInput.files[0];
            if (!file) return;
            file.arrayBuffer().then(buf => {
                this._api.addUpload(file.name, buf);
                uploadInput.value = '';
            });
        });
        uploadLabel.appendChild(uploadTitle);
        uploadLabel.appendChild(uploadInput);

        // ── Current props list ───────────────────────────────────────────────────
        this._list = document.createElement('div');
        this._list.style.cssText = 'flex:1;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:4px;';

        this._panel.appendChild(header);
        this._panel.appendChild(libSection);
        this._panel.appendChild(uploadLabel);
        this._panel.appendChild(this._list);
        container.appendChild(this._panel);
    }

    /** Rebuild the current-props list from api.listProps(). */
    refresh() {
        if (!this._list) return;
        this._list.innerHTML = '';
        const props = this._api.listProps();
        for (const prop of props) {
            const row = document.createElement('div');
            row.dataset.propId = prop.id;
            row.style.cssText = 'background:#2a2a2a;border:1px solid #3a3a3a;border-radius:4px;padding:6px 8px;display:flex;flex-direction:column;gap:4px;cursor:pointer;';

            // Info line
            const info = document.createElement('div');
            info.style.cssText = 'display:flex;align-items:center;gap:6px;';

            const refSpan = document.createElement('span');
            refSpan.textContent = prop.ref;
            refSpan.style.cssText = 'color:#ccc;font-size:11px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            const boneSpan = document.createElement('span');
            boneSpan.textContent = prop.bone;
            boneSpan.style.cssText = 'color:#888;font-size:10px;';

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '✕';
            removeBtn.dataset.removeProp = prop.id;
            removeBtn.title = 'Remove prop';
            removeBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:11px;padding:0 2px;flex-shrink:0;';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                this._api.removeProp(prop.id);
            };

            info.appendChild(refSpan);
            info.appendChild(boneSpan);
            info.appendChild(removeBtn);
            row.appendChild(info);

            // Missing marker
            if (prop.missing) {
                const missingNote = document.createElement('span');
                missingNote.textContent = 'missing — re-upload';
                missingNote.style.cssText = 'color:#f6a;font-size:10px;font-style:italic;';
                row.appendChild(missingNote);
            }

            // Row click → selectProp (but not on remove button)
            row.addEventListener('click', () => this._api.selectProp(prop.id));

            this._list.appendChild(row);
        }
    }
}

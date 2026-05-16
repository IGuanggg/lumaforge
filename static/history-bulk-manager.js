(function(){
    const STYLE_ID = 'history-bulk-manager-style';
    const labels = () => {
        const en = window.StudioI18n?.lang?.() === 'en';
        return en ? {
            manage:'Manage',
            done:'Done',
            delete:'Delete',
            selected:'selected',
            cancel:'Cancel'
        } : {
            manage:'批量管理',
            done:'完成',
            delete:'删除',
            selected:'已选择',
            cancel:'取消'
        };
    };

    function ensureStyle(){
        if(document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .history-bulk-toolbar{display:flex;align-items:center;gap:10px;margin:-4px 0 18px;min-height:34px}
            .history-bulk-toolbar .bulk-spacer{flex:1}
            .history-bulk-btn{height:32px;border-radius:999px;border:1px solid rgba(148,163,184,.28);background:rgba(255,255,255,.9);color:#475569;padding:0 12px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;display:inline-flex;align-items:center;gap:7px;transition:all .18s ease}
            .history-bulk-btn:hover{background:#111827;color:#fff;border-color:#111827}
            .history-bulk-btn.danger{background:#ef4444;color:#fff;border-color:#ef4444}
            .history-bulk-btn.danger:disabled{opacity:.38;cursor:not-allowed}
            .history-bulk-count{font-size:10px;font-weight:900;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em}
            .history-bulk-selecting .masonry-item{cursor:pointer!important}
            .history-bulk-selecting .masonry-item::after{content:"";position:absolute;inset:0;border-radius:inherit;background:rgba(15,23,42,.16);opacity:0;transition:opacity .14s ease;pointer-events:none;z-index:8}
            .history-bulk-selecting .masonry-item:hover::after{opacity:1}
            .masonry-item.bulk-selected::after{opacity:1;background:rgba(37,99,235,.24)}
            .masonry-item.bulk-selected{outline:3px solid #2563eb;outline-offset:3px}
            .bulk-check{position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:999px;background:#2563eb;color:#fff;display:none;align-items:center;justify-content:center;z-index:12;box-shadow:0 10px 22px rgba(37,99,235,.25)}
            .history-bulk-selecting .bulk-check{display:flex}
            .bulk-check::before{content:"";width:8px;height:5px;border-left:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg);opacity:.25}
            .masonry-item.bulk-selected .bulk-check::before{opacity:1}
            .history-select-box{position:fixed;z-index:9999;border:1px solid #2563eb;background:rgba(37,99,235,.12);pointer-events:none;border-radius:8px}
            html.studio-theme-dark .history-bulk-btn,body.studio-theme-dark .history-bulk-btn{background:#111722;border-color:#2a3444;color:#d8dee9}
            html.studio-theme-dark .history-bulk-btn:hover,body.studio-theme-dark .history-bulk-btn:hover{background:#d8dee9;color:#10141d;border-color:#d8dee9}
        `;
        document.head.appendChild(style);
    }

    function deleteHistory(timestamp){
        return fetch('/api/history/delete', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({timestamp})
        }).then(r => r.json()).catch(() => ({success:false}));
    }

    function attach(options={}){
        ensureStyle();
        const masonry = typeof options.masonry === 'string' ? document.querySelector(options.masonry) : (options.masonry || document.getElementById('masonry'));
        if(!masonry || masonry._historyBulkManager) return masonry?._historyBulkManager || null;
        const L = labels();
        const toolbar = document.createElement('div');
        toolbar.className = 'history-bulk-toolbar';
        toolbar.innerHTML = `
            <span class="bulk-spacer"></span>
            <span class="history-bulk-count" data-bulk-count></span>
            <button class="history-bulk-btn danger" type="button" data-bulk-delete disabled>${L.delete}</button>
            <button class="history-bulk-btn" type="button" data-bulk-toggle>${L.manage}</button>
        `;
        masonry.parentNode.insertBefore(toolbar, masonry);
        const toggleBtn = toolbar.querySelector('[data-bulk-toggle]');
        const deleteBtn = toolbar.querySelector('[data-bulk-delete]');
        const countEl = toolbar.querySelector('[data-bulk-count]');
        let selecting = false;
        let selected = new Set();
        let drag = null;

        function selectableCards(){
            return [...masonry.querySelectorAll('.masonry-item[data-history-ts]')];
        }
        function cardTs(card){ return card?.dataset?.historyTs || ''; }
        function sync(){
            const l = labels();
            toolbar.querySelector('[data-bulk-toggle]').textContent = selecting ? l.done : l.manage;
            deleteBtn.textContent = l.delete;
            deleteBtn.disabled = !selected.size;
            countEl.textContent = selected.size ? `${selected.size} ${l.selected}` : '';
            document.body.classList.toggle('history-bulk-selecting', selecting);
            selectableCards().forEach(card => {
                card.classList.toggle('bulk-selected', selected.has(cardTs(card)));
                if(!card.querySelector('.bulk-check')){
                    const check = document.createElement('span');
                    check.className = 'bulk-check';
                    card.appendChild(check);
                }
            });
        }
        function setSelecting(next){
            selecting = Boolean(next);
            if(!selecting) selected.clear();
            sync();
        }
        function toggleCard(card){
            const ts = cardTs(card);
            if(!ts) return;
            selected.has(ts) ? selected.delete(ts) : selected.add(ts);
            sync();
        }
        toggleBtn.onclick = () => setSelecting(!selecting);
        deleteBtn.onclick = async () => {
            if(!selected.size) return;
            const targets = [...selected];
            deleteBtn.disabled = true;
            for(const ts of targets){
                const res = await deleteHistory(ts);
                if(res.success){
                    document.querySelector(`[data-history-ts="${CSS.escape(ts)}"]`)?.remove();
                    selected.delete(ts);
                }
            }
            sync();
            options.onDelete?.(targets);
        };
        masonry.addEventListener('click', e => {
            if(!selecting) return;
            const card = e.target.closest('.masonry-item[data-history-ts]');
            if(!card || !masonry.contains(card)) return;
            e.preventDefault();
            e.stopPropagation();
            toggleCard(card);
        }, true);
        masonry.addEventListener('mousedown', e => {
            if(!selecting || e.button !== 0) return;
            if(e.target.closest('.masonry-item')) return;
            e.preventDefault();
            const box = document.createElement('div');
            box.className = 'history-select-box';
            document.body.appendChild(box);
            drag = {sx:e.clientX, sy:e.clientY, box};
        });
        window.addEventListener('mousemove', e => {
            if(!drag) return;
            const x = Math.min(drag.sx, e.clientX);
            const y = Math.min(drag.sy, e.clientY);
            const w = Math.abs(e.clientX - drag.sx);
            const h = Math.abs(e.clientY - drag.sy);
            Object.assign(drag.box.style, {left:`${x}px`, top:`${y}px`, width:`${w}px`, height:`${h}px`});
            const r = {left:x, top:y, right:x+w, bottom:y+h};
            selectableCards().forEach(card => {
                const cr = card.getBoundingClientRect();
                const hit = cr.left < r.right && cr.right > r.left && cr.top < r.bottom && cr.bottom > r.top;
                if(hit) selected.add(cardTs(card));
            });
            sync();
        });
        window.addEventListener('mouseup', () => {
            if(!drag) return;
            drag.box.remove();
            drag = null;
            sync();
        });
        let syncTimer = null;
        const observer = new MutationObserver(() => {
            if(!selecting) return;
            clearTimeout(syncTimer);
            syncTimer = setTimeout(sync, 30);
        });
        observer.observe(masonry, {childList:true});
        const manager = {sync, setSelecting, isSelecting:() => selecting};
        masonry._historyBulkManager = manager;
        sync();
        return manager;
    }

    window.HistoryBulkManager = {attach};
})();

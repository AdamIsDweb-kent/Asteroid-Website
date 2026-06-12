/* =========================================================================
   APP — rendering, camera, time control and UI for the live orrery
   ========================================================================= */
(function () {
    'use strict';

    const O = window.ORBITS;
    const D = window.DATA;

    // ---------- DOM ----------
    const canvas = document.getElementById('space');
    const ctx = canvas.getContext('2d');
    const elSimDate = document.getElementById('sim-date');
    const elBadge = document.getElementById('live-badge');
    const elList = document.getElementById('object-list');
    const elCount = document.getElementById('obj-count');
    const elSearch = document.getElementById('search');
    const elInfo = document.getElementById('info-card');
    const elCad = document.getElementById('cad-list');
    const elTooltip = document.getElementById('tooltip');
    const elToast = document.getElementById('status-toast');

    // ---------- constants ----------
    const AU_KM = 149597870.7;
    const AU_LD = 389.17;                 // lunar distances per AU
    const COLORS = {
        neo: '#ffb347', pha: '#ff5d6c', comet: '#7ee8fa', ast: '#c8a76a',
        accent: '#6ee7ff'
    };
    const RING_RADII = [0.5, 1, 2, 3, 5, 10, 20, 30];

    // ---------- state ----------
    const cam = { x: 0, y: 0, scale: 180, min: 1.5, max: 30000 };
    const time = { mode: 'live', rate: 0, simMs: Date.now() };
    let W = 0, H = 0, DPR = 1;
    let planets = [];
    let bodies = [];                      // small bodies
    let cadRows = [];
    let selected = null, hovered = null, following = false;
    let lastFrame = performance.now();
    let starCanvas = null;
    const spriteCache = {};
    const mouse = { x: -999, y: -999, down: false, dragged: false, sx: 0, sy: 0 };
    const pointers = new Map();
    let pinchDist = 0;

    // =====================================================================
    // setup
    // =====================================================================
    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = W * DPR;
        canvas.height = H * DPR;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        makeStars();
    }

    function makeStars() {
        starCanvas = document.createElement('canvas');
        starCanvas.width = W;
        starCanvas.height = H;
        const c = starCanvas.getContext('2d');
        const n = Math.floor(W * H / 2600);
        for (let k = 0; k < n; k++) {
            const r = Math.random();
            const size = r < 0.85 ? 0.7 : r < 0.97 ? 1.2 : 1.9;
            const a = 0.18 + Math.random() * 0.55;
            c.fillStyle = `rgba(${200 + Math.random() * 55 | 0},${205 + Math.random() * 50 | 0},255,${a})`;
            c.beginPath();
            c.arc(Math.random() * W, Math.random() * H, size, 0, 7);
            c.fill();
        }
    }

    function dotSprite(color, r) {
        const key = color + r;
        if (spriteCache[key]) return spriteCache[key];
        const s = Math.ceil(r * 6);
        const cv = document.createElement('canvas');
        cv.width = cv.height = s;
        const c = cv.getContext('2d');
        const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, color);
        g.addColorStop(0.25, color);
        g.addColorStop(0.5, color + '55');
        g.addColorStop(1, 'transparent');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
        spriteCache[key] = cv;
        return cv;
    }

    // =====================================================================
    // time
    // =====================================================================
    function simJd() { return O.jdFromMs(time.simMs); }

    function setRate(val) {
        document.querySelectorAll('.tc-btn[data-rate]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector(`.tc-btn[data-rate="${val}"]`);
        if (btn) btn.classList.add('active');
        if (val === 'live') {
            time.mode = 'live';
            time.simMs = Date.now();
        } else {
            time.mode = 'sim';
            time.rate = parseFloat(val);    // sim seconds per real second (0 = paused)
        }
    }

    function tickTime(dtMs) {
        if (time.mode === 'live') time.simMs = Date.now();
        else time.simMs += dtMs * time.rate;
    }

    function updateClock() {
        const d = new Date(time.simMs);
        elSimDate.textContent = d.toUTCString().replace('GMT', 'UTC');
        if (time.mode === 'live') {
            elBadge.textContent = '● LIVE';
            elBadge.className = 'live';
        } else {
            const offDays = (time.simMs - Date.now()) / 86400000;
            const sign = offDays >= 0 ? '+' : '−';
            elBadge.textContent = time.rate === 0
                ? '⏸ PAUSED ' + sign + Math.abs(offDays).toFixed(1) + ' d'
                : 'SIM ' + sign + Math.abs(offDays).toFixed(1) + ' d';
            elBadge.className = 'sim';
        }
    }

    // =====================================================================
    // projection helpers
    // =====================================================================
    function toScreen(p) {
        return { x: W / 2 + (p.x - cam.x) * cam.scale, y: H / 2 - (p.y - cam.y) * cam.scale };
    }

    function zoomAt(mx, my, factor) {
        const wx = cam.x + (mx - W / 2) / cam.scale;
        const wy = cam.y - (my - H / 2) / cam.scale;
        cam.scale = Math.min(cam.max, Math.max(cam.min, cam.scale * factor));
        cam.x = wx - (mx - W / 2) / cam.scale;
        cam.y = wy + (my - H / 2) / cam.scale;
    }

    function resetView() {
        cam.x = 0; cam.y = 0;
        cam.scale = (Math.min(W, H) / 2) / 2.3;   // inner system out to ~2.3 AU
        following = false;
    }

    // =====================================================================
    // object helpers
    // =====================================================================
    function bodyColor(b) {
        if (b.kind === 'planet') return b.color;
        if (D.isComet(b)) return COLORS.comet;
        if (b.pha) return COLORS.pha;
        if (b.neo) return COLORS.neo;
        return COLORS.ast;
    }

    function bodyTag(b) {
        if (b.kind === 'planet') return 'PLANET';
        if (D.isComet(b)) return 'COMET';
        if (b.pha) return 'PHA';
        if (b.neo) return 'NEO';
        return 'AST';
    }

    function computePos(b, jd) {
        return b.kind === 'planet' ? O.planetPos(b.ref, jd) : O.smallBodyPos(b, jd);
    }

    function orbitPathFor(b, jd) {
        if (!b._path) {
            const el = b.kind === 'planet' ? O.planetElements(b.ref, jd) : O.smallBodyElements(b, jd);
            b._path = O.orbitPath(el, b.kind === 'planet' ? 360 : 256);
        }
        return b._path;
    }

    // =====================================================================
    // rendering
    // =====================================================================
    function drawRings() {
        ctx.strokeStyle = 'rgba(110,231,255,0.05)';
        ctx.fillStyle = 'rgba(160,200,230,0.25)';
        ctx.font = '10px "Space Grotesk", sans-serif';
        ctx.lineWidth = 1;
        const c = toScreen({ x: 0, y: 0 });
        for (const r of RING_RADII) {
            const pr = r * cam.scale;
            if (pr < 28 || pr > Math.max(W, H) * 1.6) continue;
            ctx.beginPath();
            ctx.arc(c.x, c.y, pr, 0, 7);
            ctx.stroke();
            ctx.fillText(r + ' AU', c.x + pr * 0.7071 + 4, c.y - pr * 0.7071 - 4);
        }
    }

    function drawOrbit(b, jd, color, alpha, width) {
        const path = orbitPathFor(b, jd);
        ctx.beginPath();
        for (let k = 0; k < path.length; k++) {
            const s = toScreen(path[k]);
            if (k === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = width;
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    function drawSun() {
        const s = toScreen({ x: 0, y: 0 });
        const r = Math.max(7, Math.min(26, cam.scale * 0.02 + 6));
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 7);
        g.addColorStop(0, 'rgba(255,244,200,1)');
        g.addColorStop(0.04, 'rgba(255,220,130,0.95)');
        g.addColorStop(0.12, 'rgba(255,170,60,0.35)');
        g.addColorStop(0.4, 'rgba(255,140,40,0.07)');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 7, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#fff7df';
        ctx.beginPath();
        ctx.arc(s.x, s.y, r * 0.45, 0, 7);
        ctx.fill();
    }

    function render() {
        const jd = simJd();
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#04060e';
        ctx.fillRect(0, 0, W, H);
        if (starCanvas) ctx.drawImage(starCanvas, 0, 0);

        drawRings();

        // planet orbits
        for (const p of planets) drawOrbit(p, jd, p.color, 0.28, 1);

        // selected / hovered small-body orbit
        if (selected && selected.kind !== 'planet') drawOrbit(selected, jd, bodyColor(selected), 0.9, 1.6);
        if (hovered && hovered !== selected && hovered.kind !== 'planet') drawOrbit(hovered, jd, bodyColor(hovered), 0.45, 1);
        if (selected && selected.kind === 'planet') drawOrbit(selected, jd, selected.color, 0.9, 1.8);

        drawSun();

        // small bodies
        for (const b of bodies) {
            b._pos = computePos(b, jd);
            const s = toScreen(b._pos);
            b._sx = s.x; b._sy = s.y;
            if (s.x < -20 || s.x > W + 20 || s.y < -20 || s.y > H + 20) continue;
            const r = (b === selected || b === hovered) ? 3.2 : 1.9;
            const spr = dotSprite(bodyColor(b), r);
            ctx.drawImage(spr, s.x - spr.width / 2, s.y - spr.height / 2);
        }

        // planets on top
        ctx.font = '600 11px "Space Grotesk", sans-serif';
        for (const p of planets) {
            p._pos = computePos(p, jd);
            const s = toScreen(p._pos);
            p._sx = s.x; p._sy = s.y;
            if (s.x < -40 || s.x > W + 40 || s.y < -40 || s.y > H + 40) continue;
            const spr = dotSprite(p.color, p.ref.size);
            ctx.drawImage(spr, s.x - spr.width / 2, s.y - spr.height / 2);
            ctx.fillStyle = 'rgba(220,232,255,0.75)';
            ctx.fillText(p.name, s.x + p.ref.size + 5, s.y + 3);
        }

        // selection marker
        if (selected) {
            const pulse = 6 + Math.sin(performance.now() / 300) * 1.5;
            ctx.strokeStyle = COLORS.accent;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(selected._sx, selected._sy, pulse + 4, 0, 7);
            ctx.stroke();
            if (selected.kind !== 'planet') {
                ctx.fillStyle = COLORS.accent;
                ctx.font = '600 11px "Space Grotesk", sans-serif';
                ctx.fillText(selected.name, selected._sx + 12, selected._sy - 10);
            }
        }
    }

    // =====================================================================
    // picking / tooltip
    // =====================================================================
    function pick(mx, my) {
        let best = null, bestD = 12;
        const consider = (b, bonus) => {
            if (b._sx === undefined) return;
            const d = Math.hypot(b._sx - mx, b._sy - my) - bonus;
            if (d < bestD) { bestD = d; best = b; }
        };
        for (const b of bodies) consider(b, 0);
        for (const p of planets) consider(p, 4);
        return best;
    }

    function showTooltip(b, mx, my) {
        if (!b) { elTooltip.style.display = 'none'; return; }
        const r = Math.hypot(b._pos.x, b._pos.y, b._pos.z);
        elTooltip.innerHTML = `<b>${b.name}</b><span>${bodyTag(b)} · ${r.toFixed(2)} AU from Sun</span>`;
        elTooltip.style.display = 'block';
        elTooltip.style.left = Math.min(mx + 14, W - 180) + 'px';
        elTooltip.style.top = (my + 14) + 'px';
    }

    // =====================================================================
    // selection / info panel
    // =====================================================================
    function select(b, center) {
        selected = b;
        following = !!b && center !== false;
        document.querySelectorAll('#object-list li').forEach(li => {
            li.classList.toggle('selected', !!b && li.dataset.key === b._key);
        });
        renderInfo();
    }

    function nextApproachFor(b) {
        if (!b || b.kind === 'planet') return null;
        return cadRows.find(r => (b.id && r.id === b.id) || r.des === b.pdes || r.des === b.name) || null;
    }

    function fmtKm(au) {
        const km = au * AU_KM;
        return km >= 1e7 ? (km / 1e6).toFixed(1) + ' M km' : Math.round(km).toLocaleString() + ' km';
    }

    function renderInfo() {
        if (!selected) {
            elInfo.innerHTML = '<p class="info-hint">Click any object on the map<br>or in the list to inspect its trajectory.</p>';
            return;
        }
        const b = selected;
        const jd = simJd();
        const pos = b._pos || computePos(b, jd);
        const r = Math.hypot(pos.x, pos.y, pos.z);
        const earth = planets[2]._pos || computePos(planets[2], jd);
        const dE = Math.hypot(pos.x - earth.x, pos.y - earth.y, pos.z - earth.z);
        const a = b.kind === 'planet' ? O.planetElements(b.ref, jd).a : b.a;
        const e = b.kind === 'planet' ? O.planetElements(b.ref, jd).e : b.e;
        const inc = b.kind === 'planet' ? O.planetElements(b.ref, jd).i * 180 / Math.PI : b.i;
        const perY = Math.pow(a, 1.5);
        const v = O.speedKms(r, a);
        const ca = nextApproachFor(b);
        const tag = bodyTag(b);

        let rows = `
            <div class="irow"><span>Distance from Sun</span><b>${r.toFixed(3)} AU <i>${fmtKm(r)}</i></b></div>
            ${b.name !== 'Earth' ? `<div class="irow"><span>Distance from Earth</span><b>${dE.toFixed(3)} AU <i>${(dE * AU_LD).toFixed(1)} LD</i></b></div>` : ''}
            <div class="irow"><span>Orbital speed</span><b>${v.toFixed(2)} km/s</b></div>
            <div class="irow"><span>Semi-major axis</span><b>${a.toFixed(3)} AU</b></div>
            <div class="irow"><span>Eccentricity</span><b>${e.toFixed(3)}</b></div>
            <div class="irow"><span>Inclination</span><b>${inc.toFixed(2)}°</b></div>
            <div class="irow"><span>Orbital period</span><b>${perY < 2 ? (perY * 365.25).toFixed(0) + ' days' : perY.toFixed(1) + ' yr'}</b></div>`;
        if (b.H != null) rows += `<div class="irow"><span>Abs. magnitude H</span><b>${b.H}</b></div>`;
        if (b.diameter) rows += `<div class="irow"><span>Diameter</span><b>${b.diameter.toFixed(2)} km</b></div>`;
        if (ca) rows += `<div class="irow warn"><span>Next close approach</span><b>${ca.cd} UTC<i>${(ca.distAu * AU_LD).toFixed(2)} LD at ${ca.vRel.toFixed(1)} km/s</i></b></div>`;

        const link = b.kind === 'planet' ? '' :
            `<a class="jpl-link" target="_blank" rel="noopener" href="https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(b.pdes || b.name)}">View in JPL Small-Body DB ↗</a>`;

        elInfo.innerHTML = `
            <div class="info-head">
                <h2 style="color:${bodyColor(b)}">${b.name}</h2>
                <div class="chips">
                    <span class="chip" style="border-color:${bodyColor(b)};color:${bodyColor(b)}">${tag}</span>
                    ${b.cls ? `<span class="chip">${b.cls}</span>` : ''}
                    ${b.approx ? '<span class="chip warn-chip">approx. offline data</span>' : ''}
                </div>
            </div>
            ${rows}
            <div class="info-actions">
                <button id="btn-follow" class="${following ? 'on' : ''}">${following ? '◉ Following' : '○ Follow'}</button>
                <button id="btn-deselect">✕ Clear</button>
            </div>
            ${link}`;

        document.getElementById('btn-follow').onclick = () => { following = !following; renderInfo(); };
        document.getElementById('btn-deselect').onclick = () => select(null);
    }

    // =====================================================================
    // object list (left panel)
    // =====================================================================
    let filterMode = 'all';

    function matchesFilter(b) {
        switch (filterMode) {
            case 'planet': return b.kind === 'planet';
            case 'neo': return b.kind !== 'planet' && b.neo;
            case 'pha': return b.kind !== 'planet' && b.pha;
            case 'comet': return b.kind !== 'planet' && D.isComet(b);
            default: return true;
        }
    }

    function buildList() {
        const all = planets.concat(bodies);
        elList.innerHTML = '';
        const frag = document.createDocumentFragment();
        for (const b of all) {
            const li = document.createElement('li');
            li.dataset.key = b._key;
            li.innerHTML = `<i class="dot" style="background:${bodyColor(b)}"></i><span class="oname">${b.name}</span><span class="otag">${bodyTag(b)}</span>`;
            li.onclick = () => {
                select(b);
                if (b.kind !== 'planet' && cam.scale < 90) cam.scale = 160;
                document.body.classList.remove('show-left');
            };
            b._li = li;
            frag.appendChild(li);
        }
        elList.appendChild(frag);
        elCount.textContent = all.length;
        applyListFilter();
    }

    function applyListFilter() {
        const q = elSearch.value.trim().toLowerCase();
        let shown = 0;
        for (const b of planets.concat(bodies)) {
            const ok = matchesFilter(b) && (!q || b.name.toLowerCase().includes(q) || (b.full || '').toLowerCase().includes(q));
            b._li.style.display = ok ? '' : 'none';
            if (ok) shown++;
        }
        elCount.textContent = shown;
    }

    // =====================================================================
    // close approaches (right panel)
    // =====================================================================
    function renderCad() {
        if (!cadRows.length) {
            elCad.innerHTML = '<li class="cad-loading">No close approaches in window (or feed unavailable).</li>';
            return;
        }
        elCad.innerHTML = '';
        for (const r of cadRows.slice(0, 25)) {
            const li = document.createElement('li');
            const ld = r.distLd !== null ? r.distLd.toFixed(2) : (r.distAu * AU_LD).toFixed(2);
            const label = r.name || r.des;
            li.innerHTML = `<b>${r.pha ? '⚠ ' : ''}${label}</b><span>${(r.cd || '').replace(' ', ' · ')} UTC</span><span class="cad-dist">${ld} LD · ${r.vRel ? r.vRel.toFixed(1) : '?'} km/s</span>`;
            li.onclick = async () => {
                let b = bodies.find(x => x.id === r.id || x.pdes === r.des || x.name === r.des);
                if (!b) {
                    toast('Fetching orbit for ' + label + '…');
                    const rec = await D.fetchBodyById(r.id).catch(() => null);
                    if (rec) {
                        b = registerBody(rec);
                        buildList();
                        toast('Loaded ' + b.name);
                    } else {
                        toast('Could not load orbit for ' + label);
                        return;
                    }
                }
                select(b);
                if (cam.scale < 90) cam.scale = 160;
            };
            elCad.appendChild(li);
        }
    }

    // =====================================================================
    // misc UI
    // =====================================================================
    let toastTimer = null;
    function toast(msg, ms) {
        elToast.textContent = msg;
        elToast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => elToast.classList.remove('show'), ms || 3500);
    }

    // =====================================================================
    // input
    // =====================================================================
    function bindInput() {
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0014));
        }, { passive: false });

        canvas.addEventListener('pointerdown', (e) => {
            canvas.setPointerCapture(e.pointerId);
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            mouse.down = true;
            mouse.dragged = false;
            mouse.sx = e.clientX;
            mouse.sy = e.clientY;
            if (pointers.size === 2) {
                const pts = [...pointers.values()];
                pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            }
        });

        canvas.addEventListener('pointermove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
            const p = pointers.get(e.pointerId);
            if (p) {
                const dx = e.clientX - p.x, dy = e.clientY - p.y;
                p.x = e.clientX; p.y = e.clientY;
                if (pointers.size === 1) {
                    if (Math.hypot(e.clientX - mouse.sx, e.clientY - mouse.sy) > 5) mouse.dragged = true;
                    if (mouse.dragged) {
                        cam.x -= dx / cam.scale;
                        cam.y += dy / cam.scale;
                        following = false;
                    }
                } else if (pointers.size === 2) {
                    const pts = [...pointers.values()];
                    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                    if (pinchDist > 0) zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinchDist);
                    pinchDist = d;
                    mouse.dragged = true;
                }
            } else {
                hovered = pick(e.clientX, e.clientY);
                canvas.style.cursor = hovered ? 'pointer' : 'grab';
                showTooltip(hovered, e.clientX, e.clientY);
            }
        });

        const endPointer = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinchDist = 0;
            if (pointers.size === 0) {
                mouse.down = false;
                if (!mouse.dragged) {
                    const hit = pick(e.clientX, e.clientY);
                    select(hit, false);
                }
            }
        };
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('pointerleave', () => { hovered = null; showTooltip(null); });

        // time controls
        document.querySelectorAll('.tc-btn[data-rate]').forEach(btn => {
            btn.onclick = () => setRate(btn.dataset.rate);
        });
        document.getElementById('btn-now').onclick = () => setRate('live');

        // view controls
        document.getElementById('zoom-in').onclick = () => zoomAt(W / 2, H / 2, 1.45);
        document.getElementById('zoom-out').onclick = () => zoomAt(W / 2, H / 2, 1 / 1.45);
        document.getElementById('zoom-reset').onclick = resetView;

        // search + filters
        elSearch.addEventListener('input', applyListFilter);
        document.querySelectorAll('.ftab').forEach(t => {
            t.onclick = () => {
                document.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                filterMode = t.dataset.filter;
                applyListFilter();
            };
        });

        // mobile toggles
        document.getElementById('mt-left').onclick = () => {
            document.body.classList.toggle('show-left');
            document.body.classList.remove('show-right');
        };
        document.getElementById('mt-right').onclick = () => {
            document.body.classList.toggle('show-right');
            document.body.classList.remove('show-left');
        };

        window.addEventListener('resize', resize);
    }

    // =====================================================================
    // data loading
    // =====================================================================
    function registerBody(rec) {
        rec.kind = 'small';
        rec._key = 'sb-' + (rec.pdes || rec.name);
        bodies.push(rec);
        return rec;
    }

    async function loadData() {
        try {
            const res = await D.fetchSmallBodies();
            bodies = [];
            res.bodies.forEach(registerBody);
            buildList();
            toast(res.live
                ? `Loaded ${bodies.length} near-Earth objects live from NASA ✓`
                : 'NASA API unreachable — showing built-in sample objects', 5000);
        } catch (err) {
            console.error('SBDB load failed', err);
            toast('Could not load asteroid data — check connection');
        }
        refreshCad();
        // re-pull the close-approach feed every 10 minutes to stay live
        setInterval(refreshCad, 10 * 60 * 1000);
    }

    async function refreshCad() {
        try {
            cadRows = await D.fetchCloseApproaches();
            renderCad();
        } catch (err) {
            console.error('CAD load failed', err);
        }
    }

    // =====================================================================
    // main loop
    // =====================================================================
    let infoTick = 0;
    function frame(now) {
        const dt = Math.min(100, now - lastFrame);
        lastFrame = now;
        tickTime(dt);
        if (following && selected && selected._pos) {
            cam.x = selected._pos.x;
            cam.y = selected._pos.y;
        }
        render();
        updateClock();
        infoTick += dt;
        if (infoTick > 400) {           // refresh live numbers in info panel ~2.5×/s
            infoTick = 0;
            if (selected) renderInfo();
        }
        requestAnimationFrame(frame);
    }

    // =====================================================================
    // boot
    // =====================================================================
    planets = O.PLANETS.map(p => ({
        kind: 'planet', name: p.name, color: p.color, ref: p,
        neo: false, pha: false, cls: '', _key: 'pl-' + p.name
    }));

    resize();
    resetView();
    bindInput();
    buildList();
    loadData();
    requestAnimationFrame(frame);

    // debug handle (also handy from the console: __orrery.cam.scale etc.)
    window.__orrery = { cam: cam, time: time, select: select, get bodies() { return bodies; }, get selected() { return selected; } };
})();

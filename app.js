/* =========================================================================
   APP — 3D rendering (Three.js), camera, time control and UI for the orrery
   Coordinates: heliocentric ecliptic (x, y, z) AU from orbits.js, mapped to
   three.js y-up space as (x, z, -y). 1 world unit = 1 AU.
   ========================================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const O = window.ORBITS;
const D = window.DATA;

// ---------- DOM ----------
const canvas = document.getElementById('space');
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
const AU_LD = 389.17;
const COLORS = { neo: '#ffb347', pha: '#ff5d6c', comet: '#7ee8fa', ast: '#c8a76a', accent: '#6ee7ff' };
const RING_RADII = [1, 2, 5, 10, 20, 30];
// exaggerated display radii (world units = AU); real planets would be invisible
const PLANET_RADII = { Mercury: 0.006, Venus: 0.009, Earth: 0.0095, Mars: 0.006, Jupiter: 0.016, Saturn: 0.013, Uranus: 0.011, Neptune: 0.011, Pluto: 0.004 };

// ---------- state ----------
const time = { mode: 'live', rate: 0, simMs: Date.now() };
let planets = [];
let moons = [];
let bodies = [];
let pointBodies = [];                 // asteroids currently shown in the point cloud
let cadRows = [];
let selected = null, hovered = null, following = false;
let filterMode = 'all';
let W = window.innerWidth, H = window.innerHeight;
// category visibility (legend toggles)
const vis = { planet: true, moon: true, ast: true, pha: true, comet: true, grid: true };

// =====================================================================
// three.js scene
// =====================================================================
// degrade gracefully when WebGL is software-emulated (no GPU)
const LOW_POWER = (function () {
    try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
        return /swiftshader|llvmpipe|software|basic render/i.test(r);
    } catch (e) { return false; }
})();

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: !LOW_POWER });
renderer.setPixelRatio(LOW_POWER ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(W, H);
renderer.setClearColor(0x04060e);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, W / H, 0.005, 6000);
camera.position.set(0, 3.0, 4.6);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(W, H);
labelRenderer.domElement.id = 'labels';
document.body.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.9;
controls.minDistance = 0.05;
controls.maxDistance = 400;

scene.add(new THREE.AmbientLight(0xffffff, 0.18));
const sunLight = new THREE.PointLight(0xfff2d0, 2.6, 0, 0);
scene.add(sunLight);

const ev = (p, out) => (out || new THREE.Vector3()).set(p.x, p.z, -p.y);

// ---------- canvas-generated textures ----------
function glowTexture(inner, mid) {
    const s = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.22, mid);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    return new THREE.CanvasTexture(cv);
}

function ringTexture() {
    const s = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d');
    c.strokeStyle = COLORS.accent;
    c.lineWidth = 5;
    c.beginPath();
    c.arc(s / 2, s / 2, s / 2 - 6, 0, 7);
    c.stroke();
    return new THREE.CanvasTexture(cv);
}

function spriteOf(tex, color, depthTest) {
    const m = new THREE.SpriteMaterial({
        map: tex, color: color || 0xffffff, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: depthTest !== false
    });
    return new THREE.Sprite(m);
}

const texSoftGlow = glowTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0.45)');
const texRing = ringTexture();

// ---------- starfield ----------
(function makeStars() {
    const mul = LOW_POWER ? 0.3 : 1;
    for (const [count, size, opacity] of [[2600 * mul | 0, 1.4, 0.85], [1400 * mul | 0, 2.4, 0.5]]) {
        const pos = new Float32Array(count * 3);
        for (let k = 0; k < count; k++) {
            const v = new THREE.Vector3().randomDirection().multiplyScalar(1800 + Math.random() * 1200);
            pos.set([v.x, v.y, v.z], k * 3);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const m = new THREE.PointsMaterial({
            color: 0xcdd8ff, size: size, sizeAttenuation: false,
            transparent: true, opacity: opacity, depthWrite: false
        });
        scene.add(new THREE.Points(g, m));
    }
})();

// ---------- AU reference rings ----------
const gridObjects = [];
(function makeAuRings() {
    for (const r of RING_RADII) {
        const pts = [];
        for (let k = 0; k <= 128; k++) {
            const a = (k / 128) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
        }
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(pts),
            new THREE.LineBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.055 })
        );
        scene.add(line);
        gridObjects.push(line);

        const div = document.createElement('div');
        div.className = 'ring-label';
        div.textContent = r + ' AU';
        const lbl = new CSS2DObject(div);
        lbl.position.set(r * 0.7071, 0, -r * 0.7071);
        scene.add(lbl);
        gridObjects.push(lbl);
    }
})();

// ---------- sun ----------
const sunGlow = spriteOf(glowTexture('rgba(255,246,214,1)', 'rgba(255,176,64,0.55)'), 0xffffff, false);
scene.add(sunGlow);
const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xfff6df })
);
scene.add(sunCore);

// ---------- planets ----------
const jdBoot = O.jdFromMs(Date.now());
planets = O.PLANETS.map(p => {
    const radius = PLANET_RADII[p.name] || 0.01;
    const group = new THREE.Group();

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, LOW_POWER ? 16 : 32, LOW_POWER ? 10 : 20),
        new THREE.MeshLambertMaterial({ color: p.color })
    );
    group.add(mesh);

    if (p.name === 'Saturn') {
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(radius * 1.4, radius * 2.3, 48),
            new THREE.MeshBasicMaterial({ color: 0xd9c08a, side: THREE.DoubleSide, transparent: true, opacity: 0.45 })
        );
        ring.rotation.x = -Math.PI / 2 + 0.47;
        group.add(ring);
    }

    const glow = spriteOf(texSoftGlow, p.color, false);
    group.add(glow);

    const div = document.createElement('div');
    div.className = 'obj-label';
    div.textContent = p.name;
    const label = new CSS2DObject(div);
    label.position.set(0, radius * 2.2, 0);
    group.add(label);

    scene.add(group);

    // orbit line (shape is effectively constant on human timescales)
    const path = O.orbitPath(O.planetElements(p, jdBoot), 360).map(q => ev(q));
    const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(path),
        new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.30 })
    );
    scene.add(line);

    return {
        kind: 'planet', name: p.name, color: p.color, ref: p,
        neo: false, pha: false, cls: '', _key: 'pl-' + p.name,
        group: group, glow: glow, radius: radius, orbitLine: line,
        sysGroup: null, sysOuter: 0, moonScale: 1
    };
});

// ---------- moons ----------
// Real moon orbits would sit inside the exaggerated planet spheres, so each
// system's orbit *distances* are scaled up by a shared factor (ratios between
// a planet's moons are preserved). Real values are shown in the info panel.
moons = O.MOONS.map(m => {
    const par = planets.find(p => p.name === m.parent);
    if (!par.sysGroup) {
        const innermost = Math.min(...O.MOONS.filter(x => x.parent === m.parent).map(x => x.a));
        par.moonScale = Math.max(1, (par.radius * 2.0) / innermost);
        par.sysGroup = new THREE.Group();
        par.group.add(par.sysGroup);
    }
    const F = par.moonScale;
    const radius = par.radius * m.size;

    const moonGroup = new THREE.Group();
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 16, 10),
        new THREE.MeshLambertMaterial({ color: m.color })
    );
    moonGroup.add(mesh);
    const glow = spriteOf(texSoftGlow, m.color, false);
    moonGroup.add(glow);

    const div = document.createElement('div');
    div.className = 'obj-label moon-label';
    div.textContent = m.name;
    const label = new CSS2DObject(div);
    label.position.set(0, radius * 2.2, 0);
    moonGroup.add(label);
    par.sysGroup.add(moonGroup);

    // orbit ring around the parent (display-scaled)
    const path = O.orbitPath(O.smallBodyElements(m, jdBoot), 128)
        .map(q => ev({ x: q.x * F, y: q.y * F, z: q.z * F }));
    const ring = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(path),
        new THREE.LineBasicMaterial({ color: m.color, transparent: true, opacity: 0.35 })
    );
    par.sysGroup.add(ring);

    const rec = {
        kind: 'moon', name: m.name, color: m.color, ref: m, parentRec: par,
        neo: false, pha: false, cls: '', _key: 'mo-' + m.name,
        group: moonGroup, glow: glow, radius: radius
    };
    par.sysOuter = Math.max(par.sysOuter, m.a * F * 1.1);
    return rec;
});

// ---------- asteroid point cloud ----------
let astPoints = null;

function rebuildAsteroids() {
    if (astPoints) {
        scene.remove(astPoints);
        astPoints.geometry.dispose();
        astPoints.material.dispose();
    }
    pointBodies = bodies.filter(b => vis[catOf(b)]);
    const n = pointBodies.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const colors = new Float32Array(n * 3);
    const c = new THREE.Color();
    pointBodies.forEach((b, k) => {
        c.set(bodyColor(b));
        colors.set([c.r, c.g, c.b], k * 3);
    });
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    astPoints = new THREE.Points(g, new THREE.PointsMaterial({
        size: 4.5, sizeAttenuation: false, vertexColors: true,
        transparent: true, opacity: 0.95, depthWrite: false
    }));
    scene.add(astPoints);
}

// ---------- selection / hover visuals ----------
const marker = spriteOf(texRing, COLORS.accent, false);
marker.visible = false;
scene.add(marker);

const hoverGlow = spriteOf(texSoftGlow, 0xffffff, false);
hoverGlow.visible = false;
scene.add(hoverGlow);

const selLabelDiv = document.createElement('div');
selLabelDiv.className = 'obj-label sel-label';
const selLabel = new CSS2DObject(selLabelDiv);
selLabel.visible = false;
scene.add(selLabel);

let selOrbitLine = null, hovOrbitLine = null;

function orbitLine(b, opacity, width) {
    const el = O.smallBodyElements(b, simJd());
    const pts = O.orbitPath(el, 256).map(q => ev(q));
    return new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: bodyColor(b), transparent: true, opacity: opacity })
    );
}

function disposeLine(l) {
    if (!l) return;
    scene.remove(l);
    l.geometry.dispose();
    l.material.dispose();
}

function setSelOrbit(b) {
    disposeLine(selOrbitLine);
    selOrbitLine = null;
    if (b && b.kind === 'small') {
        selOrbitLine = orbitLine(b, 0.9);
        scene.add(selOrbitLine);
    }
}

function setHovOrbit(b) {
    disposeLine(hovOrbitLine);
    hovOrbitLine = null;
    if (b && b !== selected && b.kind === 'small') {
        hovOrbitLine = orbitLine(b, 0.4);
        scene.add(hovOrbitLine);
    }
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
        time.rate = parseFloat(val);
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
// object helpers
// =====================================================================
function bodyColor(b) {
    if (b.kind === 'planet' || b.kind === 'moon') return b.color;
    if (D.isComet(b)) return COLORS.comet;
    if (b.pha) return COLORS.pha;
    if (b.neo) return COLORS.neo;
    return COLORS.ast;
}

function bodyTag(b) {
    if (b.kind === 'planet') return 'PLANET';
    if (b.kind === 'moon') return 'MOON';
    if (D.isComet(b)) return 'COMET';
    if (b.pha) return 'PHA';
    if (b.neo) return 'NEO';
    return 'AST';
}

// legend-toggle category of a body
function catOf(b) {
    if (b.kind === 'planet') return 'planet';
    if (b.kind === 'moon') return 'moon';
    if (D.isComet(b)) return 'comet';
    if (b.pha) return 'pha';
    return 'ast';
}

function computePos(b, jd) {
    return b.kind === 'planet' ? O.planetPos(b.ref, jd) : O.smallBodyPos(b, jd);
}

// =====================================================================
// picking (screen-space, like the 2D version — robust and cheap)
// =====================================================================
const _v = new THREE.Vector3();

function screenPos(b) {
    const p = b._disp || b._pos;                     // _disp = display position (moons)
    if (!p) return null;
    ev(p, _v).project(camera);
    if (_v.z > 1) return null;                       // behind camera
    return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H };
}

function pick(mx, my) {
    let best = null, bestD = 13;
    const consider = (b, bonus) => {
        const s = screenPos(b);
        if (!s) return;
        const d = Math.hypot(s.x - mx, s.y - my) - bonus;
        if (d < bestD) { bestD = d; best = b; }
    };
    for (const b of pointBodies) consider(b, 0);
    if (vis.moon) for (const m of moons) { if (m._shown) consider(m, 2); }
    if (vis.planet) for (const p of planets) consider(p, 5);
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
    setSelOrbit(b);
    marker.visible = !!b;
    selLabel.visible = !!b && b.kind === 'small';
    if (b && b.kind === 'small') selLabelDiv.textContent = b.name;
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
        elInfo.innerHTML = '<p class="info-hint">Click any object on the map<br>or in the list to inspect its trajectory.<br><br>Drag to orbit the camera · scroll to zoom.</p>';
        return;
    }
    const b = selected;
    const jd = simJd();
    const pos = b._pos || computePos(b, jd);
    const r = Math.hypot(pos.x, pos.y, pos.z);
    const earth = planets[2]._pos || computePos(planets[2], jd);
    const dE = Math.hypot(pos.x - earth.x, pos.y - earth.y, pos.z - earth.z);

    if (b.kind === 'moon') {
        const m = b.ref;
        const aKm = m.a * AU_KM;
        const vKms = 2 * Math.PI * aKm / (m.per * 86400);
        elInfo.innerHTML = `
            <div class="info-head">
                <h2 style="color:${b.color}">${b.name}</h2>
                <div class="chips">
                    <span class="chip" style="border-color:${b.color};color:${b.color}">MOON</span>
                    <span class="chip">of ${m.parent}</span>
                </div>
            </div>
            <div class="irow"><span>Orbits ${m.parent} at</span><b>${Math.round(aKm).toLocaleString()} km</b></div>
            <div class="irow"><span>Orbital period</span><b>${m.per < 2 ? (m.per * 24).toFixed(1) + ' h' : m.per.toFixed(2) + ' days'}</b></div>
            <div class="irow"><span>Orbital speed</span><b>${vKms.toFixed(2)} km/s</b></div>
            <div class="irow"><span>Eccentricity</span><b>${m.e.toFixed(4)}</b></div>
            <div class="irow"><span>Inclination (ecliptic)</span><b>${m.i.toFixed(1)}°${m.i > 90 ? ' <i>retrograde</i>' : ''}</b></div>
            <div class="irow"><span>Distance from Sun</span><b>${r.toFixed(3)} AU</b></div>
            ${m.parent !== 'Earth' ? `<div class="irow"><span>Distance from Earth</span><b>${dE.toFixed(3)} AU</b></div>` : ''}
            <div class="irow"><span>Display note</span><b><i>orbit distance shown ×${Math.round(b.parentRec.moonScale)} for visibility</i></b></div>
            <div class="info-actions">
                <button id="btn-follow" class="${following ? 'on' : ''}">${following ? '◉ Following' : '○ Follow'}</button>
                <button id="btn-deselect">✕ Clear</button>
            </div>`;
        document.getElementById('btn-follow').onclick = () => { following = !following; renderInfo(); };
        document.getElementById('btn-deselect').onclick = () => select(null);
        return;
    }

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
    if (b.diameter) rows += `<div class="irow"><span>Est. diameter</span><b>${b.diameter.toFixed(2)} km</b></div>`;
    if (ca) rows += `<div class="irow warn"><span>Next close approach</span><b>${ca.cd} UTC<i>${ca.distLd !== null ? ca.distLd.toFixed(2) : (ca.distAu * AU_LD).toFixed(2)} LD at ${ca.vRel ? ca.vRel.toFixed(1) : '?'} km/s</i></b></div>`;

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
function matchesFilter(b) {
    switch (filterMode) {
        case 'planet': return b.kind === 'planet';
        case 'moon': return b.kind === 'moon';
        case 'neo': return b.kind === 'small' && b.neo;
        case 'pha': return b.kind === 'small' && b.pha;
        case 'comet': return b.kind === 'small' && D.isComet(b);
        default: return true;
    }
}

function buildList() {
    const all = planets.concat(moons, bodies);
    elList.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const b of all) {
        const li = document.createElement('li');
        li.dataset.key = b._key;
        li.innerHTML = `<i class="dot" style="background:${bodyColor(b)}"></i><span class="oname">${b.name}</span><span class="otag">${bodyTag(b)}</span>`;
        li.onclick = () => {
            select(b);
            // moons are tiny: jump the camera into their system
            if (b.kind === 'moon') {
                const jd = simJd();
                b.parentRec._pos = computePos(b.parentRec, jd);
                const t = ev(b.parentRec._pos, new THREE.Vector3());
                const dir = camera.position.clone().sub(controls.target).normalize();
                controls.target.copy(t);
                camera.position.copy(t).add(dir.multiplyScalar(Math.max(b.parentRec.sysOuter * 3.2, 0.03)));
            }
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
    for (const b of planets.concat(moons, bodies)) {
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
                    rebuildAsteroids();
                    buildList();
                    toast('Loaded ' + b.name);
                } else {
                    toast('Could not load orbit for ' + label);
                    return;
                }
            }
            const cat = catOf(b);
            if (!vis[cat]) {
                vis[cat] = true;
                const btn = document.querySelector(`.leg-toggle[data-cat="${cat}"]`);
                if (btn) btn.classList.remove('off');
                rebuildAsteroids();
            }
            select(b);
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
function dolly(f) {
    const t = controls.target;
    const d = camera.position.clone().sub(t);
    const len = THREE.MathUtils.clamp(d.length() * f, controls.minDistance, controls.maxDistance);
    camera.position.copy(t).add(d.setLength(len));
}

function resetView() {
    following = false;
    controls.target.set(0, 0, 0);
    camera.position.set(0, 3.0, 4.6);
}

function bindInput() {
    let downX = 0, downY = 0;

    canvas.addEventListener('pointerdown', (e) => {
        downX = e.clientX;
        downY = e.clientY;
    });

    canvas.addEventListener('pointerup', (e) => {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
            select(pick(e.clientX, e.clientY), false);
        }
    });

    canvas.addEventListener('pointermove', (e) => {
        if (e.buttons) { hovered = null; setHovOrbit(null); showTooltip(null); return; }
        hovered = pick(e.clientX, e.clientY);
        setHovOrbit(hovered);
        canvas.style.cursor = hovered ? 'pointer' : 'grab';
        showTooltip(hovered, e.clientX, e.clientY);
    });

    canvas.addEventListener('pointerleave', () => {
        hovered = null;
        setHovOrbit(null);
        showTooltip(null);
    });

    // user rotating/zooming breaks follow
    controls.addEventListener('start', () => { /* keep following on rotate; only pan breaks it */ });

    document.querySelectorAll('.tc-btn[data-rate]').forEach(btn => {
        btn.onclick = () => setRate(btn.dataset.rate);
    });
    document.getElementById('btn-now').onclick = () => setRate('live');

    document.getElementById('zoom-in').onclick = () => dolly(0.62);
    document.getElementById('zoom-out').onclick = () => dolly(1.6);
    document.getElementById('zoom-reset').onclick = resetView;

    // legend category toggles
    document.querySelectorAll('.leg-toggle').forEach(btn => {
        btn.onclick = () => {
            const cat = btn.dataset.cat;
            vis[cat] = !vis[cat];
            btn.classList.toggle('off', !vis[cat]);
            if (cat === 'grid') {
                gridObjects.forEach(o => { o.visible = vis.grid; });
            } else if (cat === 'planet') {
                planets.forEach(p => {
                    p.group.visible = vis.planet;
                    p.orbitLine.visible = vis.planet;
                });
            } else if (cat === 'moon') {
                // applied per-frame via the proximity rule
            } else {
                rebuildAsteroids();
            }
            if (selected && !vis[catOf(selected)]) select(null);
            if (selected && selected.kind === 'moon' && !vis.planet) select(null);
            if (hovered && !vis[catOf(hovered)]) { hovered = null; setHovOrbit(null); showTooltip(null); }
        };
    });

    elSearch.addEventListener('input', applyListFilter);
    document.querySelectorAll('.ftab').forEach(t => {
        t.onclick = () => {
            document.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
            t.classList.add('active');
            filterMode = t.dataset.filter;
            applyListFilter();
        };
    });

    document.getElementById('mt-left').onclick = () => {
        document.body.classList.toggle('show-left');
        document.body.classList.remove('show-right');
    };
    document.getElementById('mt-right').onclick = () => {
        document.body.classList.toggle('show-right');
        document.body.classList.remove('show-left');
    };

    window.addEventListener('resize', () => {
        W = window.innerWidth;
        H = window.innerHeight;
        camera.aspect = W / H;
        camera.updateProjectionMatrix();
        renderer.setSize(W, H);
        labelRenderer.setSize(W, H);
    });
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
        rebuildAsteroids();
        buildList();
        toast(res.live
            ? `Loaded ${bodies.length} near-Earth objects live from NASA ✓`
            : 'NASA API unreachable — showing built-in sample objects', 5000);
        // shareable links: orrery/#sel=Apophis selects an object on load
        const m = location.hash.match(/^#sel=(.+)$/);
        if (m) {
            const want = decodeURIComponent(m[1]).toLowerCase();
            const hit = planets.concat(moons, bodies).find(b => b.name.toLowerCase() === want);
            if (hit) {
                if (hit._li) hit._li.click();        // moons also get the camera jump
                else select(hit);
            }
        }
    } catch (err) {
        console.error('NEO load failed', err);
        toast('Could not load asteroid data — check connection');
    }
    refreshCad();
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
let lastFrame = performance.now();
let infoTick = 0;
const _w = new THREE.Vector3();

function frame(now) {
    requestAnimationFrame(frame);
    step(now);
}

function step(now) {
    const dt = Math.min(100, now - lastFrame);
    lastFrame = now;
    tickTime(dt);

    const jd = simJd();
    const camDist = camera.position.distanceTo(controls.target);

    // sun glow keeps a constant-ish screen size
    sunGlow.scale.setScalar(Math.max(0.18, camDist * 0.13));
    sunCore.scale.setScalar(Math.max(1, camDist * 0.55));

    // planets
    for (const p of planets) {
        p._pos = computePos(p, jd);
        ev(p._pos, p.group.position);
        const d = camera.position.distanceTo(p.group.position);
        p.glow.scale.setScalar(Math.max(p.radius * 3.5, d * 0.018));
    }

    // moons (positions relative to parent; orbit distances display-scaled)
    for (const p of planets) {
        if (!p.sysGroup) continue;
        const dPar = camera.position.distanceTo(p.group.position);
        const inSystem = selected && selected.kind === 'moon' && selected.parentRec === p;
        p.sysGroup.visible = vis.moon && vis.planet && (dPar < p.sysOuter * 22 || inSystem);
    }
    for (const m of moons) {
        const par = m.parentRec;
        const off = O.smallBodyPos(m.ref, jd);          // real offset in AU
        const F = par.moonScale;
        m._pos = { x: par._pos.x + off.x, y: par._pos.y + off.y, z: par._pos.z + off.z };
        m._disp = { x: par._pos.x + off.x * F, y: par._pos.y + off.y * F, z: par._pos.z + off.z * F };
        m._shown = par.sysGroup.visible;
        if (m._shown) {
            m.group.position.set(off.x * F, off.z * F, -off.y * F);
            const d = camera.position.distanceTo(m.group.getWorldPosition(_w));
            m.glow.scale.setScalar(Math.max(m.radius * 2.5, d * 0.006));
        }
    }

    // asteroids
    if (astPoints) {
        const arr = astPoints.geometry.attributes.position.array;
        for (let k = 0; k < pointBodies.length; k++) {
            const b = pointBodies[k];
            b._pos = computePos(b, jd);
            arr[k * 3] = b._pos.x;
            arr[k * 3 + 1] = b._pos.z;
            arr[k * 3 + 2] = -b._pos.y;
        }
        astPoints.geometry.attributes.position.needsUpdate = true;
        astPoints.geometry.computeBoundingSphere();
    }

    // selection visuals
    if (selected && (selected._disp || selected._pos)) {
        ev(selected._disp || selected._pos, _w);
        marker.position.copy(_w);
        const pulse = 1 + 0.18 * Math.sin(now / 280);
        marker.scale.setScalar(Math.max(0.012, camDist * 0.028) * pulse);
        selLabel.position.copy(_w).add(new THREE.Vector3(0, camDist * 0.022, 0));
        if (following) {
            const delta = _w.clone().sub(controls.target);
            controls.target.copy(_w);
            camera.position.add(delta);
        }
    }

    if (hovered && (hovered._disp || hovered._pos) && hovered !== selected) {
        ev(hovered._disp || hovered._pos, hoverGlow.position);
        hoverGlow.material.color.set(bodyColor(hovered));
        hoverGlow.scale.setScalar(camDist * 0.02);
        hoverGlow.visible = true;
    } else {
        hoverGlow.visible = false;
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    updateClock();

    infoTick += dt;
    if (infoTick > 400) {
        infoTick = 0;
        if (selected) renderInfo();
    }
}

// =====================================================================
// boot
// =====================================================================
bindInput();
buildList();
loadData();
renderInfo();
requestAnimationFrame(frame);

// debug handle
window.__orrery = {
    camera: camera, controls: controls, time: time, select: select,
    renderer: renderer, scene: scene, step: step, vis: vis, moons: moons,
    get bodies() { return bodies; }, get selected() { return selected; }
};

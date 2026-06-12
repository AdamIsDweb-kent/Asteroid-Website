/* =========================================================================
   DATA — live asteroid data from NASA NeoWs (api.nasa.gov, CORS-enabled)

   DEMO_KEY is heavily rate-limited (~30 req/hour shared per IP).
   Get a free personal key (1000 req/hour) at https://api.nasa.gov and
   paste it below. Responses are cached in localStorage to stay frugal:
   orbits for 24 h, the close-approach feed for 20 min.
   ========================================================================= */
window.DATA = (function () {
    'use strict';

    const API_KEY = 'gmkscqdwKxOhtZwF8ElzxyXJ5SPWiYt5qhVdyUCO';
    const NEOWS = 'https://api.nasa.gov/neo/rest/v1';
    const BROWSE_PAGES = 4;                    // 4 pages × 20 objects
    const ORBIT_CACHE_MS = 24 * 3600 * 1000;
    const FEED_CACHE_MS = 20 * 60 * 1000;

    const COMET_CLASSES = { HTC: 1, JFC: 1, JFc: 1, COM: 1, CTc: 1, ETc: 1, PAR: 1, HYP: 1 };

    /* Famous objects always included, and used alone if the API is
       unreachable. Osculating elements from JPL SBDB (solution epochs as
       listed; fetched 2026-06-12). */
    const FALLBACK = [
        { pdes: '1',      name: 'Ceres',    a: 2.7655526, e: 0.0796923, i: 10.58803, om: 80.24863, w: 73.29421, ma: 274.41935, epoch: 2461200.5, per: 1679.8531, H: 3.34, neo: false, pha: false, cls: 'MBA' },
        { pdes: '2',      name: 'Pallas',   a: 2.7695590, e: 0.2307001, i: 34.93279, om: 172.88662, w: 310.96992, ma: 254.24965, epoch: 2461200.5, per: 1683.5048, H: 4.12, neo: false, pha: false, cls: 'MBA' },
        { pdes: '4',      name: 'Vesta',    a: 2.3613660, e: 0.0902037, i: 7.14393, om: 103.70129, w: 151.46865, ma: 81.19016, epoch: 2461200.5, per: 1325.3890, H: 3.25, neo: false, pha: false, cls: 'MBA' },
        { pdes: '433',    name: 'Eros',     a: 1.4582437, e: 0.2228780, i: 10.82854, om: 304.26797, w: 178.91813, ma: 62.51146, epoch: 2461200.5, per: 643.1964, H: 10.40, neo: true, pha: false, cls: 'AMO' },
        { pdes: '1566',   name: 'Icarus',   a: 1.0779942, e: 0.8270189, i: 22.80164, om: 87.94856, w: 31.44439, ma: 329.18266, epoch: 2461200.5, per: 408.8115, H: 16.53, neo: true, pha: true, cls: 'APO' },
        { pdes: '3200',   name: 'Phaethon', a: 1.2714646, e: 0.8896723, i: 22.31053, om: 265.09881, w: 322.30017, ma: 301.48582, epoch: 2461200.5, per: 523.6666, H: 14.38, neo: true, pha: true, cls: 'APO' },
        { pdes: '25143',  name: 'Itokawa',  a: 1.3240523, e: 0.2801776, i: 1.62094, om: 69.07450, w: 162.84090, ma: 170.65391, epoch: 2461200.5, per: 556.4884, H: 19.26, neo: true, pha: false, cls: 'APO' },
        { pdes: '99942',  name: 'Apophis',  a: 0.9223592, e: 0.1911492, i: 3.34100, om: 203.89365, w: 126.67957, ma: 175.33040, epoch: 2461200.5, per: 323.5553, H: 19.09, neo: true, pha: true, cls: 'ATE' },
        { pdes: '101955', name: 'Bennu',    a: 1.1263910, e: 0.2037451, i: 6.03494, om: 2.06087, w: 66.22306, ma: 101.70395, epoch: 2455562.5, per: 436.6487, H: 20.21, neo: true, pha: true, cls: 'APO' },
        { pdes: '162173', name: 'Ryugu',    a: 1.1909189, e: 0.1910730, i: 5.86644, om: 251.28971, w: 211.60899, ma: 62.34067, epoch: 2461200.5, per: 474.7027, H: 19.55, neo: true, pha: true, cls: 'APO' },
        { pdes: '1P',     name: 'Halley',   a: 17.9286350, e: 0.9679360, i: 162.19053, om: 59.09895, w: 112.24143, ma: 274.38234, epoch: 2439875.5, per: 27728.0461, H: null, neo: true, pha: false, cls: 'HTC' }
    ];

    // ---------- tiny localStorage cache ----------
    function cacheGet(key, maxAgeMs) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (Date.now() - obj.ts > maxAgeMs) return null;
            return obj.v;
        } catch (e) { return null; }
    }

    function cacheSet(key, v) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), v: v })); } catch (e) { /* full / private mode */ }
    }

    async function getJSON(url, timeoutMs) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
        try {
            const res = await fetch(url, { signal: ctrl.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return await res.json();
        } finally {
            clearTimeout(t);
        }
    }

    function num(v) {
        const n = parseFloat(v);
        return isNaN(n) ? null : n;
    }

    // NeoWs near_earth_object -> internal body record
    function parseNeo(o) {
        const od = o.orbital_data;
        if (!od) return null;
        const dk = o.estimated_diameter && o.estimated_diameter.kilometers;
        const b = {
            id: o.id,
            full: o.name || '',
            pdes: (o.designation || '').trim(),
            name: (o.name_limited || o.name || o.designation || '').trim(),
            neo: true,
            pha: !!o.is_potentially_hazardous_asteroid,
            H: num(o.absolute_magnitude_h),
            diameter: dk ? (num(dk.estimated_diameter_min) + num(dk.estimated_diameter_max)) / 2 : null,
            epoch: num(od.epoch_osculation),
            e: num(od.eccentricity),
            a: num(od.semi_major_axis),
            i: num(od.inclination),
            om: num(od.ascending_node_longitude),
            w: num(od.perihelion_argument),
            ma: num(od.mean_anomaly),
            per: num(od.orbital_period),
            cls: od.orbit_class ? (od.orbit_class.orbit_class_type || '') : ''
        };
        // keep only well-behaved elliptical orbits we can propagate
        if (b.a && b.e !== null && b.e >= 0 && b.e < 0.985 && b.a > 0 && b.a < 80 &&
            b.epoch && b.ma !== null && b.i !== null && b.om !== null && b.w !== null) {
            return b;
        }
        return null;
    }

    async function fetchSmallBodies() {
        let list = cacheGet('orrery-neos-v1', ORBIT_CACHE_MS);
        let live = true;

        if (!list) {
            const pages = [];
            for (let p = 0; p < BROWSE_PAGES; p++) {
                pages.push(getJSON(`${NEOWS}/neo/browse?page=${p}&size=20&api_key=${API_KEY}`));
            }
            const results = await Promise.allSettled(pages);
            list = [];
            for (const r of results) {
                if (r.status !== 'fulfilled' || !r.value.near_earth_objects) continue;
                for (const o of r.value.near_earth_objects) {
                    const b = parseNeo(o);
                    if (b) list.push(b);
                }
            }
            live = list.length > 0;
            if (live) cacheSet('orrery-neos-v1', list);
        }

        // merge famous set (Apophis, Bennu, Ceres … always searchable)
        const seen = {};
        list.forEach(b => { seen[b.pdes || b.name] = true; });
        FALLBACK.forEach(f => {
            if (!seen[f.pdes]) list.push(Object.assign({ full: f.pdes + ' ' + f.name, diameter: null, approx: !live }, f));
        });

        return { bodies: list, live: live };
    }

    /* Close approaches to Earth over the next 7 days (NeoWs feed limit) */
    async function fetchCloseApproaches() {
        let rows = cacheGet('orrery-cad-v1', FEED_CACHE_MS);
        if (rows) return rows;

        const d0 = new Date();
        const d1 = new Date(Date.now() + 7 * 86400000);
        const iso = d => d.toISOString().slice(0, 10);
        const json = await getJSON(`${NEOWS}/feed?start_date=${iso(d0)}&end_date=${iso(d1)}&api_key=${API_KEY}`);
        if (!json || !json.near_earth_objects) return [];

        rows = [];
        for (const date of Object.keys(json.near_earth_objects)) {
            for (const o of json.near_earth_objects[date]) {
                const ca = o.close_approach_data && o.close_approach_data[0];
                if (!ca) continue;
                rows.push({
                    id: o.id,
                    des: (o.designation || o.name || '').trim(),
                    name: (o.name_limited || o.name || '').trim(),
                    cd: ca.close_approach_date_full || date,
                    epochMs: num(ca.epoch_date_close_approach),
                    distAu: num(ca.miss_distance && ca.miss_distance.astronomical),
                    distLd: num(ca.miss_distance && ca.miss_distance.lunar),
                    vRel: num(ca.relative_velocity && ca.relative_velocity.kilometers_per_second),
                    h: num(o.absolute_magnitude_h),
                    pha: !!o.is_potentially_hazardous_asteroid
                });
            }
        }
        rows.sort((x, y) => (x.epochMs || 0) - (y.epochMs || 0));
        // prefer genuinely close passes; fall back to the closest of the week
        const close = rows.filter(r => r.distAu !== null && r.distAu <= 0.05);
        rows = close.length ? close : rows.slice().sort((x, y) => x.distAu - y.distAu).slice(0, 12);
        cacheSet('orrery-cad-v1', rows);
        return rows;
    }

    /* Lazy-load full orbital elements for one asteroid by NeoWs id */
    async function fetchBodyById(id) {
        const json = await getJSON(`${NEOWS}/neo/${encodeURIComponent(id)}?api_key=${API_KEY}`);
        return json ? parseNeo(json) : null;
    }

    function isComet(b) {
        return !!COMET_CLASSES[b.cls] || /^\d+P\b|^[CP]\//.test(b.pdes || '');
    }

    return {
        fetchSmallBodies: fetchSmallBodies,
        fetchCloseApproaches: fetchCloseApproaches,
        fetchBodyById: fetchBodyById,
        isComet: isComet
    };
})();

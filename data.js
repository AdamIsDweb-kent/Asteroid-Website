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
       unreachable (elements approximate — labelled in the UI). */
    const FALLBACK = [
        { pdes: '1',      name: 'Ceres',    a: 2.767, e: 0.0789, i: 10.587, om: 80.3,  w: 73.6,  ma: 95,  epoch: 2461000.5, per: 1682,  H: 3.34, neo: false, pha: false, cls: 'MBA' },
        { pdes: '2',      name: 'Pallas',   a: 2.770, e: 0.2300, i: 34.93,  om: 172.9, w: 310.9, ma: 40,  epoch: 2461000.5, per: 1686,  H: 4.12, neo: false, pha: false, cls: 'MBA' },
        { pdes: '4',      name: 'Vesta',    a: 2.362, e: 0.0894, i: 7.142,  om: 103.8, w: 151.2, ma: 200, epoch: 2461000.5, per: 1325,  H: 3.20, neo: false, pha: false, cls: 'MBA' },
        { pdes: '433',    name: 'Eros',     a: 1.458, e: 0.2227, i: 10.83,  om: 304.3, w: 178.9, ma: 130, epoch: 2461000.5, per: 643,   H: 10.4, neo: true,  pha: false, cls: 'AMO' },
        { pdes: '1566',   name: 'Icarus',   a: 1.078, e: 0.8270, i: 22.80,  om: 87.95, w: 31.4,  ma: 60,  epoch: 2461000.5, per: 409,   H: 16.3, neo: true,  pha: true,  cls: 'APO' },
        { pdes: '3200',   name: 'Phaethon', a: 1.271, e: 0.8900, i: 22.26,  om: 265.2, w: 322.2, ma: 0,   epoch: 2461000.5, per: 524,   H: 14.3, neo: true,  pha: true,  cls: 'APO' },
        { pdes: '25143',  name: 'Itokawa',  a: 1.324, e: 0.2800, i: 1.62,   om: 69.1,  w: 162.8, ma: 300, epoch: 2461000.5, per: 556,   H: 19.2, neo: true,  pha: false, cls: 'APO' },
        { pdes: '99942',  name: 'Apophis',  a: 0.9224, e: 0.1914, i: 3.34,  om: 203.9, w: 126.7, ma: 280, epoch: 2461000.5, per: 323.6, H: 19.7, neo: true,  pha: true,  cls: 'ATE' },
        { pdes: '101955', name: 'Bennu',    a: 1.1264, e: 0.2037, i: 6.035, om: 2.06,  w: 66.2,  ma: 100, epoch: 2461000.5, per: 436.6, H: 20.2, neo: true,  pha: true,  cls: 'APO' },
        { pdes: '162173', name: 'Ryugu',    a: 1.1896, e: 0.1903, i: 5.88,  om: 251.6, w: 211.4, ma: 30,  epoch: 2461000.5, per: 474,   H: 19.2, neo: true,  pha: true,  cls: 'APO' },
        { pdes: '1P',     name: 'Halley',   a: 17.93,  e: 0.967,  i: 162.19, om: 59.07, w: 112.26, ma: 190, epoch: 2461000.5, per: 27510, H: null, neo: true, pha: false, cls: 'HTC' }
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

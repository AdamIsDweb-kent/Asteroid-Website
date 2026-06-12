/* =========================================================================
   ORBITS — Keplerian orbital mechanics
   Planet elements: JPL "Keplerian Elements for Approximate Positions of
   the Major Planets" (valid 1800–2050). Angles in degrees, a in AU,
   rates per Julian century. Heliocentric ecliptic J2000 frame.
   ========================================================================= */
window.ORBITS = (function () {
    'use strict';

    const J2000 = 2451545.0;
    const DEG = Math.PI / 180;
    const GAUSS_N = 0.9856076686;        // deg/day for a=1 AU (mean motion)

    //               a        aDot       e         eDot       I          IDot        L            LDot            varpi       varpiDot    Omega       OmegaDot
    const PLANETS = [
        { name: 'Mercury', color: '#b8b5ad', size: 3.0, el: [0.38709927, 0.00000037, 0.20563593, 0.00001906, 7.00497902, -0.00594749, 252.25032350, 149472.67411175, 77.45779628, 0.16047689, 48.33076593, -0.12534081] },
        { name: 'Venus',   color: '#e8c468', size: 4.5, el: [0.72333566, 0.00000390, 0.00677672, -0.00004107, 3.39467605, -0.00078890, 181.97909950, 58517.81538729, 131.60246718, 0.00268329, 76.67984255, -0.27769418] },
        { name: 'Earth',   color: '#4f9cf9', size: 4.8, el: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668, 100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0] },
        { name: 'Mars',    color: '#e0653a', size: 3.8, el: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131, -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343] },
        { name: 'Jupiter', color: '#d8a36c', size: 8.5, el: [5.20288700, -0.00011607, 0.04838624, -0.00013253, 1.30439695, -0.00183714, 34.39644051, 3034.74612775, 14.72847983, 0.21252668, 100.47390909, 0.20469106] },
        { name: 'Saturn',  color: '#e3c97a', size: 7.5, el: [9.53667594, -0.00125060, 0.05386179, -0.00050991, 2.48599187, 0.00193609, 49.95424423, 1222.49362201, 92.59887831, -0.41897216, 113.66242448, -0.28867794] },
        { name: 'Uranus',  color: '#8fd8d8', size: 6.0, el: [19.18916464, -0.00196176, 0.04725744, -0.00004397, 0.77263783, -0.00242939, 313.23810451, 428.48202785, 170.95427630, 0.40805281, 74.01692503, 0.04240589] },
        { name: 'Neptune', color: '#5a78e8', size: 6.0, el: [30.06992276, 0.00026291, 0.00859048, 0.00005105, 1.77004347, 0.00035372, -55.12002969, 218.45945325, 44.96476227, -0.32241464, 131.78422574, -0.00508664] },
        { name: 'Pluto',   color: '#c9b29b', size: 2.6, el: [39.48211675, -0.00031596, 0.24882730, 0.00005170, 17.14001206, 0.00004818, 238.92903833, 145.20780515, 224.06891629, -0.04062942, 110.30393684, -0.01183482] }
    ];

    function jdFromMs(ms) {
        return ms / 86400000 + 2440587.5;
    }

    function norm360(d) {
        d = d % 360;
        return d < 0 ? d + 360 : d;
    }

    // Solve Kepler's equation M = E - e·sinE (radians) by Newton-Raphson
    function solveKepler(M, e) {
        M = M % (2 * Math.PI);
        if (M > Math.PI) M -= 2 * Math.PI;
        if (M < -Math.PI) M += 2 * Math.PI;
        let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
        for (let k = 0; k < 30; k++) {
            const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
            E -= dE;
            if (Math.abs(dE) < 1e-9) break;
        }
        return E;
    }

    // Eccentric anomaly -> heliocentric ecliptic position. Angles in radians.
    function posFromE(a, e, i, om, w, E) {
        const xp = a * (Math.cos(E) - e);
        const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
        const cw = Math.cos(w), sw = Math.sin(w);
        const co = Math.cos(om), so = Math.sin(om);
        const ci = Math.cos(i), si = Math.sin(i);
        return {
            x: (cw * co - sw * so * ci) * xp + (-sw * co - cw * so * ci) * yp,
            y: (cw * so + sw * co * ci) * xp + (-sw * so + cw * co * ci) * yp,
            z: (sw * si) * xp + (cw * si) * yp
        };
    }

    function posFromElements(el) {           // el angles in radians, M = mean anomaly
        const E = solveKepler(el.M, el.e);
        return posFromE(el.a, el.e, el.i, el.om, el.w, E);
    }

    // Planet osculating elements at a given Julian date (angles -> radians)
    function planetElements(p, jd) {
        const T = (jd - J2000) / 36525;
        const e = p.el;
        const a = e[0] + e[1] * T;
        const ec = e[2] + e[3] * T;
        const i = e[4] + e[5] * T;
        const L = e[6] + e[7] * T;
        const vp = e[8] + e[9] * T;          // longitude of perihelion
        const om = e[10] + e[11] * T;        // longitude of ascending node
        return {
            a: a, e: ec,
            i: i * DEG, om: om * DEG, w: (vp - om) * DEG,
            M: norm360(L - vp) * DEG
        };
    }

    function planetPos(p, jd) {
        return posFromElements(planetElements(p, jd));
    }

    /* Small body record (from SBDB or fallback):
       { a, e, i, om, w, ma (deg @ epoch), epoch (JD), per (days, optional) } */
    function smallBodyElements(b, jd) {
        const n = b.per ? 360 / b.per : GAUSS_N / Math.pow(b.a, 1.5);   // deg/day
        return {
            a: b.a, e: b.e,
            i: b.i * DEG, om: b.om * DEG, w: b.w * DEG,
            M: norm360(b.ma + n * (jd - b.epoch)) * DEG
        };
    }

    function smallBodyPos(b, jd) {
        return posFromElements(smallBodyElements(b, jd));
    }

    // Full orbit ellipse sampled in eccentric anomaly (uniform E is fine for drawing)
    function orbitPath(el, steps) {
        steps = steps || 256;
        const pts = new Array(steps + 1);
        for (let k = 0; k <= steps; k++) {
            pts[k] = posFromE(el.a, el.e, el.i, el.om, el.w, (k / steps) * 2 * Math.PI);
        }
        return pts;
    }

    // Orbital speed from vis-viva, km/s (r and a in AU)
    function speedKms(r, a) {
        const v2 = 2 / r - 1 / a;
        return v2 > 0 ? 29.7847 * Math.sqrt(v2) : 0;
    }

    return {
        J2000: J2000,
        PLANETS: PLANETS,
        jdFromMs: jdFromMs,
        planetElements: planetElements,
        planetPos: planetPos,
        smallBodyElements: smallBodyElements,
        smallBodyPos: smallBodyPos,
        orbitPath: orbitPath,
        speedKms: speedKms
    };
})();

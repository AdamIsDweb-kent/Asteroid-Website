# ORRERY — Live Solar System & Asteroid Tracker

A single-page, real-time **3D** map of the solar system (Three.js via CDN, no build step).

## Features
- **Full 3D scene**: orbit the camera around the Sun (drag), zoom (scroll/pinch), lit planet spheres with Saturn's ring, glow sprites, starfield, 3D orbit trajectories. Falls back to reduced quality on machines without GPU acceleration.
- **Planets Mercury → Pluto** positioned in real time from JPL Keplerian elements (valid 1800–2050), no API needed.
- **~400 near-Earth asteroids & comets** loaded live from the [NASA JPL Small-Body Database](https://ssd-api.jpl.nasa.gov/) (no API key required) and propagated client-side with a Kepler solver.
- **Live close-approach feed** from the CNEOS CAD API (objects passing within 0.05 AU of Earth in the next 45 days), refreshed every 10 minutes. Clicking a row lazy-loads that object's orbit.
- **Click any object** to see its full trajectory, distance from Sun/Earth, speed, orbital elements and next close approach.
- **Time machine**: pause, rewind/fast-forward (±1 day/s, ±1 week/s), jump back to LIVE.
- Follow-camera, search, filters (planets / NEOs / PHAs / comets).
- Shareable links: append `#sel=Apophis` (any object name) to auto-select on load.
- Works offline with a built-in sample set of famous objects (Ceres, Vesta, Apophis, Bennu, Halley…).

## Run
Any static file server works (ES modules require http://, not file://):

```
npx serve -l 3344 .
# or: python -m http.server 3344
```

Then open http://localhost:3344.

## Files
- `index.html` — page shell, UI panels, Three.js import map
- `styles.css` — space theme + 3D label overlay
- `orbits.js` — Keplerian orbital mechanics + JPL planet elements
- `data.js` — NASA NeoWs API client, localStorage caching, offline fallback data
- `app.js` — Three.js scene, camera, picking, time controls, UI wiring

Data credit: NASA/JPL-Caltech — SSD/CNEOS APIs.

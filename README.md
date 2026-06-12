# ORRERY — Live Solar System & Asteroid Tracker

A zero-dependency, single-page live map of the solar system.

## Features
- **Planets Mercury → Pluto** positioned in real time from JPL Keplerian elements (valid 1800–2050), no API needed.
- **~400 near-Earth asteroids & comets** loaded live from the [NASA JPL Small-Body Database](https://ssd-api.jpl.nasa.gov/) (no API key required) and propagated client-side with a Kepler solver.
- **Live close-approach feed** from the CNEOS CAD API (objects passing within 0.05 AU of Earth in the next 45 days), refreshed every 10 minutes. Clicking a row lazy-loads that object's orbit.
- **Click any object** to see its full trajectory, distance from Sun/Earth, speed, orbital elements and next close approach.
- **Time machine**: pause, rewind/fast-forward (±1 day/s, ±1 week/s), jump back to LIVE.
- Zoom (wheel/pinch), pan (drag), follow-camera, search, filters (planets / NEOs / PHAs / comets).
- Works offline with a built-in sample set of famous objects (Ceres, Vesta, Apophis, Bennu, Halley…).

## Run
Any static file server works:

```
npx serve -l 3344 .
```

Then open http://localhost:3344. (Opening `index.html` directly also works in most browsers.)

## Files
- `index.html` — page shell and UI panels
- `styles.css` — space theme
- `orbits.js` — Keplerian orbital mechanics + JPL planet elements
- `data.js` — JPL SBDB / CNEOS API client + offline fallback data
- `app.js` — canvas renderer, camera, time controls, UI wiring

Data credit: NASA/JPL-Caltech — SSD/CNEOS APIs.

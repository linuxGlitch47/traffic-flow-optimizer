# 🚦 Traffic Flow Optimizer
**HCL JIGSAW 7.0 — AI Revolution & Digital Futures**

An interactive AI traffic-signal optimizer for a customizable 4-way junction. It proves quantitatively how an **AI Adaptive** controller beats a **Fixed-Timer** signal. Plain HTML/CSS/JS — no build step, no dependencies.

## Live demo (GitHub Pages)
1. Push this repo to GitHub (default branch `main`).
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main` (or run the workflow from the **Actions** tab). When `Deploy Traffic Flow Optimizer to GitHub Pages` finishes, your URL is shown in the job summary and under Settings → Pages:
   `https://<your-username>.github.io/<repo-name>/`

Deep links: `#blueprint`, `#live`, `#results`.

## Views
| Tab | What it shows |
|---|---|
| **1 · Intersection Blueprint** | Top-down junction: lane geometry, inductive loops, camera queue zones, signal heads, crosswalks, editable road names |
| **2 · Live Simulation** | Canvas animation (vehicles spawn, queue, accelerate on green) + per-lane telemetry, AI scores, phase countdown, ambulance trigger |
| **3 · Results & A/B Benchmark** | 60-second head-to-head run, comparison cards, metrics table, bar charts, % improvement |

Edit the **city, junction name and road names** (or pick a preset) at the top — every view and report updates.

## Controllers
- **Fixed-Timer:** 25 s green per approach, 3 s amber, 1.5 s all-red, regardless of demand.
- **AI Adaptive:** per approach `score = queueLength × 2.0 + maxWaitSeconds × 0.6 + arrivalRate × 4.0`.
  - Next green goes to the highest score among approaches with waiting vehicles.
  - Green length = `8 + 0.4 × score`, clamped to **8 s – 45 s**; green ends early (after 8 s) when the lane empties.
  - **Starvation guard:** any approach waiting > 60 s is served next.
  - **Emergency override:** the ambulance's approach gets green immediately (after a short amber) and holds until the ambulance has crossed. Fixed-Timer has no override, so you can compare.

## Scenarios (arrivals, veh/min N/E/S/W)
Balanced `6/6/6/6` · Morning Rush `12/3/11/3` · Market Bottleneck `3/14/3/4` · Custom sliders (0–20 each).

## Benchmark method
Both controllers replay **identical, seeded random arrivals** for 60 simulated seconds, each starting with a pre-built queue (≈ 0.6 min of demand per approach). Metrics:
- **Average wait** — mean seconds each vehicle spent stopped/crawling (<12 px/s) before the stop line, including vehicles still waiting at 60 s.
- **Throughput** — vehicles that crossed the stop line.
- **Max queue** — largest waiting count on any approach.
- **Idling fuel** — stopped vehicle-seconds × 0.8 L/h (assumed idle burn rate).
- **% improvement** — relative to Fixed-Timer (higher throughput / lower everything else = positive).

> Note: a full fixed cycle is ~118 s, so a 60 s window only lets Fixed-Timer serve two approaches. Throughput gains in this short window are therefore larger than a steady-state comparison would show; the wait/queue/fuel gains are the more conservative figures.

## Local run
Open `index.html` in a browser, or `python3 -m http.server` and visit http://localhost:8000.

## Files
`index.html` · `styles.css` · `app.js` · `.github/workflows/deploy-pages.yml` · `README.md`

'use strict';
/* Traffic Flow Optimizer — simulation core + UI. No dependencies, no build step. */
const NAMES = ['North', 'East', 'South', 'West'];
const H = [[0, 1], [-1, 0], [0, -1], [1, 0]];           // travel direction of each approach (canvas coords)
const TH = H.map(h => Math.atan2(h[1], h[0]));
const CX = 350, CY = 350, SIZE = 700, HALF = 44, STOP = 60, L = 290;
const CFG = { min: 8, max: 45, yellow: 3, allred: 1.5, fixed: 25, vmax: 80, acc: 90, dec: 160, len: 18, gap: 6, T: 1.0, idleLph: 0.8, starve: 60, k: 0.4 };
const SCEN = {
  balanced: { label: 'Balanced Flow', rates: [6, 6, 6, 6] },
  rush: { label: 'Morning Office Rush — North/South Heavy', rates: [12, 3, 11, 3] },
  market: { label: 'Market Bottleneck — East Heavy', rates: [3, 14, 3, 4] },
  custom: { label: 'Custom Arrival Sliders', rates: [8, 8, 8, 8] }
};
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function rng(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pos(a, s, lat) { const h = H[a], x = s - STOP; return [CX + h[0] * x - h[1] * lat, CY + h[1] * x + h[0] * lat]; }

/* ---------------------------- simulation core ---------------------------- */
class Sim {
  constructor(mode, rates, seed, preload = true) {
    this.mode = mode; this.rates = rates.slice(); this.seed = seed; this.t = 0; this.nid = 0;
    this.rg = [0, 1, 2, 3].map(i => rng(seed * 9973 + i * 7919 + 1));
    this.lanes = [[], [], [], []]; this.pend = [[], [], [], []]; this.log = [[], [], [], []];
    this.next = [0, 1, 2, 3].map(i => this.gap(i));
    this.cleared = 0; this.waitDone = 0; this.maxQ = 0; this.idle = 0; this.emerg = null; this.hold = 0; this.amb = null;
    if (preload) for (let a = 0; a < 4; a++) { const n = Math.round(this.rates[a] * 0.6); for (let k = 0; k < n; k++) this.lanes[a].push(this.mk(-3 - k * (CFG.len + CFG.gap), 0, false)); }
    this.cur = 0; this.pt = 0;
    if (mode === 'fixed') { this.state = 'green'; this.dur = CFG.fixed; } else { this.state = 'allred'; this.dur = 0.5; }
  }
  gap(i) { const r = this.rates[i]; return r <= 0 ? Infinity : -Math.log(1 - this.rg[i]()) * 60 / r; }
  setRates(r) { this.rates = r.slice(); for (let i = 0; i < 4; i++) this.next[i] = this.t + this.gap(i); }
  mk(s, v, amb) { return { id: this.nid++, s, v, len: amb ? 22 : CFG.len, wait: 0, amb, crossed: false }; }
  /* sensor-style metrics */
  waiting(a) { return this.pend[a].filter(p => !p.amb).concat(this.lanes[a].filter(v => !v.amb && v.s < 0 && v.v < 12)); }
  queue(a) { return this.waiting(a).length; }
  maxWait(a) { return this.waiting(a).reduce((m, v) => Math.max(m, v.wait), 0); }
  rate(a) { const w = clamp(this.t, 10, 60), n = this.log[a].filter(x => x > this.t - w).length; return n * 60 / w; }
  score(a) { return this.queue(a) * 2.0 + this.maxWait(a) * 0.6 + this.rate(a) * 4.0; }
  trigger(a) {
    if (this.amb && !this.amb.done) return false;
    this.pend[a].push({ arr: this.t, wait: 0, amb: true });
    this.amb = { a, t0: this.t, done: false, time: null };
    if (this.mode === 'ai') this.emerg = a;
    return true;
  }
  demand(a) { return this.pend[a].some(p => !p.amb) || this.lanes[a].some(v => !v.amb && v.s < 0 && (v.s > -140 || v.v < 8)); }
  hasAmb(a) { return this.pend[a].some(p => p.amb) || this.lanes[a].some(v => v.amb && !v.crossed); }
  pick() {
    let best = -1, bw = CFG.starve;
    for (let i = 0; i < 4; i++) { const w = this.maxWait(i); if (w > bw && this.queue(i) > 0) { bw = w; best = i; } }   // starvation guard
    if (best < 0) { let bs = 0; for (let i = 0; i < 4; i++) { const s = this.score(i); if (this.queue(i) > 0 && s > bs) { bs = s; best = i; } } }
    return best < 0 ? (this.cur + 1) % 4 : best;
  }
  aiDur(a) { return clamp(CFG.min + this.score(a) * CFG.k, CFG.min, CFG.max); }
  control(dt) {
    this.pt += dt;
    const ai = this.mode === 'ai';
    if (ai && this.emerg !== null) return this.emergControl();
    if (this.state === 'green') {
      let end = this.pt >= this.dur;
      if (ai && this.pt >= CFG.min && !this.demand(this.cur)) end = true;       // gap-out: lane empty, release early
      if (end) { this.state = 'yellow'; this.pt = 0; }
    } else if (this.state === 'yellow') {
      if (this.pt >= CFG.yellow) { this.state = 'allred'; this.pt = 0; this.dur = CFG.allred; }
    } else if (this.pt >= this.dur) {
      this.cur = ai ? this.pick() : (this.cur + 1) % 4;
      this.state = 'green'; this.pt = 0; this.dur = ai ? this.aiDur(this.cur) : CFG.fixed;
    }
  }
  emergControl() {
    const a = this.emerg;
    if (this.cur !== a) {
      if (this.state === 'green') { this.state = 'yellow'; this.pt = 0; }
      else if (this.state === 'yellow') { if (this.pt >= 2) { this.state = 'allred'; this.pt = 0; this.dur = CFG.allred; } }
      else if (this.pt >= CFG.allred) { this.cur = a; this.state = 'green'; this.pt = 0; this.dur = 999; }
    } else if (this.state !== 'green') { this.state = 'green'; this.pt = 0; this.dur = 999; }
    else if (!this.hasAmb(a)) { this.hold += 1 / 30; if (this.hold >= 2) { this.emerg = null; this.hold = 0; this.dur = this.pt; } }
  }
  step(dt) {
    this.t += dt;
    for (let a = 0; a < 4; a++) {
      while (this.t >= this.next[a]) { this.pend[a].push({ arr: this.next[a], wait: 0, amb: false }); this.log[a].push(this.next[a]); this.next[a] += this.gap(a); }
      const lane = this.lanes[a], q = this.pend[a];
      while (q.length) {
        const last = lane[lane.length - 1];
        if (last && last.s - last.len - CFG.gap < -L) break;
        const p = q.shift(), v = this.mk(-L, last ? Math.min(CFG.vmax, last.v) : CFG.vmax, p.amb); v.wait = p.wait; lane.push(v);
      }
      q.forEach(p => { if (!p.amb) p.wait += dt; });
    }
    this.control(dt);
    this.move(dt);
    for (let a = 0; a < 4; a++) {
      this.maxQ = Math.max(this.maxQ, this.queue(a));
      this.idle += dt * (this.pend[a].filter(p => !p.amb).length + this.lanes[a].filter(v => !v.amb && v.s < 0 && v.v < 3).length);
    }
  }
  move(dt) {
    for (let a = 0; a < 4; a++) {
      const lane = this.lanes[a], g = a === this.cur ? this.state : 'red';
      for (let i = 0; i < lane.length; i++) {
        const v = lane[i], ld = i ? lane[i - 1] : null;
        let vt = CFG.vmax * (v.amb ? 1.2 : 1), stop = false;
        if (ld) { const d = Math.max(0, ld.s - ld.len - CFG.gap - v.s); vt = Math.min(vt, Math.sqrt(2 * CFG.dec * d), d / CFG.T); }
        if (v.s < 0) {
          const d = Math.max(0, -v.s - 1), brake = v.v * v.v / (2 * CFG.dec);
          stop = g !== 'green' && !(g === 'yellow' && brake > d - 1);
          if (stop) vt = Math.min(vt, Math.sqrt(2 * CFG.dec * d));
        }
        v.v = vt > v.v ? Math.min(vt, v.v + CFG.acc * dt) : Math.max(vt, v.v - CFG.dec * dt);
        v.s += v.v * dt;
        if (stop && v.s > -1) { v.s = -1; v.v = 0; }
        if (ld && v.s > ld.s - ld.len - 2) { v.s = ld.s - ld.len - 2; v.v = Math.min(v.v, ld.v); }
        if (!v.amb && v.s < 0 && v.v < 12) v.wait += dt;
        if (!v.crossed && v.s >= 0) {
          v.crossed = true;
          if (v.amb) { this.amb.done = true; this.amb.time = this.t - this.amb.t0; } else { this.cleared++; this.waitDone += v.wait; }
        }
      }
      this.lanes[a] = lane.filter(v => v.s <= 410);
    }
  }
  report() {
    let sum = this.waitDone, n = this.cleared;
    for (let a = 0; a < 4; a++) {
      this.lanes[a].forEach(v => { if (!v.amb && !v.crossed) { sum += v.wait; n++; } });
      this.pend[a].forEach(p => { if (!p.amb) { sum += p.wait; n++; } });
    }
    return { avgWait: n ? sum / n : 0, cleared: this.cleared, maxQ: this.maxQ, fuel: this.idle * CFG.idleLph / 3600, arrived: n };
  }
}
function runBenchmark(rates, seed, seconds = 60) {
  const out = {};
  ['fixed', 'ai'].forEach(m => { const s = new Sim(m, rates, seed); for (let k = 0; k < seconds * 30; k++) s.step(1 / 30); out[m] = s.report(); });
  return out;
}
const METRICS = [
  { k: 'avgWait', label: 'Average Wait Time', unit: 's', fmt: v => v.toFixed(1), low: true },
  { k: 'cleared', label: 'Total Vehicles Cleared (Throughput)', unit: 'veh', fmt: v => v.toFixed(0), low: false },
  { k: 'maxQ', label: 'Max Queue Length', unit: 'veh', fmt: v => v.toFixed(0), low: true },
  { k: 'fuel', label: 'Estimated Fuel Wasted Idling', unit: 'L', fmt: v => v.toFixed(3), low: true }
];
const improvement = (m, f, a) => f[m.k] ? (m.low ? f[m.k] - a[m.k] : a[m.k] - f[m.k]) / f[m.k] * 100 : 0;

if (typeof document === 'undefined') { module.exports = { Sim, runBenchmark, SCEN, METRICS, improvement, CFG }; }
else { document.addEventListener('DOMContentLoaded', initUI); }

/* -------------------------------- drawing -------------------------------- */
function frame(c, a, fn) { c.save(); c.translate(CX, CY); c.rotate(TH[a]); fn(); c.restore(); }
function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
function sigOf(sim, a) { return a === sim.cur ? (sim.state === 'allred' ? 'red' : sim.state) : 'red'; }
const LAMP = { red: '#f87171', yellow: '#fbbf24', green: '#34d399' };
function drawHead(c, x, y, st) {
  c.fillStyle = '#0a0f1a'; c.strokeStyle = '#4a5b7a'; c.lineWidth = 1.5; rr(c, x - 8, y - 21, 16, 42, 6); c.fill(); c.stroke();
  ['red', 'yellow', 'green'].forEach((k, i) => {
    const on = st === k; c.beginPath(); c.arc(x, y - 12 + i * 12, 4.6, 0, 7); c.fillStyle = on ? LAMP[k] : '#2a3550';
    if (on) { c.shadowColor = LAMP[k]; c.shadowBlur = 12; } c.fill(); c.shadowBlur = 0;
  });
}
function badge(c, x, y, n) {
  c.beginPath(); c.arc(x, y, 10, 0, 7); c.fillStyle = '#0a111e'; c.fill(); c.strokeStyle = '#22d3ee'; c.lineWidth = 1.5; c.stroke();
  c.fillStyle = '#22d3ee'; c.font = '700 12px Inter,system-ui,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(n, x, y + .5);
}
function drawScene(c, o) {
  c.fillStyle = '#0d1626'; c.fillRect(0, 0, SIZE, SIZE);
  c.strokeStyle = 'rgba(120,150,200,.07)'; c.lineWidth = 1; c.beginPath();
  for (let i = 0; i <= SIZE; i += 35) { c.moveTo(i, 0); c.lineTo(i, SIZE); c.moveTo(0, i); c.lineTo(SIZE, i); } c.stroke();
  c.fillStyle = '#232f45'; c.fillRect(CX - HALF, 0, 2 * HALF, SIZE); c.fillRect(0, CY - HALF, SIZE, 2 * HALF);
  c.strokeStyle = '#4a5b7a'; c.lineWidth = 2;
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => { c.beginPath(); c.moveTo(CX + sx * HALF, CY + sy * 350); c.lineTo(CX + sx * HALF, CY + sy * HALF); c.lineTo(CX + sx * 350, CY + sy * HALF); c.stroke(); });
  for (let a = 0; a < 4; a++) frame(c, a, () => {
    c.strokeStyle = '#e0b43a'; c.lineWidth = 1.6; [-2, 2].forEach(y => { c.beginPath(); c.moveTo(-350, y); c.lineTo(-60, y); c.stroke(); });
    c.fillStyle = '#f4f7fb'; c.fillRect(-61.5, 0, 3, HALF);
    c.fillStyle = 'rgba(244,247,251,.82)'; for (let y = -40; y <= 40; y += 11) c.fillRect(-58, y - 3.5, 12, 7);
    c.fillStyle = 'rgba(244,247,251,.35)'; c.beginPath(); c.moveTo(-170, 19); c.lineTo(-158, 19); c.lineTo(-158, 15); c.lineTo(-146, 22); c.lineTo(-158, 29); c.lineTo(-158, 25); c.lineTo(-170, 25); c.fill();
    if (o.bp) {
      c.fillStyle = 'rgba(251,146,60,.35)'; c.strokeStyle = '#fb923c'; c.lineWidth = 1.5;
      [-84, -190].forEach(x => { c.fillRect(x, 6, 18, 32); c.strokeRect(x, 6, 18, 32); });
      c.fillStyle = 'rgba(34,211,238,.10)'; c.strokeStyle = 'rgba(34,211,238,.75)'; c.setLineDash([5, 4]);
      c.beginPath(); c.moveTo(-72, 60); c.lineTo(-262, 0); c.lineTo(-262, 44); c.closePath(); c.fill(); c.stroke(); c.setLineDash([]);
      c.beginPath(); c.arc(-72, 60, 5, 0, 7); c.fillStyle = '#22d3ee'; c.fill();
    }
  });
  c.font = '600 13px Inter,system-ui,sans-serif';
  const labs = [[CX + 54, 22, 'left'], [SIZE - 12, CY - 56, 'right'], [CX - 54, SIZE - 14, 'right'], [12, CY + 68, 'left']];
  const road = [o.ns, o.ew, o.ns, o.ew];
  c.textBaseline = 'middle';
  for (let a = 0; a < 4; a++) {
    c.textAlign = labs[a][2]; c.fillStyle = '#93a6c4'; c.fillText(`${'NESW'[a]} · ${road[a]}`, labs[a][0], labs[a][1]);
  }
  if (o.bp) {
    c.fillStyle = '#7f93b3'; c.font = '600 13px Inter,system-ui,sans-serif'; c.textAlign = 'center';
    c.save(); c.translate(CX + 22, CY - 190); c.rotate(-Math.PI / 2); c.fillText(o.ns.toUpperCase(), 0, 0); c.restore();
    c.fillText(o.ew.toUpperCase(), CX + 190, CY + 22);
    badge(c, ...pos(0, 8, -64), 5); badge(c, ...pos(0, -15, -64), 1); badge(c, ...pos(0, -121, -64), 2); badge(c, ...pos(0, -200, -64), 3);
  }
}
function drawHeads(c, sim, bp) {
  for (let a = 0; a < 4; a++) { const [x, y] = pos(a, -12, 56); drawHead(c, x, y, bp ? (a === 0 ? 'green' : 'red') : sigOf(sim, a)); }
  if (bp) badge(c, ...pos(0, -12, 86), 4);
}
const COLORS = ['#60a5fa', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb923c', '#e2e8f0', '#22d3ee'];
function drawVehicles(c, sim) {
  for (let a = 0; a < 4; a++) {
    frame(c, a, () => sim.lanes[a].forEach(v => {
      c.save(); c.translate(v.s - STOP - v.len / 2, 22);
      c.fillStyle = v.amb ? '#ffffff' : COLORS[v.id % 8]; rr(c, -v.len / 2, -5, v.len, 10, 2.5); c.fill();
      if (v.amb) { c.fillStyle = '#ef4444'; c.fillRect(-v.len / 2 + 3, -1.2, v.len - 6, 2.4); c.fillStyle = Math.floor(sim.t * 6) % 2 ? '#ef4444' : '#3b82f6'; c.shadowColor = c.fillStyle; c.shadowBlur = 10; c.fillRect(-2, -5, 4, 10); c.shadowBlur = 0; }
      c.fillStyle = 'rgba(10,17,30,.7)'; c.fillRect(v.len / 2 - 6, -3.5, 3, 7);
      if (v.v < 10 && v.s < 0) { c.fillStyle = '#ef4444'; c.fillRect(-v.len / 2, -4, 1.6, 3); c.fillRect(-v.len / 2, 1, 1.6, 3); }
      c.restore();
    }));
    const n = sim.pend[a].length;
    if (n) { const [x, y] = pos(a, -250, -26); c.fillStyle = '#fbbf24'; c.font = '700 12px Inter,system-ui,sans-serif'; c.textAlign = 'center'; c.fillText('+' + n, x, y); }
  }
}

/* ----------------------------------- UI ----------------------------------- */
function initUI() {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const PRESETS = [
    ['Bengaluru', 'Silk Board Junction', 'Hosur Road', 'Outer Ring Road'],
    ['New Delhi', 'ITO Crossing', 'Vikas Marg', 'Bahadur Shah Zafar Marg'],
    ['Mumbai', 'Dadar TT Circle', 'Dr. Ambedkar Road', 'Tilak Road'],
    ['Hyderabad', 'Hitec City Junction', 'Madhapur Main Road', 'Cyber Towers Road'],
    ['Pune', 'Chandni Chowk', 'Pune–Bengaluru Highway', 'Paud Road']
  ];
  const setup = cv => { const d = Math.min(2, window.devicePixelRatio || 1); cv.width = cv.height = SIZE * d; const c = cv.getContext('2d'); c.setTransform(d, 0, 0, d, 0, 0); return c; };
  const bpc = setup($('#bp')), lc = setup($('#live'));
  const S = { scen: 'balanced', rates: SCEN.balanced.rates.slice(), mode: 'ai', speed: 1, paused: false, view: 'blueprint', sim: null, benchKey: '' };
  const names = () => ({ city: $('#city').value.trim() || 'Your City', junction: $('#junction').value.trim() || 'Your Junction', ns: $('#nsRoad').value.trim() || 'North–South Road', ew: $('#ewRoad').value.trim() || 'East–West Road' });
  const resetSim = () => { S.sim = new Sim(S.mode, S.rates, 42); $('#ambMsg').textContent = 'AI mode clears the ambulance’s lane immediately. Fixed-Timer has no override.'; };

  function drawBlueprint() { const n = names(); drawScene(bpc, { bp: true, ns: n.ns, ew: n.ew }); drawHeads(bpc, null, true); }
  function bind() { const n = names(); $$('[data-bind]').forEach(e => e.textContent = n[e.dataset.bind]); document.title = `Traffic Flow Optimizer · ${n.junction}, ${n.city}`; drawBlueprint(); if (S.view === 'results') renderBench(true); }
  PRESETS.forEach((p, i) => $('#preset').add(new Option(`${p[1]} — ${p[0]}`, i)));
  $('#preset').add(new Option('Custom (type your own)', -1));
  $('#preset').onchange = e => { const p = PRESETS[+e.target.value]; if (p) { $('#city').value = p[0]; $('#junction').value = p[1]; $('#nsRoad').value = p[2]; $('#ewRoad').value = p[3]; bind(); } };
  ['city', 'junction', 'nsRoad', 'ewRoad'].forEach(id => $('#' + id).addEventListener('input', () => { $('#preset').value = -1; bind(); }));

  /* scenario + sliders */
  Object.entries(SCEN).forEach(([k, v]) => $('#scen').add(new Option(v.label, k)));
  $('#sliders').innerHTML = NAMES.map((n, i) => `<label>${n} arrivals <output id="o${i}"></output> veh/min<input type="range" id="sl${i}" min="0" max="20" step="1"></label>`).join('');
  const syncSliders = () => NAMES.forEach((_, i) => { $('#sl' + i).value = S.rates[i]; $('#o' + i).textContent = S.rates[i]; $('#sl' + i).disabled = S.scen !== 'custom'; });
  $('#scen').onchange = e => { S.scen = e.target.value; S.rates = SCEN[S.scen].rates.slice(); syncSliders(); resetSim(); };
  NAMES.forEach((_, i) => $('#sl' + i).oninput = e => { S.rates[i] = +e.target.value; $('#o' + i).textContent = e.target.value; S.sim.setRates(S.rates); });
  syncSliders();

  $$('#modeSeg button').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; $$('#modeSeg button').forEach(x => x.classList.toggle('on', x === b)); resetSim(); });
  $$('#speedSeg button').forEach(b => b.onclick = () => { S.speed = +b.dataset.sp; $$('#speedSeg button').forEach(x => x.classList.toggle('on', x === b)); });
  $('#pause').onclick = e => { S.paused = !S.paused; e.target.textContent = S.paused ? 'Resume' : 'Pause'; };
  $('#reset').onclick = resetSim;
  NAMES.forEach((n, i) => $('#ambSel').add(new Option(n, i)));
  $('#ambBtn').onclick = () => { if (!S.sim.trigger(+$('#ambSel').value)) $('#ambMsg').textContent = 'An ambulance is already in the system.'; };

  /* tabs */
  function show(v) {
    S.view = v; $$('.view').forEach(x => x.classList.toggle('on', x.id === 'view-' + v)); $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    if (v === 'blueprint') drawBlueprint(); if (v === 'results') renderBench(false); if (history.replaceState) history.replaceState(null, '', '#' + v);
  }
  $$('.tabs button').forEach(b => b.onclick = () => show(b.dataset.view));

  /* benchmark */
  let bench = null;
  function renderBench(force) {
    const key = S.scen + S.rates.join(',');
    if (bench && !force && bench.key === key) return draw(); if (force && !bench) return;
    runNow(false);
    function draw() { paintBench(); }
  }
  function runNow(fresh) {
    const key = S.scen + S.rates.join(','), seed = fresh || !bench ? 1000 + Math.floor(Math.random() * 9000) : bench.seed;
    bench = { key, seed, res: runBenchmark(S.rates, seed), scen: SCEN[S.scen].label }; paintBench();
  }
  $('#run').onclick = () => runNow(true);
  function paintBench() {
    const { res, seed, scen } = bench, f = res.fixed, a = res.ai, n = names();
    $('#benchInfo').textContent = `${scen} · seed #${seed} · 60 s simulated · both controllers see identical arrivals`;
    const imp = METRICS.map(m => improvement(m, f, a)), card = (t, r, cls) => `<article class="card ${cls}"><h3>${t}</h3><div class="big">${r.avgWait.toFixed(1)}<small>s avg wait</small></div><ul><li>Cleared <b>${r.cleared}</b> veh</li><li>Max queue <b>${r.maxQ}</b> veh</li><li>Idling fuel <b>${r.fuel.toFixed(3)}</b> L</li><li>Vehicles <b>${r.arrived}</b></li></ul></article>`;
    const bars = (m, i) => { const mx = Math.max(f[m.k], a[m.k], 1e-9); return `<div class="chart"><h4>${m.label} (${m.unit})</h4><div class="row"><span>Fixed-Timer</span><div class="track"><i class="f" style="width:${f[m.k] / mx * 100}%"></i></div><b>${m.fmt(f[m.k])}</b></div><div class="row"><span>AI Adaptive</span><div class="track"><i class="a" style="width:${a[m.k] / mx * 100}%"></i></div><b>${m.fmt(a[m.k])}</b></div></div>`; };
    $('#results').innerHTML = `<div class="headline"><b>${n.junction}, ${n.city}</b> — AI Adaptive cut average wait by <b class="${imp[0] >= 0 ? 'pos' : 'neg'}">${imp[0].toFixed(1)}%</b> and changed throughput by <b class="${imp[1] >= 0 ? 'pos' : 'neg'}">${imp[1] >= 0 ? '+' : ''}${imp[1].toFixed(1)}%</b> versus the 25 s fixed timer.</div>
      <div class="cmp">${card('Fixed-Timer Signal (25 s / approach)', f, '')}${card('AI Adaptive Optimizer (8–45 s)', a, 'ai')}</div>
      <table class="tbl"><tr><th>Metric</th><th>Fixed-Timer</th><th>AI Adaptive</th><th>% Improvement</th></tr>${METRICS.map((m, i) => `<tr><td>${m.label} (${m.unit})</td><td>${m.fmt(f[m.k])}</td><td>${m.fmt(a[m.k])}</td><td class="${imp[i] >= 0 ? 'pos' : 'neg'}">${imp[i] >= 0 ? '+' : ''}${imp[i].toFixed(1)}%</td></tr>`).join('')}</table>
      <div class="charts">${METRICS.map(bars).join('')}<div class="chart"><h4>% Improvement with AI (positive = better)</h4>${METRICS.map((m, i) => `<div class="row"><span>${m.label.split(' (')[0].replace('Estimated ', '').replace('Total ', '')}</span><div class="track"><i class="${imp[i] >= 0 ? 'a' : 'n'}" style="width:${clamp(Math.abs(imp[i]), 0, 100)}%"></i></div><b>${imp[i].toFixed(0)}%</b></div>`).join('')}</div></div>`;
  }

  /* telemetry */
  function telemetry() {
    const s = S.sim, r = s.report(), rem = s.dur > 900 ? 'PRIORITY' : Math.max(0, s.dur - s.pt).toFixed(0) + 's', st = s.state === 'allred' ? 'ALL-RED' : s.state.toUpperCase();
    $('#phase').innerHTML = `<div><small>Active phase</small><b>${NAMES[s.cur]} · ${st}</b><small>${s.mode === 'ai' ? 'AI Adaptive' : 'Fixed-Timer'} · t = ${s.t.toFixed(0)} s</small></div><div class="t">${s.state === 'allred' ? '–' : rem}</div>`;
    let rows = '<tr><th>Lane</th><th>Queue</th><th>Max wait</th><th>Rate/min</th><th>AI score</th></tr>';
    for (let a = 0; a < 4; a++) rows += `<tr><td><i class="dot ${sigOf(s, a)}"></i>${NAMES[a]}</td><td>${s.queue(a)}</td><td>${s.maxWait(a).toFixed(0)} s</td><td>${s.rate(a).toFixed(0)}</td><td><b>${s.score(a).toFixed(0)}</b></td></tr>`;
    $('#tel').innerHTML = rows;
    $('#kpis').innerHTML = `<div class="kpi"><b>${r.avgWait.toFixed(1)} s</b><span>Avg wait</span></div><div class="kpi"><b>${r.cleared}</b><span>Cleared</span></div><div class="kpi"><b>${r.maxQ}</b><span>Max queue</span></div>`;
    if (s.amb) $('#ambMsg').textContent = s.amb.done ? `Ambulance from the ${NAMES[s.amb.a]} cleared the stop line in ${s.amb.time.toFixed(1)} s.` : s.mode === 'ai' ? `Priority corridor active — ${NAMES[s.amb.a]} lane is being cleared.` : 'Ambulance is waiting for the fixed cycle (no override).';
  }

  /* main loop */
  let last = performance.now(), acc = 0, tAcc = 0;
  function loop(now) {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    if (S.view === 'live') {
      if (!S.paused) { acc += dt * S.speed; while (acc >= 1 / 30) { S.sim.step(1 / 30); acc -= 1 / 30; } }
      const n = names(); drawScene(lc, { bp: false, ns: n.ns, ew: n.ew }); drawVehicles(lc, S.sim); drawHeads(lc, S.sim, false);
      tAcc += dt; if (tAcc > .2) { tAcc = 0; telemetry(); }
    }
    requestAnimationFrame(loop);
  }
  resetSim(); bind();
  const hv = location.hash.slice(1); show(['blueprint', 'live', 'results'].includes(hv) ? hv : 'blueprint');
  requestAnimationFrame(loop);
}

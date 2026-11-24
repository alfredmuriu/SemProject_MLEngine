/* FlockWise web app - talks to the ML engine API served from the same origin.
   Plain JS, no build step: two views switched by the URL hash. */

// ------------------------------------------------------------------ icons
// Lucide icon paths (the icon set the ERPs use), inlined so the app works offline.
const ICONS = {
  egg: '<path d="M12 22c6.23-.05 7.87-5.57 7.5-10-.36-4.34-3.95-9.96-7.5-10-3.55.04-7.14 5.66-7.5 10-.37 4.43 1.27 9.95 7.5 10z"/>',
  bird: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  trend: '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
};

const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

function hydrateIcons(root) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    el.removeAttribute('data-icon');
  });
}

// ---------------------------------------------------------------- helpers
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (n, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : Number(n).toLocaleString('en-KE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const pct = (n) => (n === null || n === undefined ? '—' : `${fmt(n, 1)}%`);
const signed = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), 1)}`);

async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // FastAPI puts validation problems in detail as a list, other errors as a string
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => `${d.loc.slice(-2).join(' ')}: ${d.msg}`).join('; ')
      : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

const FLAGS = {
  below_standard: { label: 'Below standard', tone: 'danger' },
  recovering: { label: 'Recovering', tone: 'brand' },
  falling_behind: { label: 'Falling behind', tone: 'warning' },
  high_mortality: { label: 'High mortality', tone: 'danger' },
  poor_feed_efficiency: { label: 'Feed per egg high', tone: 'warning' },
};

const badge = (label, tone) => `<span class="badge badge-${tone}"><span class="pip"></span>${esc(label)}</span>`;

function statusBadges(flags) {
  if (!flags.length) return badge('On track', 'success');
  return `<div class="badges">${flags.map((f) => badge(FLAGS[f].label, FLAGS[f].tone)).join('')}</div>`;
}

function stat(label, value, iconName, hint = '', tone = '') {
  return `
    <div class="card stat">
      <div class="stat-top"><p class="micro">${label}</p>${iconName ? icon(iconName) : ''}</div>
      <p class="stat-value num ${tone}">${value}</p>
      ${hint ? `<p class="stat-hint">${hint}</p>` : ''}
    </div>`;
}

function pageHeader(eyebrow, title, lead, actions = '') {
  return `
    <div class="page-header">
      <div>
        <div class="eyebrow">${eyebrow}</div>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </div>
      ${actions ? `<div class="actions">${actions}</div>` : ''}
    </div>`;
}

const errorNote = (message) => `<div class="note error">${icon('alert')}<span>${esc(message)}</span></div>`;

// Picks the icon and tone for one of the agent's action sentences.
function actionStyle(text) {
  if (text.startsWith('Laying is')) return ['alert', 'danger'];
  if (text.startsWith('On track now')) return ['trend', 'warning'];
  if (text.includes('died or were culled')) return ['users', 'danger'];
  if (text.startsWith('Feed per dozen')) return ['package', 'warning'];
  return ['check', 'success'];
}

const actionList = (actions) => `
  <ul class="action-list">
    ${actions.map((a) => {
      const [name, tone] = actionStyle(a);
      return `<li><span class="action-icon ${tone}">${icon(name)}</span><span>${esc(a)}</span></li>`;
    }).join('')}
  </ul>`;

// ------------------------------------------------------------ flock review
let flock = { flock_id: 'House 1', weeks: [] };
let sampleNote = '';
let lastReview = null;

const COLUMNS = [
  ['age_weeks', 'Age (weeks)', 'e.g. 30'],
  ['hens', 'Hens alive', 'e.g. 1500'],
  ['eggs', 'Eggs collected', 'e.g. 9400'],
  ['feed_kg', 'Feed used (kg)', 'e.g. 1260'],
  ['deaths', 'Deaths + culls', 'optional'],
];

function blankWeek() {
  const last = flock.weeks[flock.weeks.length - 1];
  return last
    ? { age_weeks: last.age_weeks + 1, hens: last.hens, eggs: '', feed_kg: '', deaths: '' }
    : { age_weeks: 19, hens: '', eggs: '', feed_kg: '', deaths: '' };
}

function renderReview(view) {
  view.innerHTML = `
    ${pageHeader('Weekly review', 'How is the flock laying?',
      'Enter the flock’s weekly records. The agent compares this week with the breed standard, forecasts the laying rate 1, 4 and 8 weeks ahead, and recommends what to do.',
      `<button class="btn btn-secondary" data-load-sample>${icon('download')}Load sample flock</button>
       <button class="btn btn-primary" data-run>${icon('play')}Run review</button>`)}
    <div class="stack">
      <div data-results></div>
      <section class="card">
        <header class="card-header">
          <div><h2>Weekly records</h2><p class="sub">One row per week, oldest first, at least 3 weeks. Leave deaths blank to work them out from the drop in hens.</p></div>
          <div class="actions">
            <input class="field field-sm" data-flock-id value="${esc(flock.flock_id)}" aria-label="Flock name" style="width:160px">
            <button class="btn btn-secondary btn-sm" data-add>${icon('plus')}Add week</button>
          </div>
        </header>
        <div data-entry></div>
      </section>
    </div>`;

  view.querySelector('[data-flock-id]').addEventListener('input', (e) => { flock.flock_id = e.target.value; });
  view.querySelector('[data-add]').onclick = () => { flock.weeks.push(blankWeek()); drawEntry(view); };
  view.querySelector('[data-load-sample]').onclick = () => loadSample(view);
  view.querySelector('[data-run]').onclick = () => runReview(view);

  drawEntry(view);
  drawResults(view);
}

async function loadSample(view) {
  try {
    const sample = await api('/sample-flock');
    flock = { flock_id: sample.flock_id, weeks: sample.weeks };
    sampleNote = sample.note;
    lastReview = null;
    renderReview(view);
  } catch (err) {
    view.querySelector('[data-results]').innerHTML = errorNote(err.message);
  }
}

function drawEntry(view) {
  const host = view.querySelector('[data-entry]');
  if (!flock.weeks.length) {
    host.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('egg')}</div>
        <div><h3>No records yet</h3><p>Add weeks one by one, or load the sample flock to see the agent at work.</p></div>
      </div>`;
    return;
  }
  host.innerHTML = `
    ${sampleNote ? `<div style="padding:16px 24px 0"><div class="note">${icon('info')}<span>${esc(sampleNote)} The model was trained on this flock, so its forecasts here look better than they would for a new flock - see The model for scores on unseen flocks.</span></div></div>` : ''}
    <div class="table-wrap" style="max-height:440px;overflow-y:auto">
      <table class="wide entry">
        <thead><tr>${COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}<th class="right">Laying rate</th><th><span class="sr-only">Remove</span></th></tr></thead>
        <tbody>
          ${flock.weeks.map((w, i) => `
            <tr data-row="${i}">
              ${COLUMNS.map(([key, label, placeholder]) => `
                <td><input class="field field-sm num" data-key="${key}" type="number" min="0" step="any" value="${esc(w[key])}" placeholder="${placeholder}" aria-label="${label}, week ${i + 1}"></td>`).join('')}
              <td class="right num" data-rate>${rateCell(w)}</td>
              <td class="right"><button class="icon-btn" data-remove aria-label="Remove week ${esc(w.age_weeks)}">${icon('trash')}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  host.querySelectorAll('tr[data-row]').forEach((row) => {
    const week = flock.weeks[Number(row.dataset.row)];
    row.querySelectorAll('[data-key]').forEach((input) => {
      input.addEventListener('input', () => {
        week[input.dataset.key] = input.value === '' ? '' : Number(input.value);
        row.querySelector('[data-rate]').innerHTML = rateCell(week);
      });
    });
    row.querySelector('[data-remove]').onclick = () => {
      flock.weeks.splice(Number(row.dataset.row), 1);
      drawEntry(view);
    };
  });
}

// share of hens laying per day, the same sum the engine does
function rateCell(w) {
  if (!(w.hens > 0) || w.eggs === '' || w.eggs == null) return '<span class="muted">—</span>';
  return pct((100 * w.eggs) / w.hens / 7);
}

function weeksPayload() {
  // Deaths go in only if every week has them; otherwise the engine works them
  // out from the drop in hens for all weeks.
  const allDeaths = flock.weeks.every((w) => w.deaths !== '' && w.deaths != null);
  return flock.weeks.map((w) => {
    const out = { age_weeks: w.age_weeks, hens: w.hens, eggs: w.eggs, feed_kg: w.feed_kg };
    if (allDeaths) out.deaths = w.deaths;
    return out;
  });
}

async function runReview(view) {
  const results = view.querySelector('[data-results]');
  const required = ['age_weeks', 'hens', 'eggs', 'feed_kg'];
  const incomplete = flock.weeks.filter((w) => required.some((k) => w[k] === '' || w[k] == null));
  if (flock.weeks.length < 3) { results.innerHTML = errorNote('Enter at least 3 consecutive weeks of records.'); return; }
  if (incomplete.length) {
    results.innerHTML = errorNote(`Age, hens, eggs and feed are needed every week - missing in week ${incomplete.map((w) => w.age_weeks || '?').join(', ')}.`);
    return;
  }

  const button = view.querySelector('[data-run]');
  button.disabled = true;
  try {
    lastReview = await api('/flock/review', { flock_id: flock.flock_id || null, weeks: weeksPayload() });
    drawResults(view);
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    results.innerHTML = errorNote(err.message);
  } finally {
    button.disabled = false;
  }
}

function drawResults(view) {
  const host = view.querySelector('[data-results]');
  if (!lastReview) {
    host.innerHTML = '';
    return;
  }
  const { latest: l, forecasts, actions, flags, history, expected_eggs_next_week: nextEggs } = lastReview;
  const ahead = forecasts.find((f) => f.horizon_weeks === 4) || forecasts[forecasts.length - 1];
  const gapTone = l.gap == null ? '' : l.gap < -5 ? 'negative' : l.gap >= 0 ? 'positive' : '';
  const aheadTone = !ahead ? '' : ahead.gap < -5 ? 'warning' : '';

  host.innerHTML = `
    <div class="stack">
      <div class="stat-grid">
        ${stat(`Laying rate · week ${l.age_weeks}`, pct(l.lay_rate), 'egg',
          l.standard == null ? 'no breed standard at this age' : `${signed(l.gap)} points against the standard of ${pct(l.standard)}`, gapTone)}
        ${stat(ahead ? `Forecast · week ${ahead.age_weeks}` : 'Forecast', ahead ? pct(ahead.lay_rate) : '—', 'trend',
          ahead ? `likely ${fmt(ahead.low, 1)}–${fmt(ahead.high, 1)}% · standard ${pct(ahead.standard)}` : 'past the ages the model was trained on', aheadTone)}
        ${stat('Eggs expected next week', fmt(nextEggs), 'package',
          nextEggs == null ? 'no 1-week forecast at this age' : `from ${fmt(l.hens)} hens · ${fmt(l.eggs)} collected this week`)}
        ${stat('Mortality this week', `${fmt(l.mortality_pct, 2)}%`, 'users',
          `${fmt(l.deaths)} ${l.deaths === 1 ? 'bird' : 'birds'} · ${fmt(l.cum_mortality_pct, 1)}% since housing`, flags.includes('high_mortality') ? 'negative' : '')}
      </div>

      <div class="grid split">
        <section class="card">
          <header class="card-header">
            <div><h2>Laying rate against the breed standard</h2><p class="sub">${esc(lastReview.flock_id || 'Flock')} · ${lastReview.weeks_recorded} weeks recorded · forecasts with the range 80% of past forecasts fell in</p></div>
          </header>
          <div class="legend">
            <span><i class="key key-actual"></i>Recorded</span>
            <span><i class="key key-standard"></i>Breed standard</span>
            <span><i class="key key-forecast"></i>Forecast</span>
          </div>
          <div class="chart" data-chart></div>
        </section>
        <section class="card">
          <header class="card-header"><div><h2>Recommended actions</h2><p class="sub">What the agent concluded</p></div>${statusBadges(flags)}</header>
          ${actionList(actions)}
        </section>
      </div>

      <section class="card">
        <header class="card-header"><div><h2>Forecasts</h2><p class="sub">Laying rate is the share of hens laying per day</p></div></header>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Weeks ahead</th><th>Age (weeks)</th><th class="right">Forecast</th><th class="right">Likely range</th><th class="right">Standard</th><th class="right">Gap (points)</th></tr></thead>
            <tbody>
              ${forecasts.length ? forecasts.map((f) => `
                <tr>
                  <td class="num">${f.horizon_weeks}</td>
                  <td class="num">${f.age_weeks}</td>
                  <td class="right num" style="font-weight:600;color:var(--ink-900)">${pct(f.lay_rate)}</td>
                  <td class="right num">${fmt(f.low, 1)}–${fmt(f.high, 1)}%</td>
                  <td class="right num">${pct(f.standard)}</td>
                  <td class="right num ${f.gap < -5 ? 'text-negative' : ''}">${signed(f.gap)}</td>
                </tr>`).join('') : '<tr><td colspan="6" class="muted">No forecasts - the flock is older than the ages the model was trained on (up to 70 weeks).</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;

  drawChart(host.querySelector('[data-chart]'), history, forecasts);
}

// ---------------------------------------------------------------- the chart
// Recorded laying rate, the breed standard and the forecasts on one age axis.
// Drawn at the container's real pixel width (and redrawn on resize) so text
// and line weights stay at their true size instead of scaling with the svg.
let redrawChart = null;
window.addEventListener('resize', () => {
  clearTimeout(window.__chartTimer);
  window.__chartTimer = setTimeout(() => redrawChart && redrawChart(), 150);
});

let standardCurve = null;
async function getStandardCurve() {
  if (!standardCurve) standardCurve = await api('/standard-curve');
  return standardCurve;
}

async function drawChart(host, history, forecasts) {
  const curve = await getStandardCurve().catch(() => []);
  redrawChart = () => { if (host.isConnected) drawChart(host, history, forecasts); };
  const W = Math.max(280, host.clientWidth - 48);
  const H = W < 560 ? 240 : 300;
  const M = { top: 12, right: 16, bottom: 32, left: 40 };
  const ages = [...history.map((p) => p.age_weeks), ...forecasts.map((f) => f.age_weeks)];
  const xMin = Math.min(...ages);
  const xMax = Math.max(...ages);
  const x = (a) => M.left + ((a - xMin) / Math.max(1, xMax - xMin)) * (W - M.left - M.right);
  const y = (v) => M.top + (1 - Math.min(v, 105) / 105) * (H - M.top - M.bottom);
  const line = (pts, key) => pts.filter((p) => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${x(p.age_weeks).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  const std = curve.filter((p) => p.age_weeks >= xMin && p.age_weeks <= xMax);
  const last = history[history.length - 1];
  const step = xMax - xMin > 30 ? 10 : 5;
  const xTicks = [];
  for (let a = Math.ceil(xMin / step) * step; a <= xMax; a += step) xTicks.push(a);
  const forecastPath = [last, ...forecasts].map((p, i) => `${i ? 'L' : 'M'}${x(p.age_weeks).toFixed(1)},${y(p.lay_rate).toFixed(1)}`).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart of the flock's weekly laying rate against the breed standard, with forecasts for the coming weeks.">
      ${[0, 25, 50, 75, 100].map((t) => `<line class="grid-line" x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis-label" x="${M.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`).join('')}
      ${xTicks.map((t) => `<text class="axis-label" x="${x(t)}" y="${H - 10}" text-anchor="middle">${t} wk</text>`).join('')}
      <rect class="gap-band" x="${x(last.age_weeks)}" y="${M.top}" width="${Math.max(0, x(xMax) - x(last.age_weeks))}" height="${H - M.top - M.bottom}"/>
      <path class="standard" d="${line(std, 'standard')}"/>
      <path class="series" d="${line(history, 'lay_rate')}"/>
      ${forecasts.length ? `<path class="forecast-line" d="${forecastPath}"/>` : ''}
      ${forecasts.map((f) => `
        <line class="whisker" x1="${x(f.age_weeks)}" x2="${x(f.age_weeks)}" y1="${y(f.low)}" y2="${y(f.high)}"/>
        <circle class="forecast-dot" cx="${x(f.age_weeks)}" cy="${y(f.lay_rate)}" r="4.5"/>`).join('')}
      <line class="crosshair" data-cross y1="${M.top}" y2="${H - M.bottom}" visibility="hidden"/>
      <rect data-hit x="${M.left}" y="0" width="${W - M.left - M.right}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tooltip" data-tip hidden></div>`;

  const svg = host.querySelector('svg');
  const cross = host.querySelector('[data-cross]');
  const tip = host.querySelector('[data-tip]');
  const stdAt = Object.fromEntries(curve.map((p) => [p.age_weeks, p.standard]));
  const points = [
    ...history.map((p) => ({ age: p.age_weeks, text: `<strong class="num">${pct(p.lay_rate)}</strong>recorded at ${p.age_weeks} weeks · standard ${pct(stdAt[p.age_weeks])}`, v: p.lay_rate })),
    ...forecasts.map((f) => ({ age: f.age_weeks, text: `<strong class="num">${pct(f.lay_rate)}</strong>forecast for ${f.age_weeks} weeks (${fmt(f.low, 1)}–${fmt(f.high, 1)}%) · standard ${pct(f.standard)}`, v: f.lay_rate })),
  ];

  const show = (event) => {
    const box = svg.getBoundingClientRect();
    const scale = W / box.width;
    const svgX = (event.clientX - box.left) * scale;
    const p = points.reduce((best, q) => (Math.abs(x(q.age) - svgX) < Math.abs(x(best.age) - svgX) ? q : best));
    cross.setAttribute('x1', x(p.age)); cross.setAttribute('x2', x(p.age));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = p.text;
    const hostBox = host.getBoundingClientRect();
    const px = box.left - hostBox.left + x(p.age) / scale;
    const py = box.top - hostBox.top + y(p.v) / scale;
    const left = px + tip.offsetWidth + 12 > host.clientWidth ? px - tip.offsetWidth - 12 : px + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 8)}px`;
  };
  const hide = () => { cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const hit = host.querySelector('[data-hit]');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// --------------------------------------------------------------- the model
const BASELINE_NOTES = {
  'Same as this week': 'assume next weeks match this week',
  'Breed standard': 'assume the flock follows the breed guide',
  "Standard + this week's gap": 'the guide, shifted by how far off the flock is now',
};

async function renderModel(view) {
  view.innerHTML = `
    ${pageHeader('The model', 'What the engine learned',
      'How the forecasters were trained, how they scored on flocks they had never seen, and what those scores do and don’t mean.')}
    <div data-model-body><div class="card"><div class="empty"><p>Loading model details…</p></div></div></div>`;
  const body = view.querySelector('[data-model-body]');

  let info;
  try {
    info = await api('/model');
  } catch (err) {
    body.innerHTML = errorNote(err.message);
    return;
  }
  const hs = info.horizons;
  const methods = [...new Set(hs.flatMap((h) => Object.keys(h.results)))]
    .sort((a, b) => hs[0].results[a].mae - hs[0].results[b].mae);
  const best = (h) => Math.min(...Object.values(h.results).map((r) => r.mae));
  const one = hs.find((h) => h.horizon_weeks === 1);
  const four = hs.find((h) => h.horizon_weeks === 4);

  body.innerHTML = `
    <div class="stack">
      <div class="stat-grid">
        ${stat('Trained on', `${fmt(info.n_flocks)} flocks`, 'users', `${fmt(info.n_weeks)} flock-weeks of real farm records`)}
        ${stat('1 week ahead', `± ${fmt(one.results[one.model].mae, 1)} pts`, 'target', `${esc(one.model)} · R² ${fmt(one.results[one.model].r2, 2)} on unseen flocks`)}
        ${stat('4 weeks ahead', `± ${fmt(four.results[four.model].mae, 1)} pts`, 'trend', `${esc(four.model)} · R² ${fmt(four.results[four.model].r2, 2)} on unseen flocks`)}
        ${stat('Inputs', fmt(info.features.length), 'info', 'age, recent laying, feed, mortality and the breed standard')}
      </div>

      <section class="card">
        <header class="card-header">
          <div><h2>Average forecast error on unseen flocks</h2><p class="sub">Mean absolute error in laying-rate points, leaving one flock out at a time. Lower is better; the best for each horizon is highlighted.</p></div>
        </header>
        <div class="table-wrap">
          <table class="wide">
            <thead><tr><th>Method</th>${hs.map((h) => `<th class="right">${h.horizon_weeks} ${h.horizon_weeks === 1 ? 'week' : 'weeks'} ahead</th>`).join('')}</tr></thead>
            <tbody>
              ${methods.map((m) => `
                <tr>
                  <td><span style="font-weight:500;color:var(--ink-900)">${esc(m)}</span>${BASELINE_NOTES[m] ? `<span class="muted" style="display:block;font-size:12px">Baseline: ${BASELINE_NOTES[m]}</span>` : '<span class="muted" style="display:block;font-size:12px">Machine-learning model</span>'}</td>
                  ${hs.map((h) => {
                    const r = h.results[m];
                    const isBest = r.mae === best(h);
                    return `<td class="right num ${isBest ? 'cell-best' : ''}">${fmt(r.mae, 2)}<span class="muted" style="display:block;font-size:12px">R² ${fmt(r.r2, 2)}</span></td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <div class="grid halves">
        <section class="card card-padded prose">
          <h2 style="font-size:16px;margin-bottom:12px">Read this before trusting the numbers</h2>
          <p>Every score here comes from <strong>flocks the model never saw</strong>: it is trained on 8 flocks and tested on the 9th, nine times over. A random split would let it peek, because weeks of the same flock are alike.</p>
          <p>The models beat every simple rule a farmer could use, clearly at 1 and 4 weeks. At 8 weeks the margin over the breed standard is small - far-off forecasts are hard.</p>
          <p>The data comes from <strong>one farm in Colombia</strong> (9 flocks, 2003–2015). Kenyan flocks, other breeds or other housing may behave differently, so the engine should be retrained on local records before anyone relies on it.</p>
          <p>The models lean on the flock’s <strong>recent laying</strong> for next week, and shift to <strong>age and the breed curve</strong> for two months out. Feed and mortality add little in this data: feed per hen hardly varied on this farm.</p>
        </section>
        <section class="card card-padded prose">
          <h2 style="font-size:16px;margin-bottom:12px">How the agent uses it</h2>
          <p>Each week the agent asks the models where the flock’s laying rate is heading in <strong>1, 4 and 8 weeks</strong>, then applies its rules:</p>
          <p>flag a flock more than 5 points <strong>below the breed standard</strong> (and say whether it is expected to recover), give an <strong>early warning</strong> when a flock on track today is forecast to fall behind, flag weekly <strong>mortality</strong> above 0.5%, and flag <strong>feed per dozen eggs</strong> above 2 kg.</p>
          <p>The 1-week forecast also gives the ERP the number of eggs to expect next week, for sales and packing.</p>
          <p class="muted" style="font-size:12px">Data: <a href="${esc(info.data_source.url)}" target="_blank" rel="noopener">${esc(info.data_source.citation)}</a> ${esc(info.data_source.licence)}.</p>
        </section>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ router
const ROUTES = { review: renderReview, model: renderModel };

function route() {
  const name = (location.hash.replace(/^#\/?/, '') || 'review').split('?')[0];
  const render = ROUTES[name] || renderReview;
  document.querySelectorAll('.nav a').forEach((a) => {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  closeDrawer();
  const view = document.getElementById('view');
  view.style.animation = 'none';
  void view.offsetWidth; // restart the fade-in, like the ERPs' keyed <main>
  view.style.animation = '';
  render(view);
  window.scrollTo(0, 0);
}

// ----------------------------------------------------------- shell + start
const drawer = document.querySelector('[data-drawer]');
function closeDrawer() { drawer.hidden = true; }

function buildShell() {
  const template = document.getElementById('sidebar-template');
  document.querySelectorAll('[data-sidebar]').forEach((slot) => {
    slot.appendChild(template.content.cloneNode(true));
  });
  hydrateIcons(document.body);
  document.querySelector('[data-open-drawer]').onclick = () => { drawer.hidden = false; };
  document.querySelectorAll('[data-close-drawer]').forEach((el) => { el.onclick = closeDrawer; });
}

async function checkModel() {
  const chips = document.querySelectorAll('[data-model-chip]');
  try {
    const info = await api('/model');
    chips.forEach((chip) => {
      chip.classList.add('ok');
      chip.querySelector('[data-model-text]').textContent = `Model ready · ${info.n_flocks} flocks`;
    });
  } catch {
    chips.forEach((chip) => {
      chip.classList.add('down');
      chip.querySelector('[data-model-text]').textContent = 'No model - run training';
    });
  }
}

buildShell();
window.addEventListener('hashchange', route);
route();
checkModel();

// ?demo loads the sample flock and runs the review straight away - handy for a
// presentation or a screenshot.
if (new URLSearchParams(location.search).has('demo') && (location.hash === '' || location.hash === '#/review')) {
  api('/sample-flock').then((sample) => {
    flock = { flock_id: sample.flock_id, weeks: sample.weeks };
    sampleNote = sample.note;
    const view = document.getElementById('view');
    renderReview(view);
    runReview(view);
  });
}

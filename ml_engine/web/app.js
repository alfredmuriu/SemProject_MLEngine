/* FlockWise web app - one page that talks to the ML engine API on the same origin.
   Plain JS, no build step.

   Everything works on one list of weekly records (flock.weeks). The form at the
   top edits the latest three weeks - all the model needs - and the optional table
   below edits the whole list. */

// Lucide icon paths (the icon set the ERPs use), inlined so the app works offline.
const ICONS = {
  bird: '<path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/>',
  trend: '<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 0) => (n == null ? '—' : Number(n).toLocaleString('en-KE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (n) => (n == null ? '—' : `${fmt(n, 1)}%`);
const $ = (sel) => document.querySelector(sel);

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error((Array.isArray(d) ? d.map((x) => `${x.loc.slice(-2).join(' ')}: ${x.msg}`).join('; ') : d) || `Request failed (${res.status})`);
  }
  return data;
}

// ------------------------------------------------------------------ state
let flock = { flock_id: 'House 1', weeks: [] };
let note = '';
let review = null;
let modelInfo = null;
let curve = [];

// The form's fields. `week` is how many weeks back the value belongs to.
const FORM = [
  { id: 'age', label: 'Flock age this week', unit: 'weeks', placeholder: 'e.g. 30', hint: '21 to 70 weeks' },
  { id: 'hens', label: 'Hens alive', unit: 'birds', placeholder: 'e.g. 1500' },
  { id: 'feed', label: 'Feed used this week (whole flock)', unit: 'kg', placeholder: 'e.g. 1260', hint: 'Total for all hens, not per bird' },
  { id: 'deaths', label: 'Deaths + culls this week', unit: 'birds', placeholder: 'optional' },
  { id: 'eggs0', label: 'Eggs collected this week', unit: 'eggs', placeholder: 'e.g. 9400' },
  { id: 'eggs1', label: 'Eggs collected last week', unit: 'eggs', placeholder: 'e.g. 9500' },
  { id: 'eggs2', label: 'Eggs collected 2 weeks ago', unit: 'eggs', placeholder: 'e.g. 9550' },
];

// ------------------------------------------------------------------- page
function buildPage() {
  $('#app').innerHTML = `
    <div class="page-header">
      <div>
        <div class="eyebrow">Weekly flock review</div>
        <h1>How is the flock laying?</h1>
        <p class="lead">Enter this week’s numbers for a flock. FlockWise compares it with the breed standard, forecasts the next 8 weeks and says what to do.</p>
      </div>
      <div class="actions"><button class="btn btn-secondary" data-sample>${icon('download')}Load sample flock</button></div>
    </div>
    <div class="stack">
      <form class="card" data-form novalidate>
        <header class="card-header">
          <div><h2>This week’s records</h2><p class="sub">The model needs the last three weeks of eggs. Everything else is from this week.</p></div>
          <div class="actions">
            <input class="field flock-name" data-flock-id aria-label="Flock name">
            <button class="btn btn-secondary btn-sm" type="button" data-clear>Clear</button>
          </div>
        </header>
        <div class="form-grid">
          ${FORM.map((f) => `
            <label class="form-field">
              <span class="field-label">${f.label}</span>
              <span class="field-unit"><input class="field num" name="${f.id}" type="number" min="0" step="any" placeholder="${f.placeholder}"><span>${f.unit}</span></span>
              ${f.hint ? `<span class="field-hint" data-hint="${f.id}">${f.hint}</span>` : ''}
            </label>`).join('')}
          <div class="form-submit"><button class="btn btn-primary" type="submit">${icon('trend')}Show forecast</button></div>
        </div>
      </form>
      <div data-error></div>
      <div data-results></div>
      <section class="card" data-records></section>
      <div data-footer></div>
    </div>`;

  $('[data-sample]').onclick = loadSample;
  $('[data-form]').onsubmit = (e) => { e.preventDefault(); submitForm(); };
  $('[data-flock-id]').oninput = (e) => { flock.flock_id = e.target.value; };
  $('[data-form]').addEventListener('input', feedHint);
  $('[data-clear]').onclick = () => {
    flock = { flock_id: 'House 1', weeks: [] };
    note = ''; review = null;
    showError(''); fillForm(); drawRecords(); drawResults(); drawFooter();
  };
  fillForm();
  drawRecords();
}

// The form shows the latest three weeks of the records.
function fillForm() {
  const form = $('[data-form]');
  const w = flock.weeks;
  const at = (back) => w[w.length - 1 - back];
  const set = (name, value) => { form.elements[name].value = value ?? ''; };
  set('age', at(0)?.age_weeks);
  set('hens', at(0)?.hens);
  set('feed', at(0)?.feed_kg);
  set('deaths', at(0)?.deaths);
  [0, 1, 2].forEach((back) => set(`eggs${back}`, at(back)?.eggs));
  $('[data-flock-id]').value = flock.flock_id;
  feedHint();
}

// Shows the feed per hen per day as it is typed, so a per-bird amount
// entered by mistake is obvious straight away.
function feedHint() {
  const form = $('[data-form]');
  const feed = Number(form.elements.feed.value);
  const hens = Number(form.elements.hens.value);
  const perHen = (1000 * feed) / hens / 7;
  $('[data-hint="feed"]').textContent = feed > 0 && hens > 0
    ? `≈ ${fmt(perHen)} g per hen per day${perHen < 50 ? ' - very low; is this the total for all hens?' : ''}`
    : 'Total for all hens, not per bird';
}

function submitForm() {
  const form = $('[data-form]');
  const v = Object.fromEntries(FORM.map((f) => [f.id, form.elements[f.id].value === '' ? null : Number(form.elements[f.id].value)]));
  const missing = FORM.filter((f) => f.id !== 'deaths' && v[f.id] == null).map((f) => f.label.toLowerCase());
  if (missing.length) return showError(`Fill in ${missing.join(', ')}.`);
  if (v.age < 21 || v.age > 70) return showError('Flock age must be between 21 and 70 weeks - the ages the model was trained on.');
  if (v.hens <= 0) return showError('Hens alive must be more than 0.');

  const latest = flock.weeks[flock.weeks.length - 1];
  if (flock.weeks.length >= 3 && latest.age_weeks === v.age) {
    // same flock, same week: update the latest three weeks and keep the earlier history
    const w = flock.weeks;
    const n = w.length;
    Object.assign(w[n - 1], { hens: v.hens, feed_kg: v.feed, deaths: v.deaths ?? '', eggs: v.eggs0 });
    w[n - 2].eggs = v.eggs1;
    w[n - 3].eggs = v.eggs2;
  } else {
    // a different age means a different flock or week: start fresh from the form,
    // rather than shifting old history to ages it never had (hens laying at 15 weeks).
    // Hens and feed are assumed steady over the three weeks.
    note = '';
    flock.weeks = [2, 1, 0].map((back) => ({
      age_weeks: v.age - back, hens: v.hens, feed_kg: v.feed,
      eggs: v[`eggs${back}`], deaths: v.deaths == null ? '' : back ? 0 : v.deaths,
    }));
  }
  drawRecords();
  runReview();
}

function showError(message) {
  $('[data-error]').innerHTML = message ? `<div class="note error">${icon('alert')}<span>${esc(message)}</span></div>` : '';
}

// ---------------------------------------------------------------- actions
async function loadSample() {
  try {
    const sample = await api('/sample-flock');
    flock = { flock_id: sample.flock_id, weeks: sample.weeks };
    note = sample.note;
    review = null;
    showError('');
    fillForm();
    drawRecords();
    drawResults();
    drawFooter();
  } catch (err) { showError(err.message); }
}

async function runReview() {
  const missing = flock.weeks.filter((w) => ['age_weeks', 'hens', 'eggs', 'feed_kg'].some((k) => w[k] === '' || w[k] == null));
  if (flock.weeks.length < 3) return showError('Enter at least 3 consecutive weeks of records.');
  if (missing.length) return showError(`Age, hens, eggs and feed are needed every week - missing in week ${missing.map((w) => w.age_weeks || '?').join(', ')}.`);

  // deaths go in only if every week has them; otherwise the engine works them out
  const allDeaths = flock.weeks.every((w) => w.deaths !== '' && w.deaths != null);
  const weeks = flock.weeks.map(({ age_weeks, hens, eggs, feed_kg, deaths }) => (
    allDeaths ? { age_weeks, hens, eggs, feed_kg, deaths } : { age_weeks, hens, eggs, feed_kg }));
  try {
    review = await api('/flock/review', { flock_id: flock.flock_id || null, weeks });
    showError('');
    drawResults();
    drawFooter();
    $('[data-results]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) { showError(err.message); }
}

// ---------------------------------------------------------------- results
function drawResults() {
  const host = $('[data-results]');
  if (!review) { host.innerHTML = ''; return; }
  const { latest: l, forecasts, actions, flags, expected_eggs_next_week: eggs } = review;
  const ahead = forecasts.find((f) => f.horizon_weeks === 4) || forecasts[forecasts.length - 1];
  // when the agent says the records look wrong, nothing gets a good/bad colour
  const suspect = flags.includes('check_records');
  const tone = (gap) => (gap == null || suspect ? '' : gap < -5 ? 'negative' : gap >= 0 ? 'positive' : '');
  const vsStandard = (gap, std) => (std == null ? 'no breed standard at this age' : `${gap >= 0 ? '+' : '−'}${fmt(Math.abs(gap), 1)} points against the standard of ${pct(std)}`);

  host.innerHTML = `
    <div class="stack">
      <div class="card stat-row">
        <div class="stat">
          <p class="micro">This week · week ${l.age_weeks}</p>
          <p class="stat-value num ${tone(l.gap)}">${pct(l.lay_rate)}</p>
          <p class="stat-hint">of hens laid each day · ${vsStandard(l.gap, l.standard)}</p>
        </div>
        <div class="stat">
          <p class="micro">Forecast · week ${ahead ? ahead.age_weeks : '—'}</p>
          <p class="stat-value num ${ahead ? tone(ahead.gap) : ''}">${ahead ? pct(ahead.lay_rate) : '—'}</p>
          <p class="stat-hint">${suspect ? 'unreliable - check the records first' : ahead ? `likely ${fmt(ahead.low, 1)}–${fmt(ahead.high, 1)}% · ${vsStandard(ahead.gap, ahead.standard)}` : 'past the ages the model was trained on'}</p>
        </div>
        <div class="stat">
          <p class="micro">Eggs expected next week</p>
          <p class="stat-value num">${fmt(eggs)}</p>
          <p class="stat-hint">from ${fmt(l.hens)} hens · ${fmt(l.eggs)} collected this week</p>
        </div>
      </div>
      <div class="grid split">
        <section class="card">
          <header class="card-header">
            <div><h2>Laying rate against the breed standard</h2><p class="sub">${esc(review.flock_id || 'Flock')} · % of hens laying per day · forecasts show the range 80% of past forecasts fell in</p></div>
          </header>
          <div class="legend">
            <span><i class="key"></i>Recorded</span><span><i class="key key-standard"></i>Breed standard</span><span><i class="key key-forecast"></i>Forecast</span>
          </div>
          <div class="chart" data-chart></div>
        </section>
        <section class="card">
          <header class="card-header"><div><h2>What to do</h2></div>${flags.length ? '' : '<span class="badge"><span class="pip"></span>On track</span>'}</header>
          <ul class="action-list">
            ${actions.map((a) => {
              const ok = a.startsWith('No action');
              return `<li><span class="action-icon ${ok ? 'success' : 'danger'}">${icon(ok ? 'check' : 'alert')}</span><span>${esc(a)}</span></li>`;
            }).join('')}
          </ul>
        </section>
      </div>
    </div>`;
  drawChart(host.querySelector('[data-chart]'));
}

// ---------------------------------------------------------------- records
const COLUMNS = [['age_weeks', 'Age (weeks)'], ['hens', 'Hens alive'], ['eggs', 'Eggs collected'], ['feed_kg', 'Feed used (kg)'], ['deaths', 'Deaths + culls']];

function drawRecords() {
  const host = $('[data-records]');
  const wasOpen = host.querySelector('details')?.open ?? false;
  host.innerHTML = `
    <details ${wasOpen ? 'open' : ''}>
      <summary class="card-header">
        <div><h2>All weekly records · ${flock.weeks.length} ${flock.weeks.length === 1 ? 'week' : 'weeks'}</h2><p class="sub">Optional. Add earlier weeks to give the chart more history.</p></div>
      </summary>
      <div class="records-bar">
        <button class="btn btn-secondary btn-sm" type="button" data-add>${icon('plus')}Add earlier week</button>
        <button class="btn btn-secondary btn-sm" type="button" data-rerun>${icon('trend')}Update forecast</button>
      </div>
      <div class="table-wrap" style="max-height:420px;overflow-y:auto">
        <table class="wide entry">
          <thead><tr>${COLUMNS.map(([, label]) => `<th>${label}</th>`).join('')}<th class="right">Laying rate</th><th></th></tr></thead>
          <tbody>
            ${flock.weeks.map((w, i) => `
              <tr data-row="${i}">
                ${COLUMNS.map(([key, label]) => `<td><input class="field num" data-key="${key}" type="number" min="0" step="any" value="${esc(w[key])}" aria-label="${label}, row ${i + 1}"></td>`).join('')}
                <td class="right num" data-rate>${rate(w)}</td>
                <td class="right"><button class="icon-btn" type="button" data-remove aria-label="Remove row ${i + 1}">${icon('trash')}</button></td>
              </tr>`).join('') || '<tr><td colspan="7" class="muted">Nothing yet - fill in the form above, or load the sample flock.</td></tr>'}
          </tbody>
        </table>
      </div>
    </details>`;

  host.querySelector('[data-add]').onclick = () => {
    const first = flock.weeks[0];
    flock.weeks.unshift(first ? { ...first, age_weeks: first.age_weeks - 1, eggs: '', deaths: '' }
      : { age_weeks: '', hens: '', eggs: '', feed_kg: '', deaths: '' });
    drawRecords();
  };
  host.querySelector('[data-rerun]').onclick = runReview;
  host.querySelectorAll('tr[data-row]').forEach((row) => {
    const week = flock.weeks[Number(row.dataset.row)];
    row.querySelectorAll('input').forEach((input) => {
      input.oninput = () => {
        week[input.dataset.key] = input.value === '' ? '' : Number(input.value);
        row.querySelector('[data-rate]').innerHTML = rate(week);
        fillForm();
      };
    });
    row.querySelector('[data-remove]').onclick = () => { flock.weeks.splice(Number(row.dataset.row), 1); drawRecords(); fillForm(); };
  });
}

// share of hens laying per day, the same sum the engine does
function rate(w) {
  return w.hens > 0 && w.eggs !== '' && w.eggs != null ? pct((100 * w.eggs) / w.hens / 7) : '<span class="muted">—</span>';
}

// ----------------------------------------------------------------- footer
function drawFooter() {
  if (!modelInfo) return;
  const err = (h) => {
    const x = modelInfo.horizons.find((y) => y.horizon_weeks === h);
    return x ? fmt(x.results[x.model].mae, 1) : '—';
  };
  $('[data-footer]').innerHTML = `
    <p class="footnote">
      On flocks it never saw, the forecast was off by ${err(1)} points on average one week ahead and ${err(4)} points four weeks ahead,
      better than following the breed guide. Trained on ${modelInfo.n_flocks} flocks:
      <a href="${esc(modelInfo.data_source.url)}" target="_blank" rel="noopener">Cabezas-García et al., 2024</a> (${esc(modelInfo.data_source.licence)}).
      ${note ? `<br>${esc(note)} The model was trained on this flock, so its forecasts here look better than they would for a new one.` : ''}
    </p>`;
}

// ------------------------------------------------------------------ chart
// Recorded laying rate, the breed standard and labelled forecasts on one age
// axis, drawn at the container's real width so text stays at its true size.
function drawChart(host) {
  const { history, forecasts } = review;
  const W = Math.max(280, host.clientWidth - 48);
  const H = W < 560 ? 240 : 300;
  const M = { t: 24, r: 24, b: 32, l: 40 };
  const ages = [...history, ...forecasts].map((p) => p.age_weeks);
  const lo = Math.min(...ages), hi = Math.max(...ages);
  const x = (a) => M.l + ((a - lo) / Math.max(1, hi - lo)) * (W - M.l - M.r);
  const y = (v) => M.t + (1 - Math.min(v, 105) / 105) * (H - M.t - M.b);
  const path = (pts, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.age_weeks).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');
  const last = history[history.length - 1];
  const step = hi - lo > 30 ? 10 : hi - lo > 12 ? 5 : 2;
  const ticks = [];
  for (let a = Math.ceil(lo / step) * step; a <= hi; a += step) ticks.push(a);

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The flock's weekly laying rate against the breed standard, with forecasts for the coming weeks">
      ${[0, 25, 50, 75, 100].map((t) => `<line class="grid-line" x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis-label" x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end">${t}%</text>`).join('')}
      ${ticks.map((t) => `<text class="axis-label" x="${x(t)}" y="${H - 10}" text-anchor="middle">${t} wk</text>`).join('')}
      <rect class="gap-band" x="${x(last.age_weeks)}" y="${M.t}" width="${Math.max(0, x(hi) - x(last.age_weeks))}" height="${H - M.t - M.b}"/>
      <path class="standard" d="${path(curve.filter((p) => p.age_weeks >= lo && p.age_weeks <= hi), 'standard')}"/>
      <path class="series" d="${path(history, 'lay_rate')}"/>
      ${history.map((p) => `<circle class="history-dot" cx="${x(p.age_weeks)}" cy="${y(p.lay_rate)}" r="${history.length <= 6 ? 3 : 0}"/>`).join('')}
      ${forecasts.length ? `<path class="forecast-line" d="${path([last, ...forecasts], 'lay_rate')}"/>` : ''}
      ${forecasts.map((f) => `
        <line class="whisker" x1="${x(f.age_weeks)}" x2="${x(f.age_weeks)}" y1="${y(f.low)}" y2="${y(f.high)}"/>
        <circle class="forecast-dot" cx="${x(f.age_weeks)}" cy="${y(f.lay_rate)}" r="4.5"><title>${f.horizon_weeks} wk ahead: ${pct(f.lay_rate)} (${fmt(f.low, 1)}–${fmt(f.high, 1)}%)</title></circle>
        <text class="point-label" x="${x(f.age_weeks)}" y="${y(f.low) + 16}" text-anchor="middle">${fmt(f.lay_rate, 0)}%</text>`).join('')}
    </svg>`;
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { const host = $('[data-chart]'); if (host && review) drawChart(host); }, 150);
});

// ------------------------------------------------------------------ start
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
buildPage();

const ready = Promise.all([api('/model'), api('/standard-curve')]).then(([info, std]) => {
  modelInfo = info;
  curve = std;
  $('[data-model-chip]').classList.add('ok');
  $('[data-model-text]').textContent = `Model ready · ${info.n_flocks} flocks`;
  drawFooter();
  if (review) drawResults(); // redraw the chart with the breed curve
}).catch(() => {
  $('[data-model-chip]').classList.add('down');
  $('[data-model-text]').textContent = 'No model - run training';
});

// ?demo loads the sample flock and shows its forecast straight away - handy for a presentation.
if (new URLSearchParams(location.search).has('demo')) ready.then(loadSample).then(runReview);

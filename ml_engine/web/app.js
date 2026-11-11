/* FlockWise web app - talks to the ML engine API served from the same origin.
   Plain JS, no build step: three views switched by the URL hash. */

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
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
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
      ? data.detail.map((d) => `${d.loc.slice(-1)[0]}: ${d.msg}`).join('; ')
      : data.detail;
    throw new Error(detail || `Request failed (${response.status})`);
  }
  return data;
}

const FLAGS = {
  missed_lay: { label: 'Missed lay', tone: 'danger', icon: 'alert' },
  end_of_lay_soon: { label: 'Ending soon', tone: 'warning', icon: 'clock' },
  not_expected_to_lay: { label: 'Not laying', tone: 'neutral', icon: 'ban' },
};

const badge = (label, tone) => `<span class="badge badge-${tone}"><span class="pip"></span>${esc(label)}</span>`;

function statusBadges(flags) {
  if (!flags.length) return badge('On track', 'success');
  return `<div class="badges">${flags.map((f) => badge(FLAGS[f].label, FLAGS[f].tone)).join('')}</div>`;
}

const meter = (value) => `
  <div class="meter" title="${fmt(value, 3)} expected eggs">
    <div class="meter-track"><div class="meter-fill" style="width:${Math.round(value * 100)}%"></div></div>
    <span class="meter-value num">${fmt(value, 2)}</span>
  </div>`;

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
  if (text.startsWith('Check ')) return ['alert', 'danger'];
  if (text.includes('stop laying within')) return ['clock', 'warning'];
  if (text.includes('not expected to lay')) return ['ban', 'neutral'];
  if (text.startsWith('Flock collected')) return ['users', 'warning'];
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
const BREEDS = ['Marans', 'Ameraucana'];

// Rows keep every field they arrive with (the sample flock carries plumage,
// egg colour and so on), even though the table only edits the main ones.
let flock = [];
let lastReview = null;

const blankBird = () => ({ GallusID: `Hen-${String(flock.length + 1).padStart(2, '0')}`, GallusBreed: 'Marans', Age: '', AmountOfFeed: '', EggsCollected: null });

function renderReview(view) {
  view.innerHTML = `
    ${pageHeader('Daily review', 'Today’s flock',
      'Enter what was collected from each bird today. The agent compares it with what the model expected and recommends what to do.',
      `<button class="btn btn-secondary" data-load-sample>${icon('download')}Load sample flock</button>
       <button class="btn btn-primary" data-run>${icon('play')}Run review</button>`)}
    <div class="stack">
      <section class="card">
        <header class="card-header">
          <div><h2>Birds</h2><p class="sub">Only ID and age are required. Leave “collected” blank if it wasn’t recorded.</p></div>
          <button class="btn btn-secondary btn-sm" data-add>${icon('plus')}Add bird</button>
        </header>
        <div data-entry></div>
      </section>
      <div data-results></div>
    </div>`;

  view.querySelector('[data-add]').onclick = () => { flock.push(blankBird()); drawEntry(view); };
  view.querySelector('[data-load-sample]').onclick = async () => {
    try {
      flock = await api('/sample-flock');
      lastReview = null;
      drawEntry(view);
      drawResults(view);
    } catch (err) {
      view.querySelector('[data-results]').innerHTML = errorNote(err.message);
    }
  };
  view.querySelector('[data-run]').onclick = () => runReview(view);

  if (!flock.length) flock = [blankBird()];
  drawEntry(view);
  drawResults(view);
}

function drawEntry(view) {
  const host = view.querySelector('[data-entry]');
  if (!flock.length) {
    host.innerHTML = `
      <div class="empty">
        <div class="empty-icon">${icon('egg')}</div>
        <div><h3>No birds yet</h3><p>Add birds one by one, or load the sample flock to see the agent at work.</p></div>
      </div>`;
    return;
  }
  const breedOptions = (current) => {
    const options = BREEDS.includes(current) || !current ? BREEDS : [...BREEDS, current];
    return options.map((b) => `<option ${b === current ? 'selected' : ''}>${esc(b)}</option>`).join('');
  };
  host.innerHTML = `
    <div class="table-wrap">
      <table class="wide entry">
        <thead><tr>
          <th>Bird ID</th><th>Breed</th><th>Age (days)</th><th>Feed today (g)</th><th>Eggs collected</th><th><span class="sr-only">Remove</span></th>
        </tr></thead>
        <tbody>
          ${flock.map((b, i) => `
            <tr data-row="${i}">
              <td><input class="field field-sm" data-key="GallusID" value="${esc(b.GallusID)}" aria-label="Bird ID"></td>
              <td><select class="field field-sm" data-key="GallusBreed" aria-label="Breed">${breedOptions(b.GallusBreed)}</select></td>
              <td><input class="field field-sm num" data-key="Age" type="number" min="0" value="${esc(b.Age)}" placeholder="e.g. 420" aria-label="Age in days"></td>
              <td><input class="field field-sm num" data-key="AmountOfFeed" type="number" min="0" value="${esc(b.AmountOfFeed)}" placeholder="e.g. 115" aria-label="Feed in grams"></td>
              <td>
                <select class="field field-sm" data-key="EggsCollected" aria-label="Eggs collected">
                  <option value="" ${b.EggsCollected == null ? 'selected' : ''}>Not recorded</option>
                  <option value="1" ${b.EggsCollected === 1 ? 'selected' : ''}>1 egg</option>
                  <option value="0" ${b.EggsCollected === 0 ? 'selected' : ''}>None</option>
                </select>
              </td>
              <td class="right"><button class="icon-btn" data-remove aria-label="Remove ${esc(b.GallusID)}">${icon('trash')}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  host.querySelectorAll('tr[data-row]').forEach((row) => {
    const bird = flock[Number(row.dataset.row)];
    row.querySelectorAll('[data-key]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.key;
        if (key === 'GallusID' || key === 'GallusBreed') bird[key] = input.value;
        else if (key === 'EggsCollected') bird[key] = input.value === '' ? null : Number(input.value);
        else bird[key] = input.value === '' ? '' : Number(input.value);
      });
    });
    row.querySelector('[data-remove]').onclick = () => {
      flock.splice(Number(row.dataset.row), 1);
      drawEntry(view);
    };
  });
}

function birdPayload(b) {
  // Empty inputs are left out so the model's imputers fill them, rather than
  // being sent as 0.
  const out = {};
  for (const [key, value] of Object.entries(b)) {
    if (value !== '' && value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

async function runReview(view) {
  const results = view.querySelector('[data-results]');
  const missingAge = flock.filter((b) => b.Age === '' || b.Age == null).map((b) => b.GallusID || '(no ID)');
  if (!flock.length) { results.innerHTML = errorNote('Add at least one bird first.'); return; }
  if (missingAge.length) { results.innerHTML = errorNote(`Every bird needs an age - missing for ${missingAge.join(', ')}.`); return; }

  const button = view.querySelector('[data-run]');
  button.disabled = true;
  try {
    lastReview = await api('/flock/review', flock.map(birdPayload));
    drawResults(view);
  } catch (err) {
    results.innerHTML = errorNote(err.message);
  } finally {
    button.disabled = false;
  }
}

function drawResults(view) {
  const host = view.querySelector('[data-results]');
  if (!lastReview) {
    host.innerHTML = `
      <section class="card">
        <div class="empty">
          <div class="empty-icon">${icon('clipboard')}</div>
          <div><h3>No review yet</h3><p>Run the review to see expected eggs, the gap against what was collected, and what the agent recommends.</p></div>
        </div>
      </section>`;
    return;
  }

  const { summary: s, actions, birds, lookahead_days: days } = lastReview;
  const flagged = birds.filter((b) => b.flags.length).length;
  const shortfallTone = s.unexplained_shortfall == null ? '' : s.unexplained_shortfall >= 1 ? 'negative' : 'positive';

  host.innerHTML = `
    <div class="stack">
      <div class="stat-grid">
        ${stat('Expected eggs', fmt(s.expected_eggs, 1), 'egg', `across ${s.birds} ${s.birds === 1 ? 'bird' : 'birds'}`)}
        ${stat('Collected', fmt(s.eggs_collected), 'clipboard',
          s.eggs_collected == null ? 'not every bird was recorded' : `shortfall of ${fmt(s.shortfall, 1)} against expected`)}
        ${stat('Birds flagged', fmt(flagged), 'alert', flagged ? 'see the actions below' : 'every bird on track', flagged ? 'warning' : 'positive')}
        ${stat('Feed per egg', s.feed_g_per_egg == null ? '—' : `${fmt(s.feed_g_per_egg)} g`, 'package',
          s.feed_g == null ? 'feed not recorded for every bird' : `${fmt(s.feed_g)} g fed today`)}
      </div>

      <div class="grid split">
        <section class="card">
          <header class="card-header"><div><h2>Recommended actions</h2><p class="sub">What the agent concluded from today’s records</p></div></header>
          ${actionList(actions)}
        </section>
        <section class="card card-padded">
          <h2 style="font-size:16px">Flock-wide check</h2>
          <p class="stat-hint" style="margin-top:4px">Shortfall the per-bird flags don’t explain</p>
          <p class="stat-value num ${shortfallTone}" style="margin-top:16px">${fmt(s.unexplained_shortfall, 1)}</p>
          <div class="kv" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--ink-100)">
            <div><p class="micro">Total shortfall</p><p class="num">${fmt(s.shortfall, 1)}</p></div>
            <div><p class="micro">Feed on non-layers</p><p class="num">${fmt(s.feed_g_on_non_layers)} g</p></div>
          </div>
        </section>
      </div>

      <section class="card">
        <header class="card-header"><div><h2>Bird by bird</h2><p class="sub">Expected eggs today and ${days} days from now, from the model</p></div></header>
        <div class="table-wrap">
          <table class="wide">
            <thead><tr><th>Bird</th><th>Expected today</th><th>In ${days} days</th><th class="right">Collected</th><th>Status</th></tr></thead>
            <tbody>
              ${birds.map((b) => `
                <tr>
                  <td><span style="font-weight:500;color:var(--ink-900)">${esc(b.GallusID)}</span></td>
                  <td>${meter(b.expected_eggs)}</td>
                  <td>${meter(b.expected_eggs_later)}</td>
                  <td class="right num">${b.eggs_collected == null ? '<span class="muted">—</span>' : fmt(b.eggs_collected)}</td>
                  <td>${statusBadges(b.flags)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>`;
}

// ---------------------------------------------------------- predict a bird
const OPTIONS = {
  GallusEggColor: ['Brown', 'Light Blue', 'Bluish-Green'],
  GallusCombType: ['Single', 'Pea'],
  GallusPlumage: ['Blue', 'Splash', 'Splash Copper', 'Blue Copper', 'Blue Wheaten', 'Black', 'Buff', 'Brown Red', 'White', 'Silver'],
  GallusLegShanksColor: ['White', 'Slate Blue', 'Slate Black'],
  GallusBeakColor: ['White', 'Brown'],
};

const selectField = (name, label, options, blank = 'Not recorded') => `
  <div><label class="field-label" for="${name}">${label}</label>
    <select class="field" id="${name}" name="${name}"><option value="">${blank}</option>${options.map((o) => `<option>${o}</option>`).join('')}</select>
  </div>`;

const numberField = (name, label, placeholder, hint = '', required = false) => `
  <div><label class="field-label" for="${name}">${label}</label>
    <input class="field num" id="${name}" name="${name}" type="number" min="0" step="any" placeholder="${placeholder}" ${required ? 'required' : ''}>
    ${hint ? `<p class="field-hint">${hint}</p>` : ''}
  </div>`;

function renderPredict(view) {
  view.innerHTML = `
    ${pageHeader('Single bird', 'Predict a bird’s lay',
      'Enter what you know about one bird. The model fills anything you leave blank and the agent checks it the same way it checks a flock.')}
    <div class="grid split">
      <section class="card card-padded">
        <form data-form class="form-grid cols-3" novalidate>
          <div><label class="field-label" for="GallusID">Bird ID</label><input class="field" id="GallusID" name="GallusID" value="Hen-01"></div>
          <div><label class="field-label" for="GallusBreed">Breed</label>
            <select class="field" id="GallusBreed" name="GallusBreed">${BREEDS.map((b) => `<option>${b}</option>`).join('')}</select></div>
          ${numberField('Age', 'Age (days)', 'e.g. 420', 'Required - the model’s main input', true)}
          ${numberField('AmountOfFeed', 'Feed today (g)', 'e.g. 115')}
          ${numberField('GallusWeight', 'Body weight (g)', 'e.g. 2200')}
          ${numberField('SunLightExposure', 'Light (hours)', 'e.g. 8')}
          <div><label class="field-label" for="EggsCollected">Eggs collected today</label>
            <select class="field" id="EggsCollected" name="EggsCollected"><option value="">Not recorded</option><option value="1">1 egg</option><option value="0">None</option></select></div>
          <details class="more">
            <summary>More attributes (optional)</summary>
            <div class="form-grid cols-3">
              ${numberField('GallusEggWeight', 'Egg weight (g)', 'e.g. 44')}
              ${selectField('GallusEggColor', 'Egg colour', OPTIONS.GallusEggColor)}
              ${selectField('GallusCombType', 'Comb type', OPTIONS.GallusCombType)}
              ${selectField('GallusPlumage', 'Plumage', OPTIONS.GallusPlumage)}
              ${selectField('GallusLegShanksColor', 'Leg shank colour', OPTIONS.GallusLegShanksColor)}
              ${selectField('GallusBeakColor', 'Beak colour', OPTIONS.GallusBeakColor)}
            </div>
          </details>
          <div style="grid-column:1/-1"><button class="btn btn-primary" type="submit">${icon('target')}Predict</button></div>
        </form>
      </section>
      <section class="card" data-prediction>
        <div class="empty">
          <div class="empty-icon">${icon('egg')}</div>
          <div><h3>No prediction yet</h3><p>Fill in the bird’s age at least, then press Predict.</p></div>
        </div>
      </section>
    </div>`;

  const form = view.querySelector('[data-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const out = view.querySelector('[data-prediction]');
    const data = Object.fromEntries(new FormData(form));
    const bird = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === '') continue;
      bird[key] = ['GallusID', 'GallusBreed', ...Object.keys(OPTIONS)].includes(key) ? value : Number(value);
    }
    if (bird.Age === undefined) { out.innerHTML = `<div style="padding:20px">${errorNote('Enter the bird’s age - it is the model’s main input.')}</div>`; return; }
    bird.GallusID = bird.GallusID || 'Bird';

    try {
      const review = await api('/flock/review', [bird]);
      const b = review.birds[0];
      const actions = review.actions.filter((a) => !a.startsWith('No action'));
      out.innerHTML = `
        <header class="card-header"><div><h2>${esc(b.GallusID)}</h2><p class="sub">${fmt(bird.Age)} days old</p></div>${statusBadges(b.flags)}</header>
        <div class="card-padded">
          <p class="micro">Expected eggs today</p>
          <p class="stat-value num" style="font-size:40px">${fmt(b.expected_eggs, 2)}</p>
          <div style="margin-top:16px">${meter(b.expected_eggs)}</div>
          <div class="kv" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--ink-100)">
            <div><p class="micro">In ${review.lookahead_days} days</p><p class="num">${fmt(b.expected_eggs_later, 2)}</p></div>
            <div><p class="micro">Chance of laying</p><p class="num">${Math.round(b.expected_eggs * 100)}%</p></div>
          </div>
        </div>
        ${actions.length ? `<div style="border-top:1px solid var(--ink-100)">${actionList(actions)}</div>` : ''}`;
    } catch (err) {
      out.innerHTML = `<div style="padding:20px">${errorNote(err.message)}</div>`;
    }
  });
}

// --------------------------------------------------------------- the model
// A typical bird from the training data: the median of each number and the
// most common value of each category. Only age is varied for the chart.
const TYPICAL_BIRD = {
  GallusBreed: 'Marans', GallusWeight: 2170, GallusEggWeight: 43.8, AmountOfFeed: 116, SunLightExposure: 8,
  GallusEggColor: 'Brown', GallusCombType: 'Single', GallusLegShanksColor: 'White', GallusBeakColor: 'White', GallusPlumage: 'Blue',
};
const AGES = Array.from({ length: 111 }, (_, i) => i * 10); // 0 to 1,100 days

const MODEL_NAMES = { RandomForestRegressor: 'Random forest', GradientBoostingRegressor: 'Gradient boosting', LinearRegression: 'Linear regression' };

async function renderModel(view) {
  view.innerHTML = `
    ${pageHeader('The model', 'What the engine learned',
      'How the EggsPerDay model was trained, how well it scored, and - just as important - what those scores do and don’t mean.')}
    <div data-model-body><div class="card"><div class="empty"><p>Loading model details…</p></div></div></div>`;
  const body = view.querySelector('[data-model-body]');

  let info, curve;
  try {
    [info, curve] = await Promise.all([
      api('/model'),
      api('/predict', AGES.map((age) => ({ GallusID: `age-${age}`, Age: age, ...TYPICAL_BIRD }))),
    ]);
  } catch (err) {
    body.innerHTML = errorNote(err.message);
    return;
  }
  const m = info.metrics || {};
  const points = curve.predictions.map((p, i) => ({ age: AGES[i], value: p.expected_eggs }));

  body.innerHTML = `
    <div class="stack">
      <div class="stat-grid">
        ${stat('Model', MODEL_NAMES[info.model] || esc(info.model), 'chart', `scikit-learn ${esc(info.sklearn_version)}`)}
        ${stat('Trained on', `${fmt(info.n_birds)} birds`, 'egg', 'one row per bird, after removing repeated days')}
        ${stat('R² (cross-validated)', fmt(m.r2, 3), 'target', 'repeated stratified 5-fold, 10 repeats')}
        ${stat('Mean absolute error', fmt(m.mae, 4), 'info', 'eggs per bird per day')}
      </div>

      <section class="card">
        <header class="card-header">
          <div><h2>Expected eggs per day, by age</h2><p class="sub">A typical Marans hen with every other attribute held fixed</p></div>
        </header>
        <div class="chart" data-chart></div>
        <div class="table-wrap" data-chart-table hidden style="max-height:320px;overflow-y:auto;border-top:1px solid var(--ink-100)">
          <table><thead><tr><th>Age (days)</th><th class="right">Expected eggs</th></tr></thead>
            <tbody>${points.map((p) => `<tr><td class="num">${fmt(p.age)}</td><td class="right num">${fmt(p.value, 3)}</td></tr>`).join('')}</tbody>
          </table>
        </div>
        <div class="chart-foot"><button class="link-btn" data-toggle-table>Show as table</button></div>
      </section>

      <div class="grid halves">
        <section class="card card-padded prose">
          <h2 style="font-size:16px;margin-bottom:12px">Read this before trusting the numbers</h2>
          <p>The near-perfect score comes from how the dataset was made. In the Kaggle data, <strong>every bird aged 961 days or more lays nothing and every younger bird lays an egg a day</strong>. The model has learned that one cut-off - feed, weight and light have no effect in this data.</p>
          <p>So the scores prove the engine works end to end (encoding, training, evaluation, serving), not that real egg production is this predictable. Real farm records should replace the dataset before anyone acts on these numbers.</p>
        </section>
        <section class="card card-padded prose">
          <h2 style="font-size:16px;margin-bottom:12px">How the agent uses it</h2>
          <p>For each bird the agent asks the model what it should lay <strong>today</strong> and <strong>30 days from now</strong>, then applies four rules: flag a bird that laid nothing when the model was confident it would, warn about birds about to stop, point out birds not expected to lay (and the feed they eat), and raise a flock-wide alarm when the shortfall isn’t explained by individual birds.</p>
          <p>Near the cut-off the random forest gives in-between values rather than a hard 1 → 0 step, which is what makes the 30-day warning possible.</p>
        </section>
      </div>
    </div>`;

  drawChart(body.querySelector('[data-chart]'), points);
  const toggle = body.querySelector('[data-toggle-table]');
  const table = body.querySelector('[data-chart-table]');
  toggle.onclick = () => {
    table.hidden = !table.hidden;
    toggle.textContent = table.hidden ? 'Show as table' : 'Hide table';
  };
}

// Single-series line chart: recessive grid, 2px line, crosshair + tooltip on hover.
// Drawn at the container's real pixel width (and redrawn on resize) so text
// and line weights stay at their true size instead of scaling with the svg.
let redrawChart = null;
window.addEventListener('resize', () => {
  clearTimeout(window.__chartTimer);
  window.__chartTimer = setTimeout(() => redrawChart && redrawChart(), 150);
});

function drawChart(host, points) {
  redrawChart = () => { if (host.isConnected) drawChart(host, points); };
  const W = Math.max(280, host.clientWidth - 48); // 48 = the chart's side padding
  const H = W < 560 ? 220 : 280;
  const M = { top: 12, right: 16, bottom: 32, left: 40 };
  const xMax = 1100;
  const x = (age) => M.left + (age / xMax) * (W - M.left - M.right);
  const y = (v) => M.top + (1 - v) * (H - M.top - M.bottom);

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = W < 560 ? [0, 250, 500, 750, 1000] : [0, 200, 400, 600, 800, 1000];
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.age).toFixed(1)},${y(p.value).toFixed(1)}`).join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart: expected eggs per day stays near 1 until about 950 days of age, then drops to near 0.">
      ${yTicks.map((t) => `<line class="grid-line" x1="${M.left}" x2="${W - M.right}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis-label" x="${M.left - 8}" y="${y(t) + 4}" text-anchor="end">${t}</text>`).join('')}
      ${xTicks.map((t) => `<text class="axis-label" x="${x(t)}" y="${H - 10}" text-anchor="middle">${fmt(t)}</text>`).join('')}
      <rect class="gap-band" x="${x(939)}" y="${M.top}" width="${x(961) - x(939)}" height="${H - M.top - M.bottom}"/>
      <text class="gap-label" x="${x(939) - 6}" y="${M.top + 18}" text-anchor="end">${W < 560 ? 'no data 939–961' : 'no birds observed 939–961 days'}</text>
      <path class="series" d="${path}"/>
      <line class="crosshair" data-cross y1="${M.top}" y2="${H - M.bottom}" visibility="hidden"/>
      <circle class="marker" data-marker r="5" visibility="hidden"/>
      <rect data-hit x="${M.left}" y="0" width="${W - M.left - M.right}" height="${H}" fill="transparent"/>
    </svg>
    <div class="tooltip" data-tip hidden></div>`;

  const svg = host.querySelector('svg');
  const cross = host.querySelector('[data-cross]');
  const marker = host.querySelector('[data-marker]');
  const tip = host.querySelector('[data-tip]');

  const show = (event) => {
    const box = svg.getBoundingClientRect();
    const scale = W / box.width;
    const svgX = (event.clientX - box.left) * scale;
    const age = Math.max(0, Math.min(xMax, ((svgX - M.left) / (W - M.left - M.right)) * xMax));
    const p = points.reduce((best, q) => (Math.abs(q.age - age) < Math.abs(best.age - age) ? q : best));
    cross.setAttribute('x1', x(p.age)); cross.setAttribute('x2', x(p.age));
    marker.setAttribute('cx', x(p.age)); marker.setAttribute('cy', y(p.value));
    cross.setAttribute('visibility', 'visible'); marker.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.innerHTML = `<strong class="num">${fmt(p.value, 3)}</strong>expected eggs at ${fmt(p.age)} days`;
    // the svg sits inside the chart's padding, so offset by where it starts
    const hostBox = host.getBoundingClientRect();
    const px = box.left - hostBox.left + x(p.age) / scale;
    const py = box.top - hostBox.top + y(p.value) / scale;
    const left = px + tip.offsetWidth + 12 > host.clientWidth ? px - tip.offsetWidth - 12 : px + 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, py - tip.offsetHeight - 8)}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden'); marker.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const hit = host.querySelector('[data-hit]');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

// ------------------------------------------------------------------ router
const ROUTES = { review: renderReview, predict: renderPredict, model: renderModel };

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
      chip.querySelector('[data-model-text]').textContent = `Model ready · ${info.n_birds} birds`;
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
  api('/sample-flock').then((birds) => {
    flock = birds;
    const view = document.getElementById('view');
    renderReview(view);
    runReview(view);
  });
}

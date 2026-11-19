// Main interactive chart (Ryan): adapted from our Project 3 line chart.
// Two futures (SSP1-2.6 vs SSP5-8.5), CMIP6 multi-model data, with
// hover tooltips, brush zoom, a 20-year-average toggle, model spread,
// and an adjustable temperature threshold.
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

const SCENARIOS = [
  { key: 'ssp126', code: 'SSP1-2.6', name: 'Low emissions', file: 'SSP126' },
  { key: 'ssp585', code: 'SSP5-8.5', name: 'Very high emissions', file: 'SSP585' },
];
const SSP_KEYS = SCENARIOS.map((d) => d.key);
const ALL_KEYS = ['historical', ...SSP_KEYS];
const META = {
  historical: { key: 'historical', code: 'Historical', name: 'Simulated past' },
  ...Object.fromEntries(SCENARIOS.map((d) => [d.key, d])),
};
const color = (key) => `var(--mv-${key})`;

const PARIS = [1.5, 2];
const WINDOW = 20; // rolling-average length in years (IPCC convention)
const FULL = [1850, 2100];
const LAST_HIST = 2014;
const PRESETS = { all: null, recent: [1950, 2060], future: [2015, 2100] };
const MISSING = 999999;

const fmtSigned = d3.format('+.2f');
const fmt1 = d3.format('.1f');
const fmtTick = (d) => (d === 0 ? '0°' : d3.format('+~g')(d) + '°');

const state = {
  visible: new Set(SSP_KEYS),
  measure: 'annual', // 'annual' | 'smooth'
  spread: 'range', // 'mean' | 'range' | 'models'
  domain: FULL.slice(),
  threshold: 2,
  highlight: null,
};

// ---------------------------------------------------------------- data

async function loadScenario(file) {
  const [modelsTxt, valuesTxt] = await Promise.all([
    d3.text(`data/models_CMIP6_hist_${file}.csv`),
    d3.text(`data/gsat_anom_model_ensemble_means_CMIP6_hist_${file}.csv`),
  ]);
  const models = modelsTxt.trim().split(/\r?\n/).map((s) => s.trim());
  const matrix = d3.csvParseRows(valuesTxt.trim(), (row) =>
    row.map((v) => {
      const n = +v;
      return !Number.isFinite(n) || n >= MISSING ? NaN : n;
    })
  );
  return { models, matrix };
}

// Centered 20-year mean (years y-10 .. y+9); the window shrinks at the ends of the record.
function rolling(values) {
  const half = WINDOW / 2;
  return values.map((_, i) =>
    d3.mean(values.slice(Math.max(0, i - half), Math.min(values.length, i + half)))
  );
}

function stats(values) {
  const ok = values.filter(Number.isFinite);
  return {
    mean: d3.mean(ok),
    min: d3.min(ok),
    max: d3.max(ok),
    n: ok.length,
    minIdx: d3.minIndex(values),
    maxIdx: d3.maxIndex(values),
  };
}

function summarize(years, { models, matrix }) {
  const annual = models.map((_, j) => matrix.map((row) => row[j]));
  const smooth = annual.map(rolling);
  const points = years.map((year, i) => ({
    year,
    annual: stats(annual.map((a) => a[i])),
    smooth: stats(smooth.map((a) => a[i])),
  }));
  return { models, annual, smooth, points };
}

async function loadData() {
  const yearsTxt = await d3.text('data/years.csv');
  const years = yearsTxt.trim().split(/\s+/).map(Number);
  const raw = await Promise.all(SCENARIOS.map((s) => loadScenario(s.file)));
  const scen = Object.fromEntries(SCENARIOS.map((s, i) => [s.key, summarize(years, raw[i])]));

  // Both files share the same historical runs; SSP5-8.5 has one extra model, so use it for the past.
  const histIdx = years.findIndex((y) => y === LAST_HIST);
  const hist = scen.ssp585;
  const series = { historical: hist.points.slice(0, histIdx + 1) };
  const modelSeries = {
    historical: hist.models.map((name, j) => ({
      key: 'historical',
      name,
      pts: years.slice(0, histIdx + 1).map((year, i) => ({
        year,
        annual: hist.annual[j][i],
        smooth: hist.smooth[j][i],
      })),
    })),
  };
  for (const k of SSP_KEYS) {
    const s = scen[k];
    // Projections start at the last historical year so the lines connect.
    series[k] = [series.historical.at(-1), ...s.points.slice(histIdx + 1)];
    modelSeries[k] = s.models.map((name, j) => ({
      key: k,
      name,
      pts: years.slice(histIdx).map((year, i) => ({
        year,
        annual: s.annual[j][histIdx + i],
        smooth: s.smooth[j][histIdx + i],
      })),
    }));
  }
  const lookup = Object.fromEntries(
    Object.entries(series).map(([k, v]) => [k, new Map(v.map((d) => [d.year, d]))])
  );
  return { years, scen, series, modelSeries, lookup };
}

// First year the 20-year average reaches `level`, for the multi-model mean and for each model.
function crossings(data, key, level) {
  const s = data.scen[key];
  const hit = s.points.find((d) => d.smooth.mean >= level);
  const perModel = s.models.map((name, j) => {
    const i = s.smooth[j].findIndex((v) => v >= level);
    return { name, year: i < 0 ? null : data.years[i] };
  });
  const crossed = perModel.filter((d) => d.year !== null).sort((a, b) => a.year - b.year);
  return { year: hit ? hit.year : null, crossed, total: s.models.length };
}

// ---------------------------------------------------------------- shell (controls + readout)

function buildShell(root) {
  root.html('');
  root.append('div').attr('class', 'mv-controls').html(`
    <div class="mv-group" role="group" aria-label="Emissions scenarios">
      <span class="mv-label">Futures</span>
      ${SCENARIOS.map(
        (s) => `<button class="mv-pill" data-key="${s.key}" aria-pressed="true">
          <span class="mv-swatch" style="background:${color(s.key)}"></span>${s.code} · ${s.name.toLowerCase()}</button>`
      ).join('')}
    </div>
    <div class="mv-row">
      <div class="mv-group" role="group" aria-label="Measure">
        <span class="mv-label">Show</span>
        <div class="mv-seg">
          <button data-measure="annual" aria-pressed="true">Each year</button>
          <button data-measure="smooth" aria-pressed="false">20-year average</button>
        </div>
      </div>
      <div class="mv-group" role="group" aria-label="Models">
        <span class="mv-label">Models</span>
        <div class="mv-seg">
          <button data-spread="mean" aria-pressed="false">Average</button>
          <button data-spread="range" aria-pressed="true">Range</button>
          <button data-spread="models" aria-pressed="false">Every model</button>
        </div>
      </div>
      <div class="mv-group" role="group" aria-label="Zoom">
        <span class="mv-label">Zoom</span>
        <div class="mv-seg">
          <button data-zoom="all" aria-pressed="true">1850-2100</button>
          <button data-zoom="recent" aria-pressed="false">1950-2060</button>
          <button data-zoom="future" aria-pressed="false">2015-2100</button>
        </div>
      </div>
    </div>`);

  const chart = root.append('div').attr('class', 'mv-chart');

  const readout = root.append('div').attr('class', 'mv-threshold');
  readout.html(`
    <div class="mv-threshold-head">
      <label for="mv-slider">When does each future pass
        <output id="mv-value" for="mv-slider"></output><span aria-hidden="true">?</span></label>
      <input id="mv-slider" type="range" min="0.5" max="6" step="0.1" value="${state.threshold}">
      <div class="mv-presets" role="group" aria-label="Paris Agreement levels">
        <button data-level="1.5">1.5 °C goal</button>
        <button data-level="2">2 °C limit</button>
      </div>
    </div>
    <div class="mv-cards"></div>
    <p class="mv-gap"></p>`);

  root.append('p').attr('class', 'mv-note').text(
    'Hover the chart to read values. Drag across the overview strip to zoom, drag the shaded window to pan, ' +
      'and double-click the chart to zoom back out. Move the slider to pick any temperature: the black line and dots ' +
      'show when each future’s 20-year average first reaches it. Click a dot or a year to zoom to it.'
  );
  return { chart, readout };
}

// ---------------------------------------------------------------- main

export async function drawMainViz(selector) {
  const root = d3.select(selector);
  let data;
  try {
    data = await loadData();
  } catch (err) {
    console.error(err);
    root.select('.placeholder').text('Could not load the climate data.');
    return;
  }

  const { chart, readout } = buildShell(root);
  const tooltip = d3.select('body').append('div').attr('class', 'mv-tooltip').attr('hidden', true);

  let api = null;
  let lastWidth = 0;
  const rebuild = () => {
    const width = chart.node().clientWidth;
    if (!width || Math.abs(width - lastWidth) < 4) return;
    lastWidth = width;
    chart.html('');
    api = buildChart(chart, width, data, tooltip);
    api.syncBrush();
    api.render(0);
  };

  wireControls(root, readout, data, () => api);
  new ResizeObserver(rebuild).observe(chart.node());
  rebuild();
}

function wireControls(root, readout, data, getApi) {
  const render = (ms) => getApi()?.render(ms);

  const pills = root.selectAll('[data-key]');
  function toggleScenario(key) {
    if (state.visible.has(key)) state.visible.delete(key);
    else state.visible.add(key);
    pills.attr('aria-pressed', function () {
      return state.visible.has(this.dataset.key);
    });
    render(500);
  }
  pills.on('click', function () {
    toggleScenario(this.dataset.key);
  });

  const segment = (attr, field) => {
    const buttons = root.selectAll(`[data-${attr}]`);
    buttons.on('click', function () {
      state[field] = this.dataset[attr];
      buttons.attr('aria-pressed', function () {
        return this.dataset[attr] === state[field];
      });
      render(500);
    });
  };
  segment('measure', 'measure');
  segment('spread', 'spread');

  root.selectAll('[data-zoom]').on('click', function () {
    getApi()?.zoomTo(PRESETS[this.dataset.zoom]);
  });

  // Threshold slider + readout cards
  const slider = readout.select('#mv-slider');
  const valueOut = readout.select('#mv-value');
  const cards = readout.select('.mv-cards');
  const gap = readout.select('.mv-gap');

  function setThreshold(t) {
    state.threshold = Math.round(t * 10) / 10;
    slider.property('value', state.threshold);
    updateReadout();
    render(0);
  }
  slider.on('input', function () {
    setThreshold(+this.value);
  });
  readout.selectAll('[data-level]').on('click', function () {
    setThreshold(+this.dataset.level);
  });

  function updateReadout() {
    const t = state.threshold;
    valueOut.text(`${fmt1(t)} °C`);
    readout.selectAll('[data-level]').attr('aria-pressed', function () {
      return +this.dataset.level === t;
    });

    const rows = SCENARIOS.map((s) => ({ ...s, ...crossings(data, s.key, t) }));
    cards
      .selectAll('.mv-card')
      .data(rows, (d) => d.key)
      .join((enter) => {
        const c = enter.append('div').attr('class', 'mv-card');
        c.append('div').attr('class', 'mv-card-head');
        c.append('div').attr('class', 'mv-card-year');
        c.append('div').attr('class', 'mv-card-sub');
        return c;
      })
      .style('--accent', (d) => color(d.key))
      .on('pointerenter', (e, d) => getApi()?.setHighlight(d.key))
      .on('pointerleave', () => getApi()?.setHighlight(null))
      .call((card) => {
        card
          .select('.mv-card-head')
          .html((d) => `<span class="mv-swatch" style="background:${color(d.key)}"></span>${d.code} · ${d.name}`);
        card.select('.mv-card-year').each(function (d) {
          const el = d3.select(this).html('');
          if (d.year === null) {
            el.append('span').attr('class', 'mv-never').text('Not by 2100');
          } else {
            el.append('button')
              .attr('class', 'mv-year-link')
              .attr('title', 'Zoom the chart to this year')
              .text(d.year)
              .on('click', () => {
                if (!state.visible.has(d.key)) toggleScenario(d.key);
                getApi()?.zoomTo([d.year - 20, d.year + 20]);
              });
          }
        });
        card.select('.mv-card-sub').text((d) => {
          const n = d.crossed.length;
          if (!n) return `The multi-model average never gets there, and none of the ${d.total} models do either.`;
          const first = n > 1 ? ` The earliest is ${d.crossed[0].name} in ${d.crossed[0].year}.` : '';
          const lead = d.year === null ? 'The multi-model average never gets there, but ' : '';
          return `${lead}${n} of ${d.total} models reach it by 2100.${first}`;
        });
      });

    const [lo, hi] = rows;
    let msg;
    if (lo.year === null && hi.year === null) msg = `Neither future's average reaches ${fmt1(t)} °C this century.`;
    else if (lo.year === null) msg = `Only the very high emissions future reaches ${fmt1(t)} °C before 2100.`;
    else if (hi.year === null) msg = `Only the low emissions future reaches ${fmt1(t)} °C before 2100.`;
    else if (Math.max(lo.year, hi.year) <= LAST_HIST) msg = `Both futures already passed ${fmt1(t)} °C in the simulated past.`;
    else if (lo.year === hi.year) msg = `Both futures reach ${fmt1(t)} °C in the same year: that much warming is already locked in.`;
    else {
      const d = Math.abs(lo.year - hi.year);
      msg = `${hi.year < lo.year ? 'SSP5-8.5' : 'SSP1-2.6'} gets there ${d} year${d === 1 ? '' : 's'} sooner.`;
    }
    gap.text(msg);
  }

  updateReadout();
  return { toggleScenario };
}

// ---------------------------------------------------------------- chart

function buildChart(container, width, data, tooltip) {
  const { series, modelSeries, lookup } = data;
  const narrow = width < 640;
  const W = width;
  const M = { top: 30, right: narrow ? 64 : 116, left: narrow ? 38 : 52 };
  const FOCUS_BOTTOM = M.top + Math.max(220, Math.min(380, W * 0.46));
  const CTX_TOP = FOCUS_BOTTOM + 52;
  const CTX_BOTTOM = CTX_TOP + 46;
  const H = CTX_BOTTOM + 28;
  const plotW = W - M.left - M.right;

  const x = d3.scaleLinear().domain(state.domain).range([M.left, W - M.right]);
  const x2 = d3.scaleLinear().domain(FULL).range([M.left, W - M.right]);
  const y = d3.scaleLinear().range([FOCUS_BOTTOM, M.top]);
  const y2 = d3
    .scaleLinear()
    .domain(d3.extent(Object.values(series).flat(), (d) => d.annual.mean))
    .nice()
    .range([CTX_BOTTOM, CTX_TOP]);

  const svg = container
    .append('svg')
    .attr('viewBox', [0, 0, W, H])
    .attr('width', W)
    .attr('height', H)
    .attr('role', 'img')
    .attr(
      'aria-label',
      'Line chart of global temperature change from 1850 to 2100 under SSP1-2.6 and SSP5-8.5, with model ranges, an adjustable threshold line, and an overview strip for zooming'
    );

  const clipId = `mv-clip-${Math.random().toString(36).slice(2, 8)}`;
  svg
    .append('defs')
    .append('clipPath')
    .attr('id', clipId)
    .append('rect')
    .attr('x', M.left)
    .attr('y', M.top)
    .attr('width', plotW)
    .attr('height', FOCUS_BOTTOM - M.top);
  const clipped = () => svg.append('g').attr('clip-path', `url(#${clipId})`);

  const projBg = clipped()
    .append('rect')
    .attr('class', 'mv-projected-bg')
    .attr('y', M.top)
    .attr('height', FOCUS_BOTTOM - M.top);

  const gridG = svg.append('g').attr('class', 'mv-grid').attr('transform', `translate(${M.left},0)`);

  const bandLayer = clipped();
  const bands = bandLayer
    .selectAll('path')
    .data(ALL_KEYS)
    .join('path')
    .attr('class', 'mv-band')
    .attr('fill', color);

  const modelLayer = clipped();
  const modelPaths = modelLayer
    .selectAll('path')
    .data(ALL_KEYS.flatMap((k) => modelSeries[k]))
    .join('path')
    .attr('class', 'mv-model-line')
    .attr('stroke', (d) => color(d.key));

  const refLayer = clipped();
  const refs = refLayer.selectAll('g').data(PARIS).join('g');
  refs.append('line').attr('class', 'mv-ref-line').attr('x1', M.left).attr('x2', W - M.right);
  refs
    .append('text')
    .attr('class', 'mv-ref-label')
    .attr('x', M.left + 6)
    .text((l) => (narrow ? `${l} °C` : `${l} °C Paris ${l === 1.5 ? 'goal' : 'limit'}`));

  const lineLayer = clipped();
  const paths = lineLayer
    .selectAll('path')
    .data(ALL_KEYS)
    .join('path')
    .attr('class', (k) => `mv-line ${k}`)
    .attr('stroke', color);

  const thresholdG = clipped().attr('class', 'mv-threshold-g');
  const tLine = thresholdG.append('line').attr('class', 'mv-t-line').attr('x1', M.left).attr('x2', W - M.right);
  const tLabel = thresholdG.append('text').attr('class', 'mv-t-label').attr('x', M.left + 6);

  const xAxisG = svg.append('g').attr('class', 'mv-axis').attr('transform', `translate(0,${FOCUS_BOTTOM})`);
  const yAxisG = svg.append('g').attr('class', 'mv-axis').attr('transform', `translate(${M.left},0)`);
  svg
    .append('text')
    .attr('class', 'mv-axis-title')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(M.top + (FOCUS_BOTTOM - M.top) / 2))
    .attr('y', 12)
    .attr('text-anchor', 'middle')
    .style('display', narrow ? 'none' : null)
    .text('Warming vs. pre-industrial (°C)');

  const pastLabel = svg.append('text').attr('class', 'mv-region').attr('y', M.top - 10).text('Simulated past');
  const projLabel = svg.append('text').attr('class', 'mv-region').attr('y', M.top - 10).text('Projected');
  const endYearLabel = svg.append('text').attr('class', 'mv-region').attr('x', W - M.right + 8).attr('y', M.top - 10);
  const endLabelG = svg.append('g');

  // Hover layer
  const hover = svg.append('g').style('display', 'none').style('pointer-events', 'none');
  const hoverLine = hover.append('line').attr('class', 'mv-hover-line').attr('y1', M.top).attr('y2', FOCUS_BOTTOM);
  const dots = hover
    .selectAll('circle')
    .data(ALL_KEYS)
    .join('circle')
    .attr('class', 'mv-hover-dot')
    .attr('r', 4.5)
    .attr('fill', color);

  const overlay = svg
    .append('rect')
    .attr('x', M.left)
    .attr('y', M.top)
    .attr('width', plotW)
    .attr('height', FOCUS_BOTTOM - M.top)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair');

  // Crossing markers sit above the overlay so they get their own hover/click.
  const markerLayer = clipped();

  // ---------- overview strip + brush ----------
  const ctx = svg.append('g');
  ctx
    .append('rect')
    .attr('class', 'mv-projected-bg')
    .attr('x', x2(LAST_HIST))
    .attr('y', CTX_TOP)
    .attr('width', x2(FULL[1]) - x2(LAST_HIST))
    .attr('height', CTX_BOTTOM - CTX_TOP);
  const ctxLine = d3
    .line()
    .x((d) => x2(d.year))
    .y((d) => y2(d.annual.mean));
  const ctxPaths = ctx
    .selectAll('path.mv-ctx-line')
    .data(ALL_KEYS)
    .join('path')
    .attr('class', 'mv-ctx-line')
    .attr('stroke', color)
    .attr('d', (k) => ctxLine(series[k]));
  ctx
    .append('g')
    .attr('class', 'mv-axis')
    .attr('transform', `translate(0,${CTX_BOTTOM})`)
    .call(d3.axisBottom(x2).tickFormat(d3.format('d')).ticks(narrow ? 5 : 10).tickSizeOuter(0));
  ctx
    .append('text')
    .attr('class', 'mv-ctx-label')
    .attr('x', M.left)
    .attr('y', CTX_TOP - 8)
    .text(narrow ? 'Overview: drag to zoom' : 'Overview: drag across to zoom, drag the window to pan, double-click the chart to reset');

  const brush = d3
    .brushX()
    .extent([
      [M.left, CTX_TOP],
      [W - M.right, CTX_BOTTOM],
    ])
    .on('brush end', brushed);
  const brushG = ctx.append('g').attr('class', 'mv-brush').call(brush);

  function brushed(event) {
    const sel = event.selection;
    let domain = sel ? sel.map(x2.invert) : FULL.slice();
    if (domain[1] - domain[0] < 8) {
      const mid = (domain[0] + domain[1]) / 2;
      domain = [Math.max(FULL[0], mid - 4), Math.min(FULL[1], mid + 4)];
    }
    state.domain = domain;
    render(0);
  }

  const isFull = (r) => !r || (r[0] <= FULL[0] && r[1] >= FULL[1]);

  function zoomTo(range) {
    const r = range && [Math.max(FULL[0], range[0]), Math.min(FULL[1], range[1])];
    brushG.transition().duration(650).call(brush.move, isFull(r) ? null : r.map(x2));
  }

  function syncBrush() {
    brushG.call(brush.move, isFull(state.domain) ? null : state.domain.map(x2));
  }

  // ---------- tooltip ----------
  function placeTooltip(event) {
    const node = tooltip.node();
    const pad = 14;
    let left = event.clientX + pad;
    if (left + node.offsetWidth > window.innerWidth - 8) left = event.clientX - node.offsetWidth - pad;
    let top = event.clientY + pad;
    if (top + node.offsetHeight > window.innerHeight - 8) top = event.clientY - node.offsetHeight - pad;
    node.style.left = `${Math.max(8, left)}px`;
    node.style.top = `${Math.max(8, top)}px`;
  }
  const swatch = (key) => `<span class="mv-swatch" style="background:${color(key)}"></span>`;

  overlay
    .on('pointerenter', () => {
      hover.style('display', null);
      tooltip.attr('hidden', null);
    })
    .on('pointerleave', () => {
      hover.style('display', 'none');
      tooltip.attr('hidden', true);
    })
    .on('pointermove', (event) => {
      const [mx] = d3.pointer(event);
      const [d0, d1] = x.domain();
      const year = Math.max(Math.ceil(d0), Math.min(Math.floor(d1), Math.round(x.invert(mx))));
      const projected = year > LAST_HIST;
      const keys = projected ? SSP_KEYS.filter((k) => state.visible.has(k)) : ['historical'];
      const m = state.measure;

      hoverLine.attr('x1', x(year)).attr('x2', x(year));
      dots
        .style('display', (k) => (keys.includes(k) ? null : 'none'))
        .attr('cx', x(year))
        .attr('cy', (k) => (lookup[k].has(year) ? y(lookup[k].get(year)[m].mean) : 0));

      const pts = keys
        .map((k) => ({ k, s: lookup[k].get(year)[m] }))
        .sort((a, b) => b.s.mean - a.s.mean);
      const models = (k) => (k === 'historical' ? data.scen.ssp585.models : data.scen[k].models);
      const rows = pts
        .map(
          ({ k, s }) =>
            `<div class="mv-tt-row"><span>${swatch(k)}${META[k].code}</span><strong>${fmtSigned(s.mean)} °C</strong></div>` +
            `<div class="mv-tt-sub">${s.n} models: ${fmtSigned(s.min)} (${models(k)[s.minIdx]}) to ${fmtSigned(s.max)} (${models(k)[s.maxIdx]})</div>`
        )
        .join('');

      const tags = [];
      for (const k of keys) {
        const c = k === 'historical' ? null : crossings(data, k, state.threshold).year;
        if (c === year) tags.push(`${META[k].code} average reaches ${fmt1(state.threshold)} °C this year`);
      }
      if (pts.length > 1) tags.push(`Gap between futures: ${fmt1(pts[0].s.mean - pts.at(-1).s.mean)} °C`);
      else if (!pts.length) tags.push('Turn on a future above to see projections');

      tooltip.html(
        `<div class="mv-tt-year">${year}${projected ? ' · projected' : ''}${m === 'smooth' ? ' · 20-yr avg' : ''}</div>` +
          rows +
          tags.map((t) => `<div class="mv-tt-tag">${t}</div>`).join('')
      );
      placeTooltip(event);
    })
    .on('dblclick', () => zoomTo(null));

  // ---------- highlight ----------
  function setHighlight(key) {
    state.highlight = key;
    const faded = (k) => state.highlight !== null && k !== state.highlight && k !== 'historical';
    paths.classed('mv-faded', faded);
    bands.classed('mv-faded', faded);
    modelPaths.classed('mv-faded', (d) => faded(d.key));
    markerLayer.selectAll('circle').classed('mv-faded', (d) => faded(d.key));
    endLabelG.selectAll('text').classed('mv-faded', (d) => faded(d.key));
  }

  // ---------- render ----------
  function render(duration) {
    const [d0, d1] = state.domain;
    const m = state.measure;
    const t = state.threshold;
    const shown = (k) => k === 'historical' || state.visible.has(k);
    const tr = (sel) => (duration ? sel.transition().duration(duration) : sel);

    for (const g of [xAxisG, yAxisG, gridG]) g.interrupt().selectAll('*').interrupt();
    for (const sel of [refs.selectAll('*'), paths, bands, modelPaths, tLine, tLabel]) sel.interrupt();

    x.domain(state.domain);

    // y range: lines (plus model spread when it is drawn) inside the current view, and the threshold.
    const inView = (d) => d.year >= d0 - 1 && d.year <= d1 + 1;
    const vals = [];
    for (const k of ALL_KEYS.filter(shown)) {
      if (state.spread === 'models') {
        for (const ms of modelSeries[k]) for (const p of ms.pts) if (inView(p) && Number.isFinite(p[m])) vals.push(p[m]);
      }
      for (const p of series[k]) {
        if (!inView(p)) continue;
        vals.push(p[m].mean);
        if (state.spread === 'range') vals.push(p[m].min, p[m].max);
      }
    }
    if (d1 > LAST_HIST) vals.push(t);
    const [lo, hi] = d3.extent(vals);
    const pad = Math.max(0.15, (hi - lo) * 0.06);
    y.domain([lo - pad, hi + pad]).nice();

    const xTicks = x.ticks(narrow ? 5 : 10).filter(Number.isInteger);
    tr(xAxisG).call(d3.axisBottom(x).tickValues(xTicks).tickFormat(d3.format('d')).tickSizeOuter(0));
    tr(yAxisG).call(d3.axisLeft(y).ticks(8).tickFormat(fmtTick).tickSizeOuter(0));
    tr(gridG).call(d3.axisLeft(y).ticks(8).tickSize(-plotW).tickFormat(''));

    projBg.attr('x', x(LAST_HIST)).attr('width', Math.max(0, x(FULL[1]) - x(LAST_HIST)));

    tr(refs.select('line')).attr('y1', (l) => y(l)).attr('y2', (l) => y(l));
    tr(refs.select('text')).attr('y', (l) => y(l) - 4);

    const line = d3
      .line()
      .defined((d) => Number.isFinite(d[m].mean))
      .x((d) => x(d.year))
      .y((d) => y(d[m].mean));
    const area = d3
      .area()
      .defined((d) => Number.isFinite(d[m].min))
      .x((d) => x(d.year))
      .y0((d) => y(d[m].min))
      .y1((d) => y(d[m].max));
    const modelLine = d3
      .line()
      .defined((d) => Number.isFinite(d[m]))
      .x((d) => x(d.year))
      .y((d) => y(d[m]));

    tr(paths).attr('d', (k) => line(series[k]));
    tr(bands).attr('d', (k) => area(series[k]));
    tr(modelPaths).attr('d', (d) => modelLine(d.pts));
    paths.classed('mv-off', (k) => !shown(k));
    bands.classed('mv-off', (k) => !shown(k) || state.spread !== 'range');
    modelPaths.classed('mv-off', (d) => !shown(d.key) || state.spread !== 'models');
    ctxPaths.classed('mv-ctx-off', (k) => !shown(k));

    // Threshold line + markers
    tLine.attr('y1', y(t)).attr('y2', y(t));
    // Paris labels step aside when the threshold label would sit on top of them.
    const paris = PARIS.find((l) => Math.abs(l - t) < 0.05);
    refs.select('text').style('display', (l) => (Math.abs(y(l) - y(t)) < 16 ? 'none' : null));
    const tName = paris ? `${fmt1(t)} °C Paris ${paris === 1.5 ? 'goal' : 'limit'}` : `${fmt1(t)} °C`;
    tLabel.attr('y', y(t) - 5).text(narrow ? `${fmt1(t)} °C` : `Your threshold: ${tName}`);
    const markerData = SSP_KEYS.filter(shown)
      .map((k) => ({ key: k, ...crossings(data, k, t) }))
      .filter((d) => d.year !== null);
    markerLayer
      .selectAll('circle')
      .data(markerData, (d) => d.key)
      .join('circle')
      .attr('class', 'mv-marker')
      .attr('r', 6)
      .attr('fill', (d) => color(d.key))
      .attr('cx', (d) => x(d.year))
      .attr('cy', y(t))
      .on('pointerenter', (event, d) => {
        tooltip
          .attr('hidden', null)
          .html(
            `<div class="mv-tt-year">${d.year}</div>` +
              `<div class="mv-tt-row"><span>${swatch(d.key)}${META[d.key].code} · ${META[d.key].name}</span></div>` +
              `<div class="mv-tt-tag">20-year average first reaches <strong>${fmt1(t)} °C</strong></div>` +
              `<div class="mv-tt-tag">${d.crossed.length} of ${d.total} models get there by 2100</div>` +
              `<div class="mv-tt-tag">Click to zoom in</div>`
          );
        placeTooltip(event);
      })
      .on('pointermove', placeTooltip)
      .on('pointerleave', () => tooltip.attr('hidden', true))
      .on('click', (event, d) => zoomTo([d.year - 20, d.year + 20]));

    // Region labels only when there is room
    const xHistEnd = x(Math.min(d1, LAST_HIST));
    pastLabel.attr('x', x(d0) + 6).style('display', xHistEnd - x(d0) > 120 ? null : 'none');
    const xProjStart = x(Math.max(d0, LAST_HIST));
    projLabel.attr('x', xProjStart + 6).style('display', x(d1) - xProjStart > 90 ? null : 'none');

    // Value labels at the right edge of the view
    const endYear = Math.min(FULL[1], Math.floor(d1));
    const endKeys = endYear > LAST_HIST ? SSP_KEYS.filter(shown) : ['historical'];
    const items = endKeys
      .map((k) => {
        const p = lookup[k].get(endYear) || series[k].at(-1);
        const v = Number.isFinite(p[m].mean) ? p[m].mean : series[k].at(-2)[m].mean;
        return { key: k, v, y: y(v) };
      })
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < 15) items[i].y = items[i - 1].y + 15;
    }
    endYearLabel.text(`In ${endYear}`);
    endLabelG
      .selectAll('text')
      .data(items, (d) => d.key)
      .join('text')
      .attr('class', 'mv-end-label')
      .attr('fill', (d) => color(d.key))
      .attr('x', W - M.right + 8)
      .attr('dy', '0.35em')
      .text((d) => (narrow ? `${fmtSigned(d.v)}°` : `${META[d.key].code} ${fmtSigned(d.v)}°`))
      .attr('y', (d) => d.y);
    setHighlight(state.highlight);

    d3.selectAll('[data-zoom]').attr('aria-pressed', function () {
      const p = PRESETS[this.dataset.zoom] || FULL;
      return Math.abs(p[0] - d0) < 1 && Math.abs(p[1] - d1) < 1;
    });
  }

  return { render, zoomTo, syncBrush, setHighlight };
}

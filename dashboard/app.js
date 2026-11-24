// Token Radar — the page. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board (table or graph), a detail drawer with the model's own arithmetic and the protocol's
// farm plan, a live-token market tab and a model tab. No network: every byte is in data.js and this file.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D || !D.rows) {
    document.getElementById('app').textContent = 'data.js is missing or empty: run main.ts to write it beside the dashboard.';
    return;
  }

  var allChains = [];
  var chainCount = {};
  D.rows.forEach(function (r) {
    (r.chains || []).forEach(function (c) {
      if (!chainCount[c]) { chainCount[c] = 0; allChains.push(c); }
      chainCount[c] += 1;
    });
  });
  allChains.sort(function (a, b) { return chainCount[b] - chainCount[a] || a.localeCompare(b); });

  var state = { q: '', sector: 'all', chain: 'all', rising: false, tab: 'board', view: 'table', sort: 'implied', dir: 'desc', selected: null };
  var MAX_IMPLIED = D.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- formatting ---------- */

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '-' : '', a = Math.abs(n);
    if (a >= 1e12) return s + '$' + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(0) + 'K';
    return s + '$' + Math.round(a);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unlisted';
    if (d >= 730) return (d / 365).toFixed(1) + 'y';
    if (d >= 60) return Math.round(d / 30) + 'mo';
    return Math.round(d) + 'd';
  }
  function fmtMult(n) { return !isFinite(n) ? 'n/a' : (n >= 10 ? n.toFixed(1) : n.toFixed(2)) + 'x'; }
  function fmtRatio(n) { return n === null || n === undefined || !isFinite(n) ? 'n/a' : n >= 10 ? n.toFixed(1) : n.toFixed(2); }
  function ageDays() {
    var t = Date.parse(D.as_of + 'T00:00:00Z');
    return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null;
  }
  function feedHash() {
    var h = D.feed && D.feed.sha256 ? D.feed.sha256 : '';
    return h ? h.slice(0, 8) + '…' + h.slice(-6) : 'unhashed';
  }

  /* ---------- dom ---------- */

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
      else if (k === 'selected' || k === 'checked') { if (v) node.setAttribute(k, k === 'checked' ? 'checked' : 'selected'); }
      else node.setAttribute(k, String(v));
    });
    for (var i = 2; i < arguments.length; i++) add(node, arguments[i]);
    return node;
  }
  function add(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { add(node, c); }); return; }
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------- routing + theme ---------- */

  function readHash() {
    // The hash is the whole view state, so a field it omits means that field's default.
    state.q = ''; state.sector = 'all'; state.chain = 'all'; state.rising = false;
    state.tab = 'board'; state.view = 'table'; state.selected = null;
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('sector')) state.sector = p.get('sector');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('view') === 'graph') state.view = 'graph';
    if (p.get('rising') === '1') state.rising = true;
    if (p.get('p')) state.selected = p.get('p');
    if (p.get('theme') === 'light' || p.get('theme') === 'dark') setTheme(p.get('theme'), false);
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sector !== 'all') p.set('sector', state.sector);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.view === 'graph') p.set('view', 'graph');
    if (state.rising) p.set('rising', '1');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  function currentTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'; }
  function setTheme(theme, persist) {
    document.documentElement.dataset.theme = theme;
    if (persist) { try { localStorage.setItem('radar-theme', theme); } catch (e) {} }
  }

  /* ---------- filtering ---------- */

  function match(row) {
    var q = state.q.trim().toLowerCase();
    if (state.sector !== 'all' && row.sector !== state.sector) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (state.rising && !(typeof row.change_7d === 'number' && row.change_7d > 0)) return false;
    if (!q) return true;
    return [row.name, row.slug, row.sector, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function sorted(list) {
    var key = state.sort, dir = state.dir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.value_per_tvl; bv = b.value_per_tvl; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  /* ---------- header, feed, hero ---------- */

  function header() {
    var days = ageDays();
    var theme = currentTheme();
    var btn = h('button', {
      class: 'icon-btn', type: 'button', id: 'theme',
      'aria-label': theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme',
      title: 'Switch theme',
      onclick: function () { setTheme(currentTheme() === 'light' ? 'dark' : 'light', true); renderShell(); }
    },
      theme === 'light'
        ? h('svg', { viewBox: '0 0 24 24', html: '<path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8Z"/>' })
        : h('svg', { viewBox: '0 0 24 24', html: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' }),
      theme === 'light' ? 'Dark' : 'Light'
    );
    return h('div', null,
      h('header', { class: 'top' },
        h('div', { class: 'brand' },
          h('span', { class: 'mark', 'aria-hidden': 'true' }),
          h('div', null,
            h('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
            h('div', { class: 'brand-tag', text: 'pre-token intelligence' })
          )
        ),
        h('div', { class: 'top-meta' },
          h('span', { class: 'meta' }, h('span', { class: 'dot', 'aria-hidden': 'true' }),
            days === null ? 'snapshot ' : 'feed ' + (days <= 0 ? 'current' : days + 'd old')),
          h('span', { class: 'meta' }, 'model ', h('b', { text: D.model_version })),
          btn
        )
      ),
      h('div', { class: 'feed', 'aria-label': 'Data provenance' },
        h('span', null, 'source ', h('b', { text: 'DefiLlama index' })),
        h('span', null, 'snapshot ', h('b', { text: D.as_of }), days !== null ? ' · ' + days + 'd old' : ''),
        h('span', null, 'sha256 ', h('b', { title: D.feed && D.feed.sha256 ? D.feed.sha256 : '', text: feedHash() })),
        h('span', null, 'parsed ', h('b', { text: String(D.stats.universe_size) }), ' protocols'),
        h('span', null, 'ranked ', h('b', { text: String(D.stats.board_size) }), ' pre-token')
      )
    );
  }

  function hero() {
    return h('section', { class: 'hero' },
      h('div', null,
        h('div', { class: 'eyebrow' }, 'Which pre-token protocol is worth farming next'),
        h('h1', null, 'The token does not exist yet. ', h('em', { text: 'Here is what it would be worth.' })),
        h('p', { class: 'lede-copy' },
          'Every protocol below records no token. The board prices them from three things the snapshot already measured: ',
          h('b', { text: 'TVL' }), ', ', h('b', { text: 'seven-day growth' }), ' and ', h('b', { text: 'how long it has run without a token' }),
          '. The dollars-per-TVL multiple is learned from live-token protocols in the same sector — no hand-picked names, no promises.'
        )
      ),
      h('div', { class: 'kpis' },
        kpi('Watchlist covered', D.stats.watchlist_covered + ' / ' + D.stats.watchlist_size),
        kpi('Protocols ranked', String(D.stats.board_size), D.stats.early_size + ' under the floor'),
        kpi('Top implied value', fmtUsd(D.stats.top_implied_usd)),
        kpi('Aggregate implied', fmtUsd(D.stats.board_implied_usd))
      )
    );
  }
  function kpi(label, value, small) {
    return h('div', { class: 'kpi' },
      h('span', { class: 'k', text: label }),
      h('span', { class: 'v' }, value, small ? h('small', { text: small }) : null)
    );
  }

  /* ---------- toolbar ---------- */

  function options(values, current) {
    return values.map(function (v) { return h('option', { value: v, selected: v === current }, v); });
  }

  function toolbar() {
    var search = h('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search protocol, sector or chain', 'aria-label': 'Search the radar' });
    search.addEventListener('input', function () { state.q = search.value; renderView(); writeHash(); });
    var sector = h('select', { id: 'sector', 'aria-label': 'Filter by sector' },
      h('option', { value: 'all', selected: state.sector === 'all', text: 'All sectors' }),
      options(D.sector_stats.map(function (s) { return s.sector; }), state.sector));
    sector.addEventListener('change', function () { state.sector = sector.value; renderShell(); writeHash(); });
    var chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', selected: state.chain === 'all', text: 'All chains' }),
      options(allChains, state.chain));
    chain.addEventListener('change', function () { state.chain = chain.value; renderShell(); writeHash(); });
    var rising = h('input', { type: 'checkbox', checked: state.rising, 'aria-label': 'Only protocols rising over seven days' });
    rising.addEventListener('change', function () { state.rising = rising.checked; renderView(); writeHash(); });

    var tabs = [['board', 'Board'], ['live', 'Live market'], ['model', 'Model']].map(function (t) {
      return h('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false', text: t[1],
        onclick: function () { state.tab = t[0]; state.selected = null; renderShell(); writeHash(); }
      });
    });

    var view = h('div', { class: 'seg', role: 'group', 'aria-label': 'Board view' },
      h('button', { type: 'button', 'aria-pressed': state.view === 'table' ? 'true' : 'false',
        html: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg>Table',
        onclick: function () { state.view = 'table'; renderShell(); writeHash(); } }),
      h('button', { type: 'button', 'aria-pressed': state.view === 'graph' ? 'true' : 'false',
        html: '<svg viewBox="0 0 24 24"><circle cx="7" cy="16" r="2"/><circle cx="12" cy="9" r="2"/><circle cx="18" cy="13" r="2"/></svg>Graph',
        onclick: function () { state.view = 'graph'; renderShell(); writeHash(); } })
    );

    return h('div', null,
      h('div', { class: 'bar', role: 'toolbar' },
        h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tabs),
        state.tab === 'board' ? view : null,
        state.tab === 'model' ? null : h('span', { class: 'field' }, search),
        state.tab === 'model' ? null : h('span', { class: 'field' }, sector),
        state.tab === 'model' ? null : h('span', { class: 'field' }, chain),
        state.tab === 'model' ? null : h('label', { class: 'toggle' }, rising, 'Rising only'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'count', id: 'count' })
      ),
      h('div', { class: 'chips', id: 'chips' })
    );
  }

  function renderChips() {
    var host = document.getElementById('chips');
    if (!host) return;
    clear(host);
    if (state.tab === 'model') return;
    function chip(label, clearIt) {
      return h('span', { class: 'chip' }, label,
        h('button', { type: 'button', 'aria-label': 'Clear ' + label, text: '×', onclick: function () { clearIt(); renderShell(); writeHash(); } }));
    }
    if (state.q) host.appendChild(chip('search: ' + state.q, function () { state.q = ''; }));
    if (state.sector !== 'all') host.appendChild(chip('sector: ' + state.sector, function () { state.sector = 'all'; }));
    if (state.chain !== 'all') host.appendChild(chip('chain: ' + state.chain, function () { state.chain = 'all'; }));
    if (state.rising) host.appendChild(chip('rising only', function () { state.rising = false; }));
  }

  /* ---------- board table ---------- */

  function sortHeader(key, label) {
    var active = state.sort === key;
    return h('th', { scope: 'col', 'aria-sort': active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      h('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = state.dir === 'desc' ? 'asc' : 'desc';
        else { state.sort = key; state.dir = key === 'name' ? 'asc' : 'desc'; }
        renderView(); writeHash();
      } },
        label,
        active ? h('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir === 'asc' ? '▲' : '▼' }) : null));
  }

  function rowNode(r) {
    var growthClass = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat';
    return h('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0', 'aria-label': 'Rank ' + r.rank + ', ' + r.name,
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      h('td', { class: 'rank num', text: String(r.rank) }),
      h('td', null, h('div', { class: 'pname' },
        h('b', null, r.name, h('span', { class: 'chev', 'aria-hidden': 'true', text: '→' })),
        h('span', { class: 'sub', text: (r.category || 'Other') + (r.cohort === 'early' ? ' · early radar' : '') })
      )),
      h('td', null, h('span', { class: 'sector', text: r.sector })),
      h('td', { class: 'chain', title: (r.chains || []).join(', '), text: (r.chains || []).slice(0, 2).join(', ') || 'n/a' }),
      h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
      h('td', { class: 'num', text: fmtAge(r.age_days) }),
      h('td', { class: 'valcell' }, h('div', { class: 'valrow' },
        h('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' },
          h('span', { class: 'bar-fill', style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / MAX_IMPLIED) * 100)) + '%' })))),
      h('td', { class: 'num mult', text: fmtMult(r.value_per_tvl) })
    );
  }

  function boardPanel() {
    if (state.view === 'graph') return graphPanel();
    var rows = sorted(D.rows.filter(match));
    setCount(rows.length + ' of ' + D.rows.length + ' rows');
    var wrap = h('div', { class: 'table-wrap' });
    if (rows.length === 0) {
      wrap.appendChild(h('div', { class: 'empty' },
        h('h3', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or the sector filter to bring the board back.' }),
        h('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { clearFilters(); } })));
    } else {
      var tbody = h('tbody');
      rows.forEach(function (r) { tbody.appendChild(rowNode(r)); });
      wrap.appendChild(h('table', null,
        h('caption', { class: 'small', style: 'text-align:left;padding:8px 12px;color:var(--dim)' },
          'Ranked by implied value, strongest first. Select a row for its arithmetic, its range and its farm plan.'),
        h('thead', null, h('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          h('th', { scope: 'col', text: 'Sector' }),
          h('th', { scope: 'col', text: 'Chains' }),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'No token'),
          sortHeader('implied', 'Implied value'),
          sortHeader('multiple', 'Value / TVL')
        )),
        tbody));
    }
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { text: 'Pre-token board' }),
        h('p', { text: 'Watchlist floor $' + Math.round(D.floor_usd / 1e6) + 'M TVL · ' + D.stats.early_size + ' early rows below it' })),
      wrap);
  }

  function clearFilters() {
    state.q = ''; state.sector = 'all'; state.chain = 'all'; state.rising = false;
    renderShell(); writeHash();
  }

  function setCount(text) {
    var c = document.getElementById('count');
    if (c) c.textContent = text;
  }

  /* ---------- graph view ---------- */

  function log10(n) { return Math.log(n) / Math.LN10; }

  function graphPanel() {
    var rows = D.rows.filter(match);
    setCount(rows.length + ' of ' + D.rows.length + ' plotted');
    var canvas = h('canvas', { class: 'graph-canvas', role: 'img',
      'aria-label': 'Scatter plot of TVL against implied value for ' + rows.length + ' protocols; use the table view for the full list' });
    var tip = h('div', { class: 'graph-tip', 'aria-hidden': 'true' });
    var wrap = h('div', { class: 'graph-wrap' }, canvas, tip);
    var state2 = { points: [], hover: -1, w: 0, h: 0 };

    function layout() {
      var rect = canvas.getBoundingClientRect();
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      state2.w = Math.max(320, rect.width);
      state2.h = Math.max(300, rect.height);
      canvas.width = Math.round(state2.w * dpr);
      canvas.height = Math.round(state2.h * dpr);
      var ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    function domain(values) {
      var lo = Math.min.apply(null, values), hi = Math.max.apply(null, values);
      if (!(hi > lo)) { hi = lo * 1.3; lo = lo / 1.3; }
      var pad = (log10(hi) - log10(lo)) * 0.06;
      return [Math.pow(10, log10(lo) - pad), Math.pow(10, log10(hi) + pad)];
    }

    function draw() {
      var ctx = layout();
      if (!ctx || !rows.length) return;
      var xd = domain(rows.map(function (r) { return Math.max(1, r.tvl_usd); }));
      var yd = domain(rows.map(function (r) { return Math.max(1, r.implied_value_usd); }));
      var pad = { l: 62, r: 14, t: 18, b: 30 };
      var W = state2.w - pad.l - pad.r, H = state2.h - pad.t - pad.b;
      var css = getComputedStyle(document.documentElement);
      var line = css.getPropertyValue('--line').trim() || '#232329';
      var dim = css.getPropertyValue('--dim').trim() || '#6d6d76';
      var accent = css.getPropertyValue('--accent').trim() || '#f0b542';
      var muted = css.getPropertyValue('--muted').trim() || '#a2a1a6';
      function X(v) { return pad.l + (log10(v) - log10(xd[0])) / (log10(xd[1]) - log10(xd[0])) * W; }
      function Y(v) { return pad.t + H - (log10(v) - log10(yd[0])) / (log10(yd[1]) - log10(yd[0])) * H; }

      ctx.clearRect(0, 0, state2.w, state2.h);
      ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.font = '10px ui-monospace, Consolas, monospace';
      ctx.fillStyle = dim;
      var ticks = [1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11];
      ticks.forEach(function (t) {
        if (t < xd[0] || t > xd[1]) return;
        var x = X(t);
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + H); ctx.stroke();
        ctx.textAlign = 'center'; ctx.fillText(fmtUsd(t), x, state2.h - 8);
      });
      ticks.forEach(function (t) {
        if (t < yd[0] || t > yd[1]) return;
        var y = Y(t);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + W, y); ctx.stroke();
        ctx.textAlign = 'right'; ctx.fillText(fmtUsd(t), pad.l - 9, y + 3);
      });
      ctx.textAlign = 'left'; ctx.fillStyle = dim;
      ctx.fillText('TVL across', pad.l, 11);
      ctx.textAlign = 'right';
      ctx.fillText('implied value up', pad.l + W, 11);

      state2.points = rows.map(function (r) {
        return { r: r, x: X(Math.max(1, r.tvl_usd)), y: Y(Math.max(1, r.implied_value_usd)) };
      });
      state2.points.forEach(function (p, i) {
        var active = i === state2.hover;
        ctx.beginPath();
        ctx.arc(p.x, p.y, active ? 5 : p.r.cohort === 'watchlist' ? 3.4 : 2.6, 0, Math.PI * 2);
        ctx.fillStyle = active ? accent : p.r.cohort === 'watchlist' ? accent : muted;
        ctx.globalAlpha = active ? 1 : p.r.cohort === 'watchlist' ? 0.8 : 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      if (state2.hover >= 0) {
        var p2 = state2.points[state2.hover];
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.moveTo(p2.x, pad.t); ctx.lineTo(p2.x, pad.t + H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(pad.l, p2.y); ctx.lineTo(pad.l + W, p2.y); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    function nearest(evt) {
      var rect = canvas.getBoundingClientRect();
      var mx = evt.clientX - rect.left, my = evt.clientY - rect.top, best = -1, bd = 18 * 18;
      state2.points.forEach(function (p, i) {
        var d = (p.x - mx) * (p.x - mx) + (p.y - my) * (p.y - my);
        if (d < bd) { bd = d; best = i; }
      });
      return best;
    }

    canvas.addEventListener('mousemove', function (evt) {
      var i = nearest(evt);
      if (i === state2.hover) return;
      state2.hover = i;
      if (i < 0) { tip.className = 'graph-tip'; canvas.style.cursor = 'crosshair'; draw(); return; }
      var p = state2.points[i], r = p.r;
      canvas.style.cursor = 'pointer';
      tip.className = 'graph-tip on';
      tip.style.left = Math.round(p.x + canvas.offsetLeft) + 'px';
      tip.style.top = Math.round(p.y + canvas.offsetTop) + 'px';
      clear(tip);
      tip.appendChild(h('b', { text: '#' + r.rank + ' ' + r.name }));
      tip.appendChild(h('span', { text: 'implied ' + fmtUsd(r.implied_value_usd) }));
      tip.appendChild(h('span', { text: 'tvl ' + fmtUsd(r.tvl_usd) + ' · ' + r.sector }));
      draw();
    });
    canvas.addEventListener('mouseleave', function () {
      state2.hover = -1; tip.className = 'graph-tip'; draw();
    });
    canvas.addEventListener('click', function (evt) {
      var i = nearest(evt);
      if (i >= 0) openDetail(state2.points[i].r.slug);
    });

    var panel = h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { text: 'Value field' }),
        h('p', { text: 'Each dot is a protocol: TVL across, implied value up. Click one to open it.' })),
      h('div', { class: 'graph-legend' },
        h('span', null, h('i', { style: 'background:var(--accent)' }), 'watchlist floor'),
        h('span', null, h('i', { style: 'background:var(--muted);opacity:.45' }), 'early radar'),
        h('span', { class: 'spacer' })),
      wrap);
    requestAnimationFrame(function () { draw(); });
    if (window.ResizeObserver) new ResizeObserver(function () { draw(); }).observe(canvas);
    else window.addEventListener('resize', draw);
    return panel;
  }

  /* ---------- detail drawer ---------- */

  function splitStep(step) {
    var i = step.indexOf(' Cost: ');
    if (i < 0) return { act: step, cost: '', time: '' };
    var act = step.slice(0, i), tail = step.slice(i + 7), j = tail.indexOf('. Time: ');
    if (j < 0) return { act: act, cost: tail.replace(/\.$/, ''), time: '' };
    return { act: act, cost: tail.slice(0, j), time: tail.slice(j + 8).replace(/\.$/, '') };
  }
  function factorBar(label, valueText, ratio) {
    return h('div', { class: 'factor' },
      h('span', { text: label }),
      h('span', { class: 'fb', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(2, Math.min(100, Math.round(ratio * 100))) + '%' })),
      h('span', { class: 'fv', text: valueText }));
  }

  function detailPanel(row) {
    var steps = (row.farm_steps || []).map(splitStep);
    var low = row.implied_low_usd, high = row.implied_high_usd;
    var pos = high > low ? Math.min(1, Math.max(0, (row.implied_value_usd - low) / (high - low))) : 0.5;
    return h('aside', { class: 'panel detail', id: 'detail', 'aria-label': row.name + ' details' },
      h('div', { class: 'detail-head' },
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '×', onclick: function () { state.selected = null; renderView(); writeHash(); } }),
        h('div', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + D.stats.board_size + ' · ' + (row.cohort === 'watchlist' ? 'watchlist floor' : 'early radar') }),
        h('h2', { text: row.name }),
        h('div', { class: 'meta-row' },
          h('span', { class: 'sector', text: row.sector }),
          h('span', { class: 'tag', text: row.stage }),
          h('span', { class: 'tag', text: (row.chains || []).slice(0, 3).join(' · ') || 'chain unlisted' }))),
      h('div', { class: 'hero-value' },
        h('span', { class: 'label', text: 'Implied value if the record stays as it is' }),
        h('div', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
        h('div', { class: 'rangebar', 'aria-hidden': 'true' }, h('i', { style: 'left:' + Math.round(pos * 100) + '%' })),
        h('div', { class: 'range' }, 'Likely range ', h('b', { text: fmtUsd(low) }), ' – ', h('b', { text: fmtUsd(high) }),
          ' from the q1–q3 spread of ' + row.sector + ' comparables')),
      h('div', { class: 'sect' },
        h('h3', { text: 'How the number is made' }),
        factorBar('TVL', fmtUsd(row.tvl_usd), 1),
        factorBar('Sector multiple', fmtMult(row.multiple), Math.min(1, row.multiple / 1.5)),
        factorBar('7d momentum', fmtMult(row.momentum), Math.min(1, Math.max(0, (row.momentum - 0.6) / 0.8))),
        factorBar('Maturity', fmtMult(row.maturity), Math.min(1, Math.max(0, (row.maturity - 0.5) / 0.6))),
        h('p', { class: 'foot-note', text: 'TVL × sector multiple × momentum × maturity = ' + fmtUsd(row.implied_value_usd) + '. The multiple is the median market cap / TVL of live protocols in ' + row.sector + ', shrunk toward the whole market median.' })),
      h('div', { class: 'sect' },
        h('h3', { text: 'Why it is on the radar' }),
        h('p', { class: 'note', text: row.why_now }),
        h('p', { class: 'note risk', text: row.risk })),
      h('div', { class: 'sect' },
        h('h3', { text: 'Farm plan · 7 steps' }),
        h('ol', { class: 'steps' }, steps.map(function (s) {
          return h('li', null,
            h('span', { class: 'act', text: s.act }),
            h('span', { class: 'tags' },
              s.cost ? h('span', { class: 'tag cost', text: 'Cost: ' + s.cost }) : null,
              s.time ? h('span', { class: 'tag', text: 'Time: ' + s.time }) : null));
        })),
        h('p', { class: 'foot-note', text: 'Capital and hold window are derived from this protocol\'s TVL and age. This is a research note, not financial advice, and a token may never be issued.' })));
  }

  function openDetail(slug) { state.selected = slug; renderView(); writeHash(); }

  /* ---------- live market ---------- */

  function livePanel() {
    var q = state.q.trim().toLowerCase();
    var rows = D.live.filter(function (r) {
      if (state.sector !== 'all' && r.sector !== state.sector) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.rising && !(typeof r.change_7d === 'number' && r.change_7d > 0)) return false;
      if (!q) return true;
      return [r.name, r.sector, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    setCount(rows.length + ' live-token protocols');
    var ratios = D.live.map(function (r) { return r.ratio; }).filter(function (v) { return typeof v === 'number' && isFinite(v) && v > 0; });
    var med = D.market_median;
    var rising = D.live.filter(function (r) { return typeof r.change_7d === 'number' && r.change_7d > 0; }).length;
    var top = D.live.slice().filter(function (r) { return typeof r.ratio === 'number'; }).sort(function (a, b) { return b.ratio - a.ratio; })[0];

    function quantile(list, p) {
      if (!list.length) return null;
      var s = list.slice().sort(function (a, b) { return a - b; });
      var at = (s.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
      return s[lo] + (s[hi] - s[lo]) * (at - lo);
    }
    var spread = [['min', 0], ['q1', 0.25], ['median', 0.5], ['q3', 0.75], ['max', 1]].map(function (q) {
      return { label: q[0], value: quantile(ratios, q[1]) };
    });

    var tbody = h('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', null, h('div', { class: 'pname' }, h('b', { text: r.name }), h('span', { class: 'sub', text: r.category || 'Other' }))),
        h('td', null, h('span', { class: 'sector', text: r.sector })),
        h('td', { class: 'chain', text: (r.chains || []).slice(0, 2).join(', ') || 'n/a' }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: fmtRatio(r.ratio) + 'x' }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d > 0 ? 'pos' : r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'flat'), text: fmtPct(r.change_7d) }),
        h('td', null, h('span', { class: 'live-tag', text: 'trades' }))));
    });

    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { text: 'Live market' }),
        h('p', { text: 'These already trade, so they are never ranked: their market cap is the price the model learns from' })),
      h('div', { class: 'statrow' },
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Market median MC / TVL' }), h('span', { class: 'v', text: fmtRatio(med) + 'x' })),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Live comparables' }), h('span', { class: 'v', text: String(D.live.length), }, h('small', { text: 'protocols' }))),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Rising over 7d' }), h('span', { class: 'v pos', text: String(rising) })),
        h('div', { class: 'stat' }, h('span', { class: 'k', text: 'Highest multiple' }), h('span', { class: 'v', text: top ? fmtRatio(top.ratio) + 'x' : 'n/a' }), h('span', { class: 'sub', text: top ? top.name : '' }))
      ),
      h('div', { class: 'spread-cap', text: 'Market cap / TVL across the live comparables' }),
      h('div', { class: 'spread' }, spread.map(function (q) {
        return h('div', null, h('span', { class: 'k', text: q.label }), h('span', { class: 'v', text: fmtRatio(q.value) + 'x' }));
      })),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'small', style: 'text-align:left;padding:8px 12px;color:var(--dim)' },
            'Market cap / TVL here becomes the sector multiple used on the board. ' + D.stats.live_size + ' protocols shown, market median ' + fmtRatio(D.market_median) + 'x.'),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', text: 'Sector' }), h('th', { scope: 'col', text: 'Chains' }),
            h('th', { scope: 'col', text: 'TVL' }), h('th', { scope: 'col', text: 'Market cap' }), h('th', { scope: 'col', text: 'MC / TVL' }),
            h('th', { scope: 'col', text: '7d' }), h('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  /* ---------- model ---------- */

  function topRows(n) {
    return D.rows.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; }).slice(0, n);
  }

  function modelPanel() {
    var m = D.model;
    var sectors = D.sector_stats.slice().sort(function (a, b) { return b.applied_multiple - a.applied_multiple; });
    var examples = topRows(3).map(function (r) { return r.name + ' ' + fmtUsd(r.implied_value_usd); }).join(' · ');
    return h('section', { class: 'panel' },
      h('div', { class: 'panel-head' },
        h('h2', { text: 'The model behind the board' }),
        h('p', { text: D.model_version + ' · every rule below is applied to all ' + D.stats.board_size + ' rows by one function' })),
      h('div', { class: 'model-grid' },
        h('div', { class: 'card' },
          h('h3', { text: 'Implied value' }),
          h('div', { class: 'formula' },
            'base = tvl_usd × sector_multiple\n',
            'momentum = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 × ' + m.momentum_weight + '\n',
            'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' × (1 − e^(−age_days / ' + m.maturity_days + '))\n',
            h('em', { text: 'implied = round(base × momentum × maturity)' })),
          h('p', { text: 'Age is the time since DefiLlama began tracking the protocol, the snapshot\'s own record of how long it has run with no token. An unlisted age is treated as one year. All three inputs come from the snapshot; no name is special-cased.' }),
          h('p', { class: 'small', text: 'Today the top of the board is ' + examples + '.' })),
        h('div', { class: 'card' },
          h('h3', { text: 'Where the sector multiple comes from' }),
          h('p', { text: 'For every live-token protocol the snapshot carries a market cap and a TVL, so their ratio is the market\'s own price per dollar of TVL. The model takes the median ratio in each sector and shrinks it toward the whole market median with ' + m.prior_live + ' pseudo-observations, clamped to ' + m.min_multiple + 'x–' + m.max_multiple + 'x. A sector with two comparables borrows the market; a sector with twenty speaks for itself.' }),
          h('p', null, 'Market median across all live-token protocols: ', h('b', { text: fmtRatio(D.market_median) + 'x' })),
          h('p', { class: 'small', text: 'The range beside each value is the sector\'s inter-quartile ratio applied to the same row, so thin sectors visibly widen.' })),
        h('div', { class: 'card', style: 'grid-column:1/-1' },
          h('h3', { text: 'Sector multiples learned from this snapshot' }),
          h('table', { class: 'sector-table' },
            h('thead', null, h('tr', null,
              h('th', { text: 'Sector' }), h('th', { text: 'Live comparables' }), h('th', { text: 'Median MC / TVL' }), h('th', { text: 'Applied' }), h('th', { text: 'Raw spread (q1 – q3)' }))),
            h('tbody', null, sectors.map(function (s) {
              return h('tr', null,
                h('td', { text: s.sector }),
                h('td', { class: 'num', text: String(s.live_n) }),
                h('td', { class: 'num', text: fmtRatio(s.median_ratio) + 'x' }),
                h('td', { class: 'num b', text: fmtMult(s.applied_multiple) }),
                h('td', { class: 'num', text: fmtRatio(s.q1) + 'x – ' + fmtRatio(s.q3) + 'x' }));
            }))),
          h('p', { class: 'foot-note', text: 'Applied is each sector median shrunk toward the market median and clamped, so it can sit outside the raw spread. The raw spread is not wasted: it sets how wide that sector\'s likely-value range is on every row.' })),
        h('div', { class: 'card' },
          h('h3', { text: 'Coverage' }),
          h('p', { text: D.stats.watchlist_covered + ' of ' + D.stats.watchlist_size + ' watchlist protocols are on the board. The watchlist is the floor, never the ceiling: ' + D.stats.early_size + ' further pre-token protocols below $' + Math.round(D.floor_usd / 1e6) + 'M of TVL are ranked by the same function.' }),
          h('p', { text: 'The snapshot holds ' + D.stats.universe_size + ' protocols at or above $5M of TVL. ' + D.stats.live_size + ' live-token protocols are kept on their own tab, because a market cap is a fact and an implied value is a claim.' }),
          h('p', { class: 'small', text: 'A protocol that records no token is not proven to have none; DefiLlama may simply not carry it. Every value here is the entry\'s model, not make.fun\'s, and not a promise that a token is issued.' })),
        h('div', { class: 'card' },
          h('h3', { text: 'What the model deliberately ignores' }),
          h('p', { text: 'It does not predict whether or when a token launches, and it does not read a farm plan\'s size into the value. It ranks size, traction and time, nothing else.' }),
          h('p', { text: 'It also does not reward a protocol for being unknown: an early row earns its place by the same TVL, growth and age arithmetic as a watchlist row. The cohort is a label, never a multiplier.' }))));
  }

  /* ---------- shell ---------- */

  function footer() {
    return h('footer', { class: 'foot' },
      h('span', null, h('b', { text: 'Token Radar ' + D.model_version }), ' · snapshot ' + D.as_of + ' · ' + D.stats.universe_size + ' protocols from DefiLlama\'s public index · every figure computed offline by main.ts, no network'),
      h('span', { text: 'Implied value is a stated model, never a promise. Refresh it by running main.ts against a newer snapshot.json. Protocols record no token; that is not proof they have none.' }));
  }

  function renderView() {
    var host = document.getElementById('view');
    if (!host) return;
    clear(host);
    host.className = 'layout';
    if (state.tab === 'live') { host.appendChild(livePanel()); renderChips(); return; }
    if (state.tab === 'model') { host.appendChild(modelPanel()); setCount(D.sector_stats.length + ' sectors'); renderChips(); return; }
    var row = state.selected ? D.rows.filter(function (r) { return r.slug === state.selected; })[0] : null;
    host.appendChild(boardPanel());
    if (row) { host.className = 'layout open'; host.appendChild(detailPanel(row)); }
    renderChips();
  }

  function renderShell() {
    var app = document.getElementById('app');
    clear(app);
    app.appendChild(h('div', { class: 'shell' },
      header(), hero(), toolbar(),
      h('div', { class: 'layout', id: 'view' }),
      footer()));
    app.setAttribute('aria-busy', 'false');
    renderView();
  }

  readHash();
  renderShell();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; renderView(); writeHash(); }
  });
  window.addEventListener('hashchange', function () { readHash(); renderShell(); });
})();

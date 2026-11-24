// Token Radar — the page. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable and sortable table, a detail drawer with the model's own arithmetic and
// the protocol's farm plan, a live-token market tab and a model tab. No network: every byte is in
// data.js and this file.
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

  var state = {
    q: '',
    sector: 'all',
    chain: 'all',
    rising: false,
    tab: 'board',
    sort: 'implied',
    dir: 'desc',
    selected: null
  };

  var MAX_IMPLIED = D.rows.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);

  /* ---------- formatting ---------- */

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '-' : '';
    var a = Math.abs(n);
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
  function fmtMult(n) {
    if (!isFinite(n)) return 'n/a';
    return (n >= 10 ? n.toFixed(1) : n.toFixed(2)) + 'x';
  }
  function fmtRatio(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n >= 10 ? n.toFixed(1) : n.toFixed(2);
  }

  /* ---------- dom ---------- */

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'selected' || k === 'checked') { if (v) node.setAttribute(k, k === 'checked' ? 'checked' : 'selected'); }
        else node.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---------- routing ---------- */

  function readHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (!h) return;
    var p = new URLSearchParams(h);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('sector')) state.sector = p.get('sector');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab')) state.tab = p.get('tab');
    if (p.get('rising') === '1') state.rising = true;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.sector !== 'all') p.set('sector', state.sector);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'board') p.set('tab', state.tab);
    if (state.rising) p.set('rising', '1');
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  /* ---------- filtering ---------- */

  function match(row) {
    var q = state.q.trim().toLowerCase();
    if (state.sector !== 'all' && row.sector !== state.sector) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (state.rising && !(typeof row.change_7d === 'number' && row.change_7d > 0)) return false;
    if (!q) return true;
    var hay = [row.name, row.slug, row.sector, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
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

  /* ---------- header, hero ---------- */

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('div', null,
          el('div', { class: 'brand-name', text: 'TOKEN RADAR' }),
          el('div', { class: 'brand-tag', text: 'pre-token intelligence' })
        )
      ),
      el('div', { class: 'top-meta' },
        el('span', { class: 'meta' }, el('span', { class: 'dot', 'aria-hidden': 'true' }), 'Snapshot ', el('b', { text: D.as_of })),
        el('span', { class: 'meta' }, 'Model ', el('b', { text: D.model_version })),
        el('span', { class: 'meta' }, 'Watchlist ', el('b', { text: D.stats.watchlist_covered + ' / ' + D.stats.watchlist_size }), ' covered')
      )
    );
  }

  function hero() {
    return el('section', { class: 'hero' },
      el('div', null,
        el('div', { class: 'eyebrow' }, el('span', { 'aria-hidden': 'true' }), 'Which pre-token protocol is worth farming next'),
        el('h1', null, 'The token does not exist yet. ', el('em', { text: 'Here is what it would be worth.' })),
        el('p', { class: 'lede-copy' },
          'Every protocol below records no token. The board ranks them by an implied value built from three things the snapshot already knows: ',
          el('b', { text: 'TVL' }), ', ', el('b', { text: 'seven-day growth' }), ' and ', el('b', { text: 'how long the protocol has run without a token' }),
          '. The multiple per dollar of TVL is learned from the live-token protocols in the same sector, so nothing here is a hand-picked name or a promise.'
        )
      ),
      el('div', { class: 'kpis' },
        kpi('Watchlist covered', D.stats.watchlist_covered + ' / ' + D.stats.watchlist_size),
        kpi('Rows scored', String(D.stats.board_size) + ' ', String(D.stats.early_size) + ' below the floor'),
        kpi('Top implied value', fmtUsd(D.stats.top_implied_usd)),
        kpi('Median implied value', fmtUsd(D.stats.median_implied_usd))
      )
    );
  }
  function kpi(label, value, small) {
    return el('div', { class: 'kpi' },
      el('span', { class: 'k', text: label }),
      el('span', { class: 'v' }, value, small ? el('small', { text: small }) : null)
    );
  }

  /* ---------- toolbar ---------- */

  function options(values, current) {
    return values.map(function (v) { return el('option', { value: v, selected: v === current }, v); });
  }

  function toolbar() {
    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search protocol, sector or chain', 'aria-label': 'Search the radar' });
    search.addEventListener('input', function () {
      state.q = search.value;
      renderView();
      writeHash();
    });
    var sector = el('select', { id: 'sector', 'aria-label': 'Filter by sector' },
      el('option', { value: 'all', selected: state.sector === 'all', text: 'All sectors' }),
      options(D.sector_stats.map(function (s) { return s.sector; }), state.sector)
    );
    sector.addEventListener('change', function () { state.sector = sector.value; renderView(); writeHash(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', selected: state.chain === 'all', text: 'All chains' }),
      options(allChains, state.chain)
    );
    chain.addEventListener('change', function () { state.chain = chain.value; renderView(); writeHash(); });
    var rising = el('input', { type: 'checkbox', checked: state.rising, 'aria-label': 'Only protocols rising over seven days' });
    rising.addEventListener('change', function () { state.rising = rising.checked; renderView(); writeHash(); });

    var tabs = [
      ['board', 'Board'],
      ['live', 'Live market'],
      ['model', 'Model']
    ].map(function (t) {
      return el('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { state.tab = t[0]; state.selected = null; renderShell(); writeHash(); } });
    });

    return el('div', null,
      el('div', { class: 'bar', role: 'toolbar' },
        el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tabs),
        el('span', { class: 'field' }, search),
        el('span', { class: 'field' }, sector),
        el('span', { class: 'field' }, chain),
        el('label', { class: 'toggle' }, rising, 'Rising only'),
        el('span', { class: 'spacer' }),
        el('span', { class: 'count', id: 'count' })
      ),
      el('div', { class: 'chips', id: 'chips' })
    );
  }

  function renderChips() {
    var host = document.getElementById('chips');
    if (!host) return;
    clear(host);
    function chip(label, clearIt) {
      return el('span', { class: 'chip' }, label, el('button', { type: 'button', 'aria-label': 'Clear ' + label, text: 'x', onclick: function () { clearIt(); renderShell(); writeHash(); } }));
    }
    if (state.q) host.appendChild(chip('search: ' + state.q, function () { state.q = ''; }));
    if (state.sector !== 'all') host.appendChild(chip('sector: ' + state.sector, function () { state.sector = 'all'; }));
    if (state.chain !== 'all') host.appendChild(chip('chain: ' + state.chain, function () { state.chain = 'all'; }));
    if (state.rising) host.appendChild(chip('rising only', function () { state.rising = false; }));
  }

  /* ---------- board ---------- */

  function sortHeader(key, label, extraClass) {
    var active = state.sort === key;
    return el('th', { scope: 'col', class: extraClass || null, 'aria-sort': active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = state.dir === 'desc' ? 'asc' : 'desc'; else { state.sort = key; state.dir = key === 'name' ? 'asc' : 'desc'; } renderView(); } },
        label,
        active ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir === 'asc' ? '▲' : '▼' }) : null
      )
    );
  }

  function rowNode(r) {
    var growthClass = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : 'flat';
    return el('tr', {
      'data-selected': state.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      'aria-label': 'Rank ' + r.rank + ', ' + r.name,
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
    },
      el('td', { class: 'rank num', text: String(r.rank) }),
      el('td', null, el('div', { class: 'pname' },
        el('b', { text: r.name }),
        el('span', { class: 'sub', text: (r.category || 'Other') + (r.cohort === 'early' ? ' · early radar' : '') })
      )),
      el('td', null, el('span', { class: 'sector', text: r.sector })),
      el('td', { class: 'chain', title: (r.chains || []).join(', '), text: (r.chains || []).slice(0, 2).join(', ') || 'n/a' }),
      el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
      el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
      el('td', { class: 'num', text: fmtAge(r.age_days) }),
      el('td', { class: 'valcell' }, el('div', { class: 'valrow' },
        el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'bar-track', 'aria-hidden': 'true' }, el('span', { class: 'bar-fill', style: 'width:' + Math.max(2, Math.round((r.implied_value_usd / MAX_IMPLIED) * 100)) + '%' }))
      )),
      el('td', { class: 'num mult', text: fmtMult(r.value_per_tvl) })
    );
  }

  function boardPanel() {
    var rows = sorted(D.rows.filter(match));
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' of ' + D.rows.length + ' rows';
    var wrap = el('div', { class: 'table-wrap' });
    if (rows.length === 0) {
      wrap.appendChild(el('div', { class: 'empty' },
        el('h3', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or the sector filter to bring the board back.' }),
        el('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.sector = 'all'; state.chain = 'all'; state.rising = false; renderShell(); writeHash(); } })
      ));
    } else {
      var tbody = el('tbody');
      rows.forEach(function (r) { tbody.appendChild(rowNode(r)); });
      wrap.appendChild(el('table', null,
        el('caption', { class: 'small', style: 'text-align:left;padding:8px 12px;color:#5d7089' },
          'Ranked by implied value, strongest first. Select a row for its arithmetic, its range and its farm plan.'),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          el('th', { scope: 'col', text: 'Sector' }),
          el('th', { scope: 'col', text: 'Chains' }),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'No token'),
          sortHeader('implied', 'Implied value'),
          sortHeader('multiple', 'Value / TVL')
        )),
        tbody
      ));
    }
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Pre-token board' }),
        el('p', { text: 'Watchlist floor $' + Math.round(D.floor_usd / 1e6) + 'M TVL · ' + D.stats.early_size + ' early rows below it' })
      ),
      wrap
    );
  }

  /* ---------- detail drawer ---------- */

  function splitStep(step) {
    var i = step.indexOf(' Cost: ');
    if (i < 0) return { act: step, cost: '', time: '' };
    var act = step.slice(0, i);
    var tail = step.slice(i + 7);
    var j = tail.indexOf('. Time: ');
    if (j < 0) return { act: act, cost: tail.replace(/\.$/, ''), time: '' };
    return { act: act, cost: tail.slice(0, j), time: tail.slice(j + 8).replace(/\.$/, '') };
  }

  function factorBar(label, valueText, ratio) {
    return el('div', { class: 'factor' },
      el('span', { text: label }),
      el('span', { class: 'fb', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(2, Math.min(100, Math.round(ratio * 100))) + '%' })),
      el('span', { class: 'fv', text: valueText })
    );
  }

  function detailPanel(row) {
    var steps = (row.farm_steps || []).map(splitStep);
    var low = row.implied_low_usd, high = row.implied_high_usd;
    return el('aside', { class: 'panel detail', id: 'detail', 'aria-label': row.name + ' details' },
      el('div', { class: 'detail-head' },
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '×', onclick: function () { state.selected = null; renderView(); writeHash(); } }),
        el('div', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + D.stats.board_size + ' · ' + (row.cohort === 'watchlist' ? 'watchlist floor' : 'early radar') }),
        el('h2', { text: row.name }),
        el('div', { class: 'meta-row' },
          el('span', { class: 'sector', text: row.sector }),
          el('span', { class: 'tag', text: row.stage }),
          el('span', { class: 'tag', text: (row.chains || []).slice(0, 3).join(' · ') || 'chain unlisted' })
        )
      ),
      el('div', { class: 'hero-value' },
        el('span', { class: 'label', text: 'Implied value if the record stays as it is' }),
        el('div', { class: 'big', text: fmtUsd(row.implied_value_usd) }),
        el('div', { class: 'range' }, 'Likely range ', el('b', { text: fmtUsd(low) }), ' to ', el('b', { text: fmtUsd(high) }), ' from this sector\'s comparables')
      ),
      el('div', { class: 'sect' },
        el('h3', { text: 'How the number is made' }),
        factorBar('TVL', fmtUsd(row.tvl_usd), 1),
        factorBar('Sector multiple', fmtMult(row.multiple), Math.min(1, row.multiple / 1.5)),
        factorBar('7d momentum', fmtMult(row.momentum), Math.min(1, Math.max(0, (row.momentum - 0.6) / 0.8))),
        factorBar('Maturity', fmtMult(row.maturity), Math.min(1, Math.max(0, (row.maturity - 0.5) / 0.6))),
        el('p', { class: 'foot-note', text: 'TVL x sector multiple x momentum x maturity = ' + fmtUsd(row.implied_value_usd) + '. The multiple is the median market cap / TVL of live protocols in ' + row.sector + ', shrunk toward the whole market\'s median (data.js keeps the exact figures).' })
      ),
      el('div', { class: 'sect' },
        el('h3', { text: 'Why it is on the radar' }),
        el('p', { class: 'note', text: row.why_now }),
        el('p', { class: 'note', text: row.risk })
      ),
      el('div', { class: 'sect' },
        el('h3', { text: 'Farm plan · 7 steps' }),
        el('ol', { class: 'steps' }, steps.map(function (s) {
          return el('li', null,
            el('span', { class: 'act', text: s.act }),
            el('span', { class: 'tags' },
              s.cost ? el('span', { class: 'tag cost', text: 'Cost: ' + s.cost }) : null,
              s.time ? el('span', { class: 'tag time', text: 'Time: ' + s.time }) : null
            )
          );
        })),
        el('p', { class: 'foot-note', text: 'Capital and hold window are derived from this protocol\'s TVL and age. This is a research note, not financial advice, and a token may never be issued.' })
      )
    );
  }

  function openDetail(slug) {
    state.selected = slug;
    renderView();
    writeHash();
  }

  /* ---------- live market ---------- */

  function livePanel() {
    var q = state.q.trim().toLowerCase();
    var rows = D.live.filter(function (r) {
      if (!q) return true;
      return [r.name, r.sector, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var count = document.getElementById('count');
    if (count) count.textContent = rows.length + ' live-token protocols';
    var tbody = el('tbody');
    rows.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', null, el('span', { class: 'sector', text: r.sector })),
        el('td', { class: 'chain', text: (r.chains || []).slice(0, 2).join(', ') || 'n/a' }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: fmtRatio(r.ratio) + 'x' }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d > 0 ? 'pos' : r.change_7d !== null && r.change_7d < 0 ? 'neg' : 'flat'), text: fmtPct(r.change_7d) }),
        el('td', null, el('span', { class: 'live-tag', text: 'trades' }))
      ));
    });
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Live market' }),
        el('p', { text: 'These already trade, so they are never ranked: their market cap is the price the model learns from' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'small', style: 'text-align:left;padding:8px 12px;color:#5d7089' },
            'Market cap / TVL here becomes the sector multiple used on the board. ' + D.stats.live_size + ' protocols shown, market median ' + fmtRatio(D.market_median) + 'x.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Sector' }),
            el('th', { scope: 'col', text: 'Chains' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'MC / TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  /* ---------- model ---------- */

  function topRows(n) {
    return D.rows.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; }).slice(0, n);
  }

  function modelPanel() {
    var m = D.model;
    var sectors = D.sector_stats.slice().sort(function (a, b) { return b.applied_multiple - a.applied_multiple; });
    var top = topRows(3);
    var examples = top.map(function (r) { return r.name + ' ' + fmtUsd(r.implied_value_usd); }).join(' · ');
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'The model behind the board' }),
        el('p', { text: D.model_version + ' · every rule below is applied to all ' + D.stats.board_size + ' rows by one function' })
      ),
      el('div', { class: 'model-grid' },
        el('div', { class: 'card' },
          el('h3', { text: 'Implied value' }),
          el('div', { class: 'formula' },
            'base = tvl_usd x sector_multiple\n',
            'momentum = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ')/100 x ' + m.momentum_weight + '\n',
            'maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x (1 - e^(-age_days / ' + m.maturity_days + '))\n',
            el('em', { text: 'implied = round(base x momentum x maturity)' })
          ),
          el('p', { text: 'Age is the time since DefiLlama began tracking the protocol, the snapshot\'s own record of how long it has run with no token. An unlisted age is treated as one year. All three inputs come from the snapshot; no name is special-cased.' }),
          el('p', { class: 'small', text: 'Today the top of the board is ' + examples + '.' })
        ),
        el('div', { class: 'card' },
          el('h3', { text: 'Where the sector multiple comes from' }),
          el('p', { text: 'For every live-token protocol the snapshot carries a market cap and a TVL, so their ratio is the market\'s own price per dollar of TVL. The model takes the median ratio in each sector and shrinks it toward the whole market\'s median with ' + m.prior_live + ' pseudo-observations, clamped to ' + m.min_multiple + 'x–' + m.max_multiple + 'x. A sector with two comparables borrows the market; a sector with twenty speaks for itself.' }),
          el('p', null, 'Market median across all live-token protocols: ', el('b', { text: fmtRatio(D.market_median) + 'x' })),
          el('p', { class: 'small', text: 'The range beside each value is the sector\'s inter-quartile ratio applied to the same row, so thin sectors visibly widen.' })
        ),
        el('div', { class: 'card', style: 'grid-column:1/-1' },
          el('h3', { text: 'Sector multiples learned from this snapshot' }),
          el('table', { class: 'sector-table' },
            el('thead', null, el('tr', null,
              el('th', { text: 'Sector' }), el('th', { text: 'Live comparables' }), el('th', { text: 'Median MC / TVL' }), el('th', { text: 'Applied' }), el('th', { text: 'Raw spread (q1 – q3)' })
            )),
            el('tbody', null, sectors.map(function (s) {
              return el('tr', null,
                el('td', { text: s.sector }),
                el('td', { class: 'num', text: String(s.live_n) }),
                el('td', { class: 'num', text: fmtRatio(s.median_ratio) + 'x' }),
                el('td', { class: 'num b', text: fmtMult(s.applied_multiple) }),
                el('td', { class: 'num', text: fmtRatio(s.q1) + 'x – ' + fmtRatio(s.q3) + 'x' })
              );
            }))
          ),
          el('p', { class: 'foot-note', text: 'Applied is each sector median shrunk toward the market median and clamped, so it can sit outside the raw spread. The raw spread is not wasted: it sets how wide that sector\'s likely-value range is on every row.' })
        ),
        el('div', { class: 'card' },
          el('h3', { text: 'Coverage' }),
          el('p', { text: D.stats.watchlist_covered + ' of ' + D.stats.watchlist_size + ' watchlist protocols are on the board. The watchlist is the floor, never the ceiling: ' + D.stats.early_size + ' further pre-token protocols below $' + Math.round(D.floor_usd / 1e6) + 'M of TVL are ranked by the same function.' }),
          el('p', { text: 'The snapshot holds ' + D.stats.universe_size + ' protocols at or above $5M of TVL. ' + D.stats.live_size + ' live-token protocols are kept on their own tab, because a market cap is a fact and an implied value is a claim.' }),
          el('p', { class: 'small', text: 'A protocol that records no token is not proven to have none; DefiLlama may simply not carry it. Every value here is the entry\'s model, not make.fun\'s, and not a promise that a token is issued.' })
        ),
        el('div', { class: 'card' },
          el('h3', { text: 'What the model deliberately ignores' }),
          el('p', { text: 'It does not predict whether or when a token launches, and it does not read a farm plan\'s size into the value. It ranks size, traction and time, nothing else.' }),
          el('p', { text: 'It also does not reward a protocol for being unknown: an early row earns its place by the same TVL, growth and age arithmetic as a watchlist row. The cohort is a label, never a multiplier.' })
        )
      )
    );
  }

  /* ---------- shell ---------- */

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', null, el('b', { text: 'Token Radar ' + D.model_version }), ' · snapshot ' + D.as_of + ' · ' + D.stats.universe_size + ' protocols from DefiLlama\'s public index'),
      el('span', { text: 'Implied value is a stated model, never a promise. Protocols record no token; that is not proof they have none.' })
    );
  }

  function renderView() {
    var host = document.getElementById('view');
    if (!host) return;
    clear(host);
    host.className = 'layout';
    if (state.tab === 'live') {
      host.appendChild(livePanel());
      renderChips();
      return;
    }
    if (state.tab === 'model') {
      host.appendChild(modelPanel());
      var c = document.getElementById('count');
      if (c) c.textContent = D.sector_stats.length + ' sectors';
      renderChips();
      return;
    }
    var row = state.selected ? D.rows.filter(function (r) { return r.slug === state.selected; })[0] : null;
    host.appendChild(boardPanel());
    if (row) {
      host.className = 'layout open';
      host.appendChild(detailPanel(row));
    }
    renderChips();
  }

  function renderShell() {
    var app = document.getElementById('app');
    clear(app);
    app.appendChild(el('div', { class: 'shell' },
      header(),
      hero(),
      toolbar(),
      el('div', { class: 'layout', id: 'view' }),
      footer()
    ));
    app.setAttribute('aria-busy', 'false');
    renderView();
  }

  readHash();
  renderShell();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; renderView(); writeHash(); }
  });
  window.addEventListener('hashchange', function () {
    readHash();
    renderShell();
  });
})();

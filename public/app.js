// Spotify Concerts prototype: frontend (vanilla JS, hash router)
const $view = document.getElementById('view');
const $sheet = document.getElementById('sheet');
const $sheetBody = document.getElementById('sheet-body');
let status = { live: false, maxPerFan: 4 };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n).toFixed(2);
const dollars = (n) => '$' + Math.round(n).toLocaleString('en-US');
const fmtNum = (n) => (n == null ? '' : n.toLocaleString('en-US'));
const fmtDur = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const fmtDate = (iso, opts) => new Date(iso).toLocaleDateString('en-US', opts);
const store = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function hueFor(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function avatar(artist, cls = 'avatar') {
  if (artist.image) return `<img class="${cls}" src="${esc(artist.image)}" alt="">`;
  const h = artist.hue ?? hueFor(artist.name);
  return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${h} 60% 45%),hsl(${(h + 60) % 360} 50% 20%))">${esc(artist.name[0])}</div>`;
}

// Pseudo ticket code graphic (visual stand-in for a rotating, signed QR code)
function codeGraphic(code) {
  const n = 11, s = 8;
  let bits = '';
  for (const ch of code) bits += parseInt(ch, 16).toString(2).padStart(4, '0');
  let rects = '';
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const corner = (x < 3 && y < 3) || (x > n - 4 && y < 3) || (x < 3 && y > n - 4);
      const on = corner ? !(x % (n - 1) === 1 || y % (n - 1) === 1) || (x === 1 && y === 1) : bits[(y * n + x) % bits.length] === '1';
      if (on) rects += `<rect x="${x * s}" y="${y * s}" width="${s}" height="${s}"/>`;
    }
  return `<svg width="${n * s}" height="${n * s}" viewBox="0 0 ${n * s} ${n * s}" fill="#000">${rects}</svg>`;
}

// ---------- router ----------
async function route() {
  const [, page, id, tab] = location.hash.split('/');
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (page || 'search')));
  closeSheet();
  try {
    if (page === 'artist' && id) await renderArtist(id, tab || 'popular');
    else if (page === 'tickets') await renderTickets();
    else await renderSearch(decodeURIComponent(id || ''));
  } catch (e) {
    $view.innerHTML = `<div class="pad"><div class="error">${esc(e.message)}</div></div>`;
  }
  $view.scrollTop = 0;
}
window.addEventListener('hashchange', route);

// ---------- search ----------
async function renderSearch(q) {
  $view.innerHTML = `
    <div class="pad">
      <form class="search-bar" id="search-form">
        <div class="search-field">
          <input id="q" placeholder="${status.live ? 'Search any artist on Spotify…' : 'Search artists…'}" value="${esc(q)}" autocomplete="off" />
          <button type="button" class="search-clear" id="q-clear" aria-label="Clear search"${q ? '' : ' hidden'}>✕</button>
        </div>
      </form>
      <h2 class="section-title">Artists</h2>
      <div class="grid" id="results"></div>
    </div>`;
  const $q = document.getElementById('q');
  $q.focus();
  const $clear = document.getElementById('q-clear');
  const clearSearch = () => {
    $q.value = '';
    $clear.hidden = true;
    $q.focus();
    if (q) location.hash = '#/search';
  };
  $q.oninput = () => { $clear.hidden = !$q.value; };
  $q.onkeydown = (e) => { if (e.key === 'Escape' && $q.value) { e.preventDefault(); clearSearch(); } };
  $clear.onclick = clearSearch;
  document.getElementById('search-form').onsubmit = (e) => {
    e.preventDefault();
    location.hash = `#/search/${encodeURIComponent($q.value.trim())}`;
  };
  const artists = await api(`/api/search?q=${encodeURIComponent(q)}`);
  document.getElementById('results').innerHTML = artists.length
    ? artists.map((a) => `
        <a class="card" href="#/artist/${esc(a.id)}">
          ${avatar(a)}
          <h3>${esc(a.name)}</h3>
          <p>Artist${a.genres?.[0] ? ' · ' + esc(a.genres[0]) : ''}</p>
        </a>`).join('')
    : `<p class="empty">No artists found.</p>`;
}

// ---------- artist page ----------
const artistCache = new Map();

async function renderArtist(id, tab) {
  if (!artistCache.has(id)) artistCache.set(id, await api(`/api/artist/${encodeURIComponent(id)}`));
  const { artist, topTracks, concerts } = artistCache.get(id);
  const h = artist.hue ?? hueFor(artist.name);
  const heroBg = artist.image
    ? `background-image:url('${esc(artist.image)}')`
    : `background:linear-gradient(160deg,hsl(${h} 55% 40%),hsl(${(h + 40) % 360} 40% 12%))`;
  const upcoming = concerts.filter((c) => !c.soldOut).length;

  $view.innerHTML = `
    <header class="hero" style="${heroBg}">
      <div>
        <div class="verified"><b>✓</b> Verified Artist</div>
        <h1>${esc(artist.name)}</h1>
        <div class="stats">${artist.monthlyListeners != null ? fmtNum(artist.monthlyListeners) + ' monthly listeners'
          : artist.followers != null ? fmtNum(artist.followers) + ' followers' : ''}</div>
      </div>
    </header>
    <div class="actions">
      <button class="play" aria-label="Play">▶</button>
      <button class="ghost">Follow</button>
    </div>
    <div class="tabs">
      <a class="tab ${tab === 'popular' ? 'active' : ''}" href="#/artist/${esc(id)}/popular">Popular</a>
      <a class="tab ${tab === 'concerts' ? 'active' : ''}" href="#/artist/${esc(id)}/concerts">Concerts<span class="count">${concerts.length}</span></a>
    </div>
    <section class="pad" id="tab-body"></section>`;

  const $body = document.getElementById('tab-body');
  if (tab === 'concerts') return renderConcerts($body, artist, concerts);

  $body.innerHTML = `
    <h2>Popular</h2>
    ${topTracks.length ? `<ol class="tracks">${topTracks.map((t, i) => `
      <li>
        <span>${i + 1}</span>
        ${t.image ? `<img class="thumb" src="${esc(t.image)}" alt="">` : `<div class="thumb" style="background:hsl(${(h + i * 25) % 360} 40% 30%)"></div>`}
        <span class="t-name">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>` : esc(t.name)}${t.artists && t.artists !== artist.name ? `<small>${esc(t.artists)}</small>` : ''}</span>
        <span class="plays">${fmtNum(t.plays)}</span>
        <span>${fmtDur(t.durationMs)}</span>
      </li>`).join('')}</ol>` : `<p class="empty">Top tracks unavailable for this app's API tier.</p>`}
    ${concerts.length ? `
      <div class="on-tour">
        <div>
          <h3>${esc(artist.name)} is on tour</h3>
          <p>${upcoming} upcoming show${upcoming === 1 ? '' : 's'}</p>
        </div>
        <a class="btn" href="#/artist/${esc(id)}/concerts">See concerts</a>
      </div>` : ''}`;
}

function renderConcerts($body, artist, concerts) {
  $body.innerHTML = `
    <h2>On tour</h2>
    <ul class="shows">
      ${concerts.map((c) => {
        const left = c.sections.reduce((n, s) => n + s.remaining, 0);
        const cap = c.sections.reduce((n, s) => n + s.capacity, 0);
        const from = Math.min(...c.sections.filter((s) => !s.soldOut).map((s) => s.price));
        const badge = c.soldOut ? '<span class="badge out">SOLD OUT</span>'
          : left / cap < 0.12 ? '<span class="badge low">LIMITED AVAILABILITY</span>'
          : c.topFanPresale ? '<span class="badge presale">TOP FAN PRESALE</span>' : '';
        return `
          <li class="show">
            <div class="date">
              <div class="mo">${fmtDate(c.date, { month: 'short' })}</div>
              <div class="dy">${fmtDate(c.date, { day: 'numeric' })}</div>
            </div>
            <div>
              <h3>${esc(c.city)}${badge}</h3>
              <p>${esc(c.venue)} · ${fmtDate(c.date, { weekday: 'short' })} ${new Date(c.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}${c.soldOut ? '' : ` · from ${money(from)}`}</p>
            </div>
            <button class="btn" data-concert="${esc(c.id)}" ${c.soldOut ? 'disabled' : ''}>${c.soldOut ? 'Sold out' : 'Get tickets'}</button>
          </li>`;
      }).join('')}
    </ul>`;
  $body.querySelectorAll('[data-concert]').forEach((b) =>
    b.addEventListener('click', () => openCheckout(artist, concerts.find((c) => c.id === b.dataset.concert)))
  );
}

// ---------- checkout ----------
function openSheet(html) {
  const panel = $sheet.querySelector('.sheet-panel');
  const keep = $sheet.hidden ? 0 : panel.scrollTop;
  $sheetBody.innerHTML = html;
  $sheet.hidden = false;
  panel.scrollTop = keep;
}

// Interactive seating map: sections colored by price tier, sold-out sections grayed out.
const TIER_COLORS = ['#2b5b84', '#2e8fa3', '#3fb59a', '#9fd36f', '#f2d45c'];
function priceTiers(sections) {
  const prices = [...new Set(sections.map((s) => s.price))].sort((a, b) => a - b);
  const n = Math.min(TIER_COLORS.length, prices.length);
  const bounds = Array.from({ length: n }, (_, i) => prices[Math.floor((i * prices.length) / n)]);
  const tierOf = (p) => bounds.reduce((t, b, i) => (p >= b ? i : t), 0);
  const ranges = bounds.map((b, i) => [b, i + 1 < n ? prices[prices.indexOf(bounds[i + 1]) - 1] : prices.at(-1)]);
  return { tierOf, ranges, colors: TIER_COLORS.slice(TIER_COLORS.length - n) };
}
function seatMap(concert, selectedId) {
  const mapped = concert.sections.filter((s) => s.shape);
  const { tierOf, ranges, colors } = priceTiers(mapped);
  return `
    <div class="seatmap">
      <svg viewBox="${concert.map.viewBox}" role="group" aria-label="Seating map for ${esc(concert.venue)}">
        <path class="stage" d="${concert.map.stage.d}"/>
        <text class="stage-label" x="${concert.map.stage.lx}" y="${concert.map.stage.ly}">STAGE</text>
        ${mapped.map((s) => `
          <g class="sec ${s.soldOut ? 'out' : ''} ${s.id === selectedId ? 'sel' : ''}" data-section="${esc(s.id)}"
             role="button" tabindex="${s.soldOut ? -1 : 0}" aria-disabled="${s.soldOut}"
             aria-label="${esc(s.name)}, ${s.soldOut ? 'sold out' : money(s.price)}">
            <title>${esc(s.name)} · ${s.soldOut ? 'Sold out' : `${money(s.price)} · ${fmtNum(s.remaining)} left`}</title>
            <path d="${s.shape.d}" style="${s.soldOut ? '' : `fill:${colors[tierOf(s.price)]}`}"/>
            <text x="${s.shape.lx}" y="${s.shape.ly}">${esc(s.short)}</text>
          </g>`).join('')}
      </svg>
      <div class="legend">
        ${ranges.map(([lo, hi], i) => `<span><i style="background:${colors[i]}"></i>${lo === hi ? dollars(lo) : `${dollars(lo)}-${dollars(hi)}`}</span>`).join('')}
        <span><i class="out"></i>Sold out</span>
      </div>
      <p class="map-note">Illustrative layout. Not an official venue chart.</p>
    </div>`;
}
function closeSheet() { $sheet.hidden = true; }
$sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

function openCheckout(artist, concert) {
  const state = { sectionId: null, qty: 1, seats: [], seatData: {}, error: '', busy: false };
  const buyer = store.get('buyer') || { name: '', email: '' };
  const avail = (s) => (s.soldOut ? 'Sold out' : s.remaining < 50 ? `${s.remaining} left` : `${fmtNum(s.remaining)} available`);

  const draw = async () => {
    const section = concert.sections.find((s) => s.id === state.sectionId) || null;
    const seated = Boolean(section?.seated);
    if (seated && !state.seatData[section.id]) {
      state.seatData[section.id] = await api(`/api/seats?concertId=${concert.id}&sectionId=${section.id}`);
    }
    const maxQty = section ? Math.min(status.maxPerFan, section.remaining) : 0;
    if (!seated) state.qty = Math.max(1, Math.min(state.qty, maxQty));
    const qty = seated ? state.seats.length : section ? state.qty : 0;
    const q = qty ? await api(`/api/quote?concertId=${concert.id}&sectionId=${section.id}&quantity=${qty}`) : { subtotal: 0, processing: 0, total: 0 };

    openSheet(`
      <h2 id="sheet-title">${esc(artist.name)}</h2>
      <p class="sub">${esc(concert.venue)}, ${esc(concert.city)} · ${fmtDate(concert.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p>
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}

      ${seatMap(concert, state.sectionId)}
      ${concert.sections.filter((s) => !s.shape).map((s) => `
        <button class="section-opt ${s.id === state.sectionId ? 'selected' : ''}" data-section="${s.id}" ${s.soldOut ? 'disabled' : ''}>
          <span>${esc(s.name)}<small>${avail(s)}</small></span>
          <span class="price">${money(s.price)}</span>
        </button>`).join('')}

      ${!section ? `<p class="hint pick-hint">Select a section to see seats and prices.</p>` : `
        <div class="sec-head">
          <div><b>${esc(section.name)}</b><small>${avail(section)}</small></div>
          <span class="price">${money(section.price)}<small>per ticket</small></span>
        </div>
        ${seated ? seatChart(state.seatData[section.id], state.seats, section) : `
          <div class="qty-row">
            <span>Tickets</span>
            <div class="stepper">
              <button data-qty="-1" ${state.qty <= 1 ? 'disabled' : ''} aria-label="Fewer">−</button>
              <span>${state.qty}</span>
              <button data-qty="1" ${state.qty >= maxQty ? 'disabled' : ''} aria-label="More">+</button>
            </div>
          </div>`}
        <p class="hint">Limit ${status.maxPerFan} tickets per person.</p>

        <div class="label">Your details</div>
        <div class="fields">
          <input id="buyer-name" placeholder="Full name" value="${esc(buyer.name)}" />
          <input id="buyer-email" type="email" placeholder="Email" value="${esc(buyer.email)}" />
        </div>

        <div class="label">Payment</div>
        <div class="wallet"><span class="cc">VISA</span> Visa •••• 4242</div>

        <div class="summary">
          <div class="row"><span>${qty} × ${esc(section.name)}${seated && qty ? `<small>${esc(describeSeats(state.seats))}</small>` : ''}</span><span>${money(q.subtotal)}</span></div>
          <div class="row"><span>Processing fee</span><span>${money(q.processing)}</span></div>
          <div class="row total"><span>Total</span><span>${money(q.total)}</span></div>
        </div>
        <button class="btn block" id="buy" ${state.busy || !qty ? 'disabled' : ''}>${state.busy ? 'Processing…' : !qty ? 'Select seats' : `Buy ${qty} ticket${qty > 1 ? 's' : ''}`}</button>`}
    `);

    const syncBuyer = () => {
      const n = document.getElementById('buyer-name'), e = document.getElementById('buyer-email');
      if (n) buyer.name = n.value;
      if (e) buyer.email = e.value;
    };
    const pick = (b) => {
      if (b.getAttribute('aria-disabled') === 'true' || b.disabled) return;
      syncBuyer();
      if (state.sectionId !== b.dataset.section) { state.sectionId = b.dataset.section; state.seats = []; state.qty = 1; }
      state.error = '';
      draw();
    };
    $sheetBody.querySelectorAll('[data-section]').forEach((b) => {
      b.onclick = () => pick(b);
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(b); } };
    });
    $sheetBody.querySelectorAll('[data-qty]').forEach((b) => b.onclick = () => { syncBuyer(); state.qty += Number(b.dataset.qty); draw(); });
    $sheetBody.querySelector('.seats')?.addEventListener('click', (e) => {
      const seat = e.target.closest('[data-seat]');
      if (!seat || seat.classList.contains('taken')) return;
      syncBuyer();
      const id = seat.dataset.seat;
      if (state.seats.includes(id)) state.seats = state.seats.filter((x) => x !== id);
      else if (state.seats.length < maxQty) state.seats = [...state.seats, id];
      else { state.error = `You can select up to ${maxQty} seats.`; return draw(); }
      state.error = '';
      draw();
    });
    const $buy = document.getElementById('buy');
    if ($buy) $buy.onclick = async () => {
      syncBuyer();
      state.busy = true; state.error = '';
      await draw();
      try {
        const order = await api('/api/checkout', {
          method: 'POST',
          body: { concertId: concert.id, sectionId: section.id, quantity: qty, seats: seated ? state.seats : undefined, buyer },
        });
        store.set('buyer', { name: buyer.name.trim(), email: buyer.email.trim() });
        section.remaining -= qty;
        section.soldOut = section.remaining === 0;
        concert.soldOut = concert.sections.every((s) => s.soldOut);
        showConfirmation(order);
      } catch (e) {
        state.busy = false; state.error = e.message;
        if (seated) { delete state.seatData[section.id]; state.seats = []; } // refresh seat availability
        draw();
      }
    };
  };
  draw().catch((e) => openSheet(`<div class="error">${esc(e.message)}</div>`));
}

// Seat chart for one section, drawn in the section's real shape and orientation
// (as it sits on the venue map).
const ept = (cx, cy, rx, ry, deg) => [cx + rx * Math.sin(deg * Math.PI / 180), cy - ry * Math.cos(deg * Math.PI / 180)];
function seatLayout(geo, rowCount, perRow) {
  const pos = []; // pos[r][n] = [x, y]
  const labels = []; // [[x, y] start, [x, y] end] per row
  if (geo.type === 'rect') {
    const px = geo.w / perRow, py = geo.h / rowCount;
    for (let r = 0; r < rowCount; r++) {
      const y = geo.y + (r + 0.5) * py;
      pos.push(Array.from({ length: perRow }, (_, n) => [geo.x + (n + 0.5) * px, y]));
      labels.push([[geo.x - px * 1.3, y], [geo.x + geo.w + px * 1.3, y]]);
    }
  } else {
    const { cx, cy, inner, outer, a0, a1 } = geo, da = (a1 - a0) / perRow;
    for (let r = 0; r < rowCount; r++) {
      const t = (r + 0.5) / rowCount; // row 1 is the inner edge, closest to the stage/floor
      const rx = inner[0] + (outer[0] - inner[0]) * t, ry = inner[1] + (outer[1] - inner[1]) * t;
      pos.push(Array.from({ length: perRow }, (_, n) => ept(cx, cy, rx, ry, a0 + (n + 0.5) * da)));
      labels.push([ept(cx, cy, rx, ry, a0 - da * 1.1), ept(cx, cy, rx, ry, a1 + da * 1.1)]);
    }
  }
  // Tightest spacing between neighbouring seats in a row (along) and between rows (across).
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let along = Infinity, across = Infinity;
  pos.forEach((row, r) => row.forEach((p, n) => {
    if (n) along = Math.min(along, d(p, row[n - 1]));
    if (r) across = Math.min(across, d(p, pos[r - 1][n]));
  }));
  if (!Number.isFinite(along)) along = across;
  if (!Number.isFinite(across)) across = along;
  if (!Number.isFinite(along)) along = across = 4;
  return { pos, labels, along, across };
}
function seatChart({ rows, perRow, taken }, selected, section) {
  const takenSet = new Set(taken);
  const { pos, labels, along, across } = seatLayout(section.shape.geo, rows.length, perRow);
  const rad = Math.min(along * 0.42, across * 0.38);
  const pitch = Math.min(across, along * 2.5), fs = pitch * 0.75; // sizes row labels
  const pts = [...pos.flat(), ...labels.flat()];
  let x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]));
  const m = pitch * 1.5;
  x0 -= m; x1 += m; y0 -= m; y1 += m;
  const r1 = (n) => Math.round(n * 100) / 100;
  // Fixed on-screen seat size (~12px) no matter how narrow the section is; the panel scrolls if needed.
  const scale = 12 / (rad * 2);

  const seats = rows.map((row, r) => {
    const [[sx, sy], [ex, ey]] = labels[r];
    let out = `<text class="row-label" x="${r1(sx)}" y="${r1(sy)}">${esc(row)}</text><text class="row-label" x="${r1(ex)}" y="${r1(ey)}">${esc(row)}</text>`;
    pos[r].forEach(([x, y], i) => {
      const id = `${row}-${i + 1}`;
      const cls = takenSet.has(id) ? 'taken' : selected.includes(id) ? 'sel' : '';
      out += `<circle class="${cls}" data-seat="${id}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(rad)}"><title>Row ${esc(row)}, Seat ${i + 1}${cls === 'taken' ? ' (unavailable)' : ''}</title></circle>`;
    });
    return out;
  }).join('');
  return `
    <div class="seat-panel">
      <div class="seat-scroll"><svg class="seats" viewBox="${r1(x0)} ${r1(y0)} ${r1(x1 - x0)} ${r1(y1 - y0)}" aria-label="Seat chart for ${esc(section.name)}" style="font-size:${r1(fs)}px;width:${Math.round((x1 - x0) * scale)}px">
        <path class="sec-outline" d="${section.shape.d}" style="stroke-width:${r1(pitch * 0.12)}"/>
        ${seats}
      </svg></div>
      <div class="legend">
        <span><i class="avail"></i>Available</span>
        <span><i class="sel"></i>Selected</span>
        <span><i class="out"></i>Unavailable</span>
      </div>
    </div>`;
}
function describeSeats(ids) {
  const byRow = new Map();
  [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).forEach((id) => {
    const [row, n] = id.split('-');
    byRow.set(row, [...(byRow.get(row) || []), n]);
  });
  return [...byRow].map(([row, ns]) => `Row ${row}, Seat${ns.length > 1 ? 's' : ''} ${ns.join(', ')}`).join(' · ');
}

function ticketHtml(order, t) {
  return `
    <div class="ticket ${order.status === 'refunded' ? 'refunded' : ''}">
      <div class="info">
        <h3>${esc(order.concert.artistName)}</h3>
        <p>${esc(order.concert.venue)} · ${esc(order.concert.city)}</p>
        <p>${fmtDate(order.concert.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(t.section)}${t.row ? ` · Row ${esc(t.row)} · Seat ${esc(t.seat)}` : ''}</p>
        <p>${esc(order.name)}</p>
        <p class="code">${esc(t.id)} · ${esc(t.code)}</p>
      </div>
      <div class="stub">${codeGraphic(t.code)}</div>
    </div>`;
}

function showConfirmation(order) {
  openSheet(`
    <div class="success">
      <div class="check">✓</div>
      <h2 id="sheet-title">Order confirmed</h2>
      <p class="sub">Order ${esc(order.id)} · ${money(order.total)} · confirmation sent to ${esc(order.email)}</p>
    </div>
    ${order.tickets.map((t) => ticketHtml(order, t)).join('')}
    <p class="sub" style="margin-top:16px">Tickets are stored in Spotify and linked to your account. The entry code rotates at the venue, so screenshots cannot be used for entry.</p>
    <a class="btn block" href="#/tickets" style="display:block;text-align:center">View in Your Tickets</a>
  `);
}

// ---------- your tickets ----------
async function renderTickets() {
  const buyer = store.get('buyer');
  $view.innerHTML = `<div class="pad"><h1>Your Tickets</h1><div id="orders"></div></div>`;
  const $orders = document.getElementById('orders');
  if (!buyer?.email) {
    $orders.innerHTML = `<p class="empty">No tickets yet. Find an artist and open their <b>Concerts</b> tab.</p>`;
    return;
  }
  const list = await api(`/api/orders?email=${encodeURIComponent(buyer.email)}`);
  if (!list.length) {
    $orders.innerHTML = `<p class="empty">No tickets yet. Find an artist and open their <b>Concerts</b> tab.</p>`;
    return;
  }
  $orders.innerHTML = list.map((o) => `
    <div class="order">
      <div class="order-top">
        <div>
          <h3>${esc(o.concert.artistName)} · ${esc(o.concert.city)}</h3>
          <p>${esc(o.id)} · ${o.tickets.length} ticket${o.tickets.length > 1 ? 's' : ''} · ${money(o.total)} · ${o.status === 'refunded' ? 'Refunded' : 'Confirmed'}</p>
        </div>
        ${o.status === 'confirmed' ? `<button class="btn danger" data-refund="${esc(o.id)}">Refund at face value</button>` : ''}
      </div>
      ${o.tickets.map((t) => ticketHtml(o, t)).join('')}
    </div>`).join('');
  $orders.querySelectorAll('[data-refund]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.armed !== '1') {
        b.dataset.armed = '1';
        b.textContent = 'Tap again to confirm';
        return;
      }
      b.disabled = true;
      try {
        await api(`/api/orders/${b.dataset.refund}/refund`, { method: 'POST', body: { email: buyer.email } });
        artistCache.clear(); // inventory changed
        renderTickets();
      } catch (e) {
        b.textContent = e.message;
      }
    };
  });
}

// ---------- boot ----------
(async () => {
  try { status = await api('/api/status'); } catch {}
  route();
})();

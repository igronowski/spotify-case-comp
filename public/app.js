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
          <h3>🎤 ${esc(artist.name)} is on tour</h3>
          <p>${upcoming} upcoming show${upcoming === 1 ? '' : 's'} · Tickets available on Spotify</p>
        </div>
        <a class="btn" href="#/artist/${esc(id)}/concerts">See concerts</a>
      </div>` : ''}`;
}

function renderConcerts($body, artist, concerts) {
  $body.innerHTML = `
    <div class="concert-head">
      <div>
        <h2>On tour</h2>
        <p>Sold directly by ${esc(artist.name)} through Spotify</p>
      </div>
    </div>
    <div class="promise">
      <span><b>No</b> service fees</span>
      <span><b>Face value</b> pricing</span>
      <span><b>${status.maxPerFan}</b> ticket limit per fan</span>
      <span><b>Refunds</b> return seats to general sale</span>
    </div>
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
  const firstOpen = concert.sections.find((s) => !s.soldOut);
  const state = { sectionId: firstOpen.id, qty: 1, error: '', busy: false };
  const buyer = store.get('buyer') || { name: '', email: '' };

  const draw = async () => {
    const section = concert.sections.find((s) => s.id === state.sectionId);
    const maxQty = Math.min(status.maxPerFan, section.remaining);
    state.qty = Math.min(state.qty, maxQty);
    const q = await api(`/api/quote?concertId=${concert.id}&sectionId=${section.id}&quantity=${state.qty}`);

    openSheet(`
      <h2 id="sheet-title">${esc(artist.name)} · ${esc(concert.city)}</h2>
      <p class="sub">${esc(concert.venue)} · ${fmtDate(concert.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
      ${state.error ? `<div class="error">${esc(state.error)}</div>` : ''}

      <div class="label">Choose a section</div>
      ${seatMap(concert, state.sectionId)}
      <div class="picked">
        <div><b>${esc(section.name)}</b><small>${section.remaining < 50 ? `Only ${section.remaining} left` : `${fmtNum(section.remaining)} available`}</small></div>
        <span class="price">${money(section.price)}</span>
      </div>
      ${concert.sections.filter((s) => !s.shape).map((s) => `
        <button class="section-opt ${s.id === state.sectionId ? 'selected' : ''}" data-section="${s.id}" ${s.soldOut ? 'disabled' : ''}>
          <span>${esc(s.name)}<small>${s.soldOut ? 'Sold out' : s.remaining < 50 ? `Only ${s.remaining} left` : `${fmtNum(s.remaining)} available`}</small></span>
          <span class="price">${money(s.price)}</span>
        </button>`).join('')}

      <div class="label">Tickets</div>
      <div class="stepper">
        <button data-qty="-1" ${state.qty <= 1 ? 'disabled' : ''} aria-label="Fewer">−</button>
        <span>${state.qty}</span>
        <button data-qty="1" ${state.qty >= maxQty ? 'disabled' : ''} aria-label="More">+</button>
      </div><span class="hint">Max ${status.maxPerFan} per fan</span>

      <div class="label">Your details</div>
      <div class="fields">
        <input id="buyer-name" placeholder="Full name (on ticket)" value="${esc(buyer.name)}" />
        <input id="buyer-email" type="email" placeholder="Email" value="${esc(buyer.email)}" />
      </div>

      <div class="label">Payment</div>
      <div class="wallet"><span class="cc">VISA</span> Spotify Wallet •••• 4242 <span class="hint">(simulated)</span></div>

      <div class="summary">
        <div class="row"><span>${state.qty} × ${esc(section.name)}</span><span>${money(q.subtotal)}</span></div>
        <div class="row zero"><span>Service / facility / order fees</span><b>$0.00</b></div>
        <div class="row"><span>Card processing</span><span>${money(q.processing)}</span></div>
        <div class="row total"><span>Total</span><span>${money(q.total)}</span></div>
      </div>
      <button class="btn block" id="buy" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Processing…' : `Buy ${state.qty} ticket${state.qty > 1 ? 's' : ''} · ${money(q.total)}`}</button>
    `);

    const syncBuyer = () => {
      buyer.name = document.getElementById('buyer-name').value;
      buyer.email = document.getElementById('buyer-email').value;
    };
    const pick = (b) => { if (b.getAttribute('aria-disabled') === 'true') return; syncBuyer(); state.sectionId = b.dataset.section; state.error = ''; draw(); };
    $sheetBody.querySelectorAll('[data-section]').forEach((b) => {
      b.onclick = () => pick(b);
      b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(b); } };
    });
    $sheetBody.querySelectorAll('[data-qty]').forEach((b) => b.onclick = () => { syncBuyer(); state.qty += Number(b.dataset.qty); draw(); });
    document.getElementById('buy').onclick = async () => {
      syncBuyer();
      state.busy = true; state.error = '';
      await draw();
      try {
        const order = await api('/api/checkout', {
          method: 'POST',
          body: { concertId: concert.id, sectionId: state.sectionId, quantity: state.qty, buyer },
        });
        store.set('buyer', { name: buyer.name.trim(), email: buyer.email.trim() });
        section.remaining -= state.qty;
        section.soldOut = section.remaining === 0;
        concert.soldOut = concert.sections.every((s) => s.soldOut);
        showConfirmation(order);
      } catch (e) {
        state.busy = false; state.error = e.message;
        draw();
      }
    };
  };
  draw().catch((e) => openSheet(`<div class="error">${esc(e.message)}</div>`));
}

function ticketHtml(order, t) {
  return `
    <div class="ticket ${order.status === 'refunded' ? 'refunded' : ''}">
      <div class="info">
        <h3>${esc(order.concert.artistName)}</h3>
        <p>${esc(order.concert.venue)} · ${esc(order.concert.city)}</p>
        <p>${fmtDate(order.concert.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · ${esc(t.section)}</p>
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
  const pill = document.getElementById('mode-pill');
  pill.textContent = status.live ? 'Live Spotify search' : 'Real Spotify data';
  pill.classList.add('live');
  route();
})();

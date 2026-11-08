// Spotify "Concerts" tab prototype: artists sell tickets directly to fans through Spotify.
// Zero dependencies. Requires Node 18+ (built-in fetch).
//
//   SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... node server.js
//
// Without credentials it shows the top US artists from data/artists.json
// (refresh with: node scripts/fetch-artists.js). Credentials add search for any artist.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- config ----------
loadDotEnv(path.join(__dirname, '.env'));
const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const LIVE = Boolean(CLIENT_ID && CLIENT_SECRET);
const TICKET_SECRET = process.env.TICKET_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_PER_FAN = 4;            // ticket limit per fan per show
const PROCESSING_RATE = 0.029;    // card processing is the only fee
const PROCESSING_FLAT = 0.30;

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// ---------- Spotify Web API (Client Credentials flow) ----------
let token = { value: null, expires: 0 };

async function spotifyToken() {
  if (token.value && Date.now() < token.expires - 60_000) return token.value;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth failed (${res.status})`);
  const data = await res.json();
  token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 };
  return token.value;
}

async function spotify(pathAndQuery) {
  const res = await fetch('https://api.spotify.com/v1' + pathAndQuery, {
    headers: { Authorization: 'Bearer ' + (await spotifyToken()) },
  });
  if (!res.ok) {
    const err = new Error(`Spotify API ${res.status} on ${pathAndQuery}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const slimArtist = (a) => ({
  id: a.id,
  name: a.name,
  image: a.images?.[0]?.url || null,
  followers: a.followers?.total ?? null,
  popularity: a.popularity ?? 50,
  genres: a.genres || [],
});

// ---------- artist catalog (real Spotify data, built by scripts/fetch-artists.js) ----------
// Top US artists with real photos, top tracks, cover art and play counts. Works without API keys.
const CATALOG = loadCatalog(path.join(__dirname, 'data', 'artists.json'));
const catalogById = new Map(CATALOG.artists.map((a) => [a.id, a]));

function loadCatalog(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch {
    console.warn('No data/artists.json yet. Run: node scripts/fetch-artists.js');
    return { chartDate: null, artists: [] };
  }
}
function catalogArtist(id) {
  const a = catalogById.get(id);
  if (!a) return null;
  const { topTracks, ...artist } = a;
  return artist;
}

// ---------- concerts (simulated: Spotify has no public tour or ticketing API) ----------
// Seating layouts are illustrative (modeled on a typical end-stage concert setup),
// not official venue charts. Section names follow each venue's numbering style.
const VENUES = [
  { name: 'Madison Square Garden', city: 'New York, NY', cap: 19500, layout: 'arena', lower: ['Section', 101, 22], upper: ['Section', 201, 26] },
  { name: 'Kia Forum', city: 'Los Angeles, CA', cap: 17500, layout: 'arena', lower: ['Section', 101, 20], upper: ['Section', 201, 24] },
  { name: 'United Center', city: 'Chicago, IL', cap: 20000, layout: 'arena', lower: ['Section', 101, 22], upper: ['Section', 301, 28] },
  { name: 'Red Rocks Amphitheatre', city: 'Morrison, CO', cap: 9500, layout: 'amphitheater' },
  { name: 'Chase Center', city: 'San Francisco, CA', cap: 18000, layout: 'arena', lower: ['Section', 101, 20], upper: ['Section', 201, 24] },
  { name: 'Moody Center', city: 'Austin, TX', cap: 15000, layout: 'arena', lower: ['Section', 101, 18], upper: ['Section', 201, 22] },
  { name: 'TD Garden', city: 'Boston, MA', cap: 19000, layout: 'arena', lower: ['Loge', 1, 22], upper: ['Balcony', 301, 26] },
  { name: 'Climate Pledge Arena', city: 'Seattle, WA', cap: 17100, layout: 'arena', lower: ['Section', 101, 20], upper: ['Section', 201, 24] },
  { name: 'State Farm Arena', city: 'Atlanta, GA', cap: 16500, layout: 'arena', lower: ['Section', 101, 20], upper: ['Section', 201, 22] },
  { name: 'Scotiabank Arena', city: 'Toronto, ON', cap: 19800, layout: 'arena', lower: ['Section', 101, 22], upper: ['Section', 301, 28] },
  { name: 'The O2', city: 'London, UK', cap: 20000, layout: 'arena', lower: ['Block', 101, 18], upper: ['Block', 401, 22] },
  { name: 'Accor Arena', city: 'Paris, FR', cap: 20300, layout: 'arena', lower: ['Bloc', 101, 20], upper: ['Bloc', 201, 22] },
];

// ---------- seating map geometry (SVG paths, stage at the top) ----------
const MAP_W = 560, MAP_H = 480;
const f1 = (n) => Math.round(n * 10) / 10;
// Point on an ellipse; angle in degrees, 0 = top (stage), increasing clockwise.
const pt = (cx, cy, rx, ry, deg) => [cx + rx * Math.sin(deg * Math.PI / 180), cy - ry * Math.cos(deg * Math.PI / 180)];
function ringSector(cx, cy, inner, outer, a0, a1) {
  const [x0, y0] = pt(cx, cy, outer[0], outer[1], a0), [x1, y1] = pt(cx, cy, outer[0], outer[1], a1);
  const [x2, y2] = pt(cx, cy, inner[0], inner[1], a1), [x3, y3] = pt(cx, cy, inner[0], inner[1], a0);
  const d = `M${f1(x0)} ${f1(y0)}A${outer[0]} ${outer[1]} 0 0 1 ${f1(x1)} ${f1(y1)}L${f1(x2)} ${f1(y2)}A${inner[0]} ${inner[1]} 0 0 0 ${f1(x3)} ${f1(y3)}Z`;
  const mid = (a0 + a1) / 2;
  const [lx, ly] = pt(cx, cy, (inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2, mid);
  return { d, lx: f1(lx), ly: f1(ly) };
}
const rectPath = (x, y, w, h) => ({ d: `M${x} ${y}h${w}v${h}h${-w}Z`, lx: x + w / 2, ly: y + h / 2 });
const label = (start, i) => String(start + i);

// Returns [{ id, name, short, tier, base, share, shape }] plus the stage shape.
function seatingPlan(venue) {
  const cx = MAP_W / 2;
  if (venue.layout === 'amphitheater') {
    const cy = 50, bands = 6, rows = 70;
    const sections = [];
    const fan = [['R', 'Right', 132, 160], ['C', 'Center', 162, 198], ['L', 'Left', 200, 228]];
    for (let b = 0; b < bands; b++) {
      const r0 = 58 + b * 52, r1 = r0 + 48;
      const rowFrom = Math.round((b * rows) / bands) + 1, rowTo = Math.round(((b + 1) * rows) / bands);
      for (const [k, side, a0, a1] of fan) {
        sections.push({
          id: `rows${rowFrom}${k}`, name: `Rows ${rowFrom}-${rowTo} ${side}`, short: `${rowFrom}-${rowTo}`, rowFrom, rowTo,
          base: 120 * (1.3 - b * 0.13) * (k === 'C' ? 1.1 : 1),
          share: (0.98 / bands / 3) * (1 + b * 0.08) / 1.2,
          shape: ringSector(cx, cy, [r0, r0], [r1, r1], a0, a1),
        });
      }
    }
    return { sections, stage: { d: `M${cx - 60} 10h120v34h-120Z`, lx: cx, ly: 27 }, viewBox: `0 0 ${MAP_W} 430` };
  }

  const cy = 245;
  const [lLabel, lStart, lCount] = venue.lower;
  const [uLabel, uStart, uCount] = venue.upper;
  const sections = [
    { id: 'pit', name: 'Floor Pit (standing)', short: 'PIT', standing: true, base: 140, share: 0.08, shape: rectPath(cx - 62, cy - 84, 124, 32) },
    { id: 'floorA', name: 'Floor A', short: 'A', base: 115, share: 0.057, shape: rectPath(cx - 62, cy - 46, 39, 86) },
    { id: 'floorB', name: 'Floor B', short: 'B', base: 125, share: 0.057, shape: rectPath(cx - 19.5, cy - 46, 39, 86) },
    { id: 'floorC', name: 'Floor C', short: 'C', base: 115, share: 0.057, shape: rectPath(cx + 23, cy - 46, 39, 86) },
  ];
  const ring = (lbl, start, count, inner, outer, gap, base, totalShare, prefix) => {
    const from = gap, to = 360 - gap, step = (to - from) / count;
    for (let i = 0; i < count; i++) {
      const a0 = from + i * step + 0.6, a1 = from + (i + 1) * step - 0.6;
      const mid = (a0 + a1) / 2;
      const nearStage = 1 - Math.abs(mid - 180) / 180;      // 0 = far end, ~1 = beside the stage
      const sideView = Math.abs(Math.sin(mid * Math.PI / 180)); // 1 = side-on, 0 = straight on
      const n = label(start, i);
      sections.push({
        id: `${prefix}${n}`, name: `${lbl} ${n}`, short: n,
        base: base * (0.8 + 0.45 * nearStage * (0.6 + 0.4 * sideView)),
        share: totalShare / count,
        shape: ringSector(cx, cy, inner, outer, a0, a1),
      });
    }
  };
  ring(lLabel, lStart, lCount, [152, 122], [200, 165], 38, 95, 0.35, 'L');
  ring(uLabel, uStart, uCount, [206, 171], [266, 226], 32, 52, 0.38, 'U');
  return { sections, stage: { d: `M${cx - 48} ${cy - 124}h96v32h-96Z`, lx: cx, ly: cy - 108 }, viewBox: `0 0 ${MAP_W} ${MAP_H}` };
}

const concertsByArtist = new Map(); // artistId -> concert[]
const concertsById = new Map();     // concertId -> concert (holds live inventory)
const orders = new Map();           // orderId -> order

function getConcerts(artist) {
  if (concertsByArtist.has(artist.id)) return concertsByArtist.get(artist.id);
  const rand = seeded(artist.id);
  const demand = 0.6 + (artist.popularity / 100) * 1.2; // price scales with popularity
  const count = 5 + Math.floor(rand() * 4);
  const venues = shuffle(VENUES, rand).slice(0, count);
  let day = 14 + Math.floor(rand() * 20);

  const list = venues.map((v, i) => {
    day += 2 + Math.floor(rand() * 9);
    const date = new Date();
    date.setHours(20, 0, 0, 0);
    date.setDate(date.getDate() + day);
    const id = `${artist.id}-c${i}`;
    const heat = Math.min(0.9, 0.15 + rand() * 0.4) * (artist.popularity / 90); // how quickly this show is selling
    const market = 0.9 + rand() * 0.25; // prices vary a little from city to city
    const mk = ({ id: sid, name, short, base, share, shape, standing, rowFrom, rowTo }) => {
      let capacity = Math.max(20, Math.round(v.cap * share));
      const soldShare = Math.min(1, Math.max(0, heat * (0.6 + rand() * 0.8)));
      const section = { id: sid, name, short, shape, price: Math.max(25, Math.round((base * demand * market) / 5) * 5) };
      if (shape && !standing) {
        // Reserved seating: lay the section out as rows x seats and mark some seats as already sold.
        const rows = rowFrom
          ? Array.from({ length: rowTo - rowFrom + 1 }, (_, r) => String(rowFrom + r))
          : Array.from({ length: Math.ceil(capacity / Math.max(8, Math.min(30, Math.round(Math.sqrt(capacity * 1.6))))) }, (_, r) => String(r + 1));
        const perRow = Math.max(8, Math.round(capacity / rows.length));
        const taken = new Set();
        rows.forEach((row, r) => {
          const p = Math.min(0.95, soldShare * (1.15 - (0.5 * r) / rows.length)); // front rows sell first
          for (let n = 1; n <= perRow; n++) if (rand() < p) taken.add(`${row}-${n}`);
        });
        capacity = rows.length * perRow;
        section.seating = { rows, perRow, taken };
        section.remaining = capacity - taken.size;
      } else {
        section.remaining = Math.max(0, Math.round(capacity * (1 - soldShare)));
      }
      section.capacity = capacity;
      return section;
    };
    const plan = seatingPlan(v);
    const concert = {
      id, artistId: artist.id, artistName: artist.name,
      venue: v.name, city: v.city, date: date.toISOString(),
      tour: `${artist.name}: Live ${new Date().getFullYear() + 1}`,
      topFanPresale: i < 2, // hypothetical: early access for top listeners
      map: { viewBox: plan.viewBox, stage: plan.stage, layout: v.layout },
      sections: [
        ...plan.sections.map(mk),
        mk({ id: 'vip', name: 'VIP Soundcheck Package', short: 'VIP', base: 295, share: 0.01, shape: null }),
      ],
    };
    concertsById.set(id, concert);
    return concert;
  });
  concertsByArtist.set(artist.id, list);
  return list;
}

// Concerts are generated on demand; rebuild an artist's tour if the server restarted
// (for example after a free host wakes from sleep) and a page still has the old concert ID.
async function findConcert(concertId) {
  if (concertsById.has(concertId)) return concertsById.get(concertId);
  const artistId = String(concertId || '').replace(/-c\d+$/, '');
  try {
    const artist = artistId && (await loadArtist(artistId));
    if (artist) getConcerts(artist);
  } catch {}
  return concertsById.get(concertId) || null;
}

function publicConcert(c) {
  return {
    ...c,
    sections: c.sections.map(({ seating, ...s }) => ({ ...s, seated: Boolean(seating), soldOut: s.remaining === 0 })),
    soldOut: c.sections.every((s) => s.remaining === 0),
  };
}

function fees(subtotal) {
  const processing = +(subtotal * PROCESSING_RATE + PROCESSING_FLAT).toFixed(2);
  return {
    subtotal,
    processing,
    total: +(subtotal + processing).toFixed(2),
    // What a typical third-party ticketing site would add (service + facility + order fees)
  };
}

const seatLabel = (id) => { const [row, n] = id.split('-'); return `Row ${row} Seat ${n}`; };

function signTicket(ticketId, orderId) {
  return crypto.createHmac('sha256', TICKET_SECRET).update(`${ticketId}:${orderId}`).digest('hex').slice(0, 24);
}

// ---------- helpers ----------
function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Invalid JSON')); } });
  });
}

async function loadArtist(id) {
  if (catalogById.has(id)) return catalogArtist(id);
  if (!LIVE) return null;
  return slimArtist(await spotify(`/artists/${encodeURIComponent(id)}`));
}

// ---------- routes ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (p === '/api/status') return send(res, 200, { live: LIVE, maxPerFan: MAX_PER_FAN, chartDate: CATALOG.chartDate });

  if (p === '/api/search') {
    const q = (url.searchParams.get('q') || '').trim();
    if (!q || !LIVE) {
      const list = CATALOG.artists.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
      return send(res, 200, list.map((a) => catalogArtist(a.id)));
    }
    const data = await spotify(`/search?type=artist&limit=8&q=${encodeURIComponent(q)}`);
    return send(res, 200, data.artists.items.map(slimArtist));
  }

  let m;
  if ((m = p.match(/^\/api\/artist\/([\w-]+)$/))) {
    const artist = await loadArtist(m[1]);
    if (!artist) return send(res, 404, { error: 'Artist not found' });
    let topTracks;
    if (catalogById.has(artist.id)) {
      topTracks = catalogById.get(artist.id).topTracks;
    } else {
      try {
        const t = await spotify(`/artists/${artist.id}/top-tracks?market=US`);
        topTracks = t.tracks.slice(0, 5).map((x) => ({
          id: x.id, name: x.name, album: x.album?.name, image: x.album?.images?.at(-1)?.url,
          durationMs: x.duration_ms, plays: null, url: x.external_urls?.spotify,
        }));
      } catch { topTracks = []; } // endpoint access varies by app tier
    }
    return send(res, 200, { artist, topTracks, concerts: getConcerts(artist).map(publicConcert) });
  }

  if (p === '/api/checkout' && req.method === 'POST') {
    const { concertId, sectionId, quantity, seats, buyer } = await readJson(req);
    const concert = await findConcert(concertId);
    const section = concert?.sections.find((s) => s.id === sectionId);
    const seatIds = section?.seating ? [...new Set(Array.isArray(seats) ? seats.map(String) : [])] : null;
    const qty = seatIds ? seatIds.length : Number(quantity);
    const email = String(buyer?.email || '').trim().toLowerCase();
    const name = String(buyer?.name || '').trim();

    if (!section) return send(res, 404, { error: 'Show or section not found' });
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Name and a valid email are required' });
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_PER_FAN) return send(res, 400, { error: `Choose 1–${MAX_PER_FAN} tickets` });

    const already = [...orders.values()]
      .filter((o) => o.concertId === concertId && o.email === email && o.status === 'confirmed')
      .reduce((n, o) => n + o.tickets.length, 0);
    if (already + qty > MAX_PER_FAN) {
      return send(res, 409, { error: `Limit is ${MAX_PER_FAN} tickets per fan for this show. You already have ${already}.` });
    }
    if (seatIds) {
      const { rows, perRow, taken } = section.seating;
      const valid = (id) => { const [row, n] = id.split('-'); return rows.includes(row) && Number(n) >= 1 && Number(n) <= perRow; };
      if (!seatIds.every(valid)) return send(res, 400, { error: 'Invalid seat selection' });
      const gone = seatIds.filter((id) => taken.has(id));
      if (gone.length) return send(res, 409, { error: `Sorry, ${gone.map(seatLabel).join(', ')} ${gone.length > 1 ? 'were' : 'was'} just taken. Please pick again.`, taken: gone });
      seatIds.forEach((id) => taken.add(id)); // single-threaded Node: check+claim is atomic
    } else if (section.remaining < qty) {
      return send(res, 409, { error: `Only ${section.remaining} left in ${section.name}` });
    }

    section.remaining -= qty;
    const orderId = 'SPT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const sortedSeats = seatIds && seatIds.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const tickets = Array.from({ length: qty }, (_, i) => {
      const ticketId = `${orderId}-${i + 1}`;
      const [row, seat] = sortedSeats ? sortedSeats[i].split('-') : [];
      return { id: ticketId, section: section.name, row: row || null, seat: seat || null, code: signTicket(ticketId, orderId) };
    });
    const order = {
      id: orderId, status: 'confirmed', createdAt: new Date().toISOString(),
      concertId, sectionId, seats: sortedSeats || null, email, name, unitPrice: section.price,
      concert: { artistName: concert.artistName, venue: concert.venue, city: concert.city, date: concert.date, tour: concert.tour },
      tickets, ...fees(section.price * qty),
    };
    orders.set(orderId, order);
    return send(res, 201, order);
  }

  if (p === '/api/seats') {
    const concert = await findConcert(url.searchParams.get('concertId'));
    const section = concert?.sections.find((s) => s.id === url.searchParams.get('sectionId'));
    if (!section?.seating) return send(res, 404, { error: 'Not found' });
    const { rows, perRow, taken } = section.seating;
    return send(res, 200, { rows, perRow, taken: [...taken] });
  }

  if (p === '/api/quote') {
    const concert = await findConcert(url.searchParams.get('concertId'));
    const section = concert?.sections.find((s) => s.id === url.searchParams.get('sectionId'));
    if (!section) return send(res, 404, { error: 'Not found' });
    const qty = Math.max(1, Math.min(MAX_PER_FAN, Number(url.searchParams.get('quantity')) || 1));
    return send(res, 200, fees(section.price * qty));
  }

  if (p === '/api/orders') {
    const email = (url.searchParams.get('email') || '').trim().toLowerCase();
    return send(res, 200, [...orders.values()].filter((o) => o.email === email).reverse());
  }

  // Face-value refund: seats go back on sale to other fans at face value.
  if ((m = p.match(/^\/api\/orders\/([\w-]+)\/refund$/)) && req.method === 'POST') {
    const { email } = await readJson(req);
    const order = orders.get(m[1]);
    if (!order || order.email !== String(email || '').trim().toLowerCase()) return send(res, 404, { error: 'Order not found' });
    if (order.status !== 'confirmed') return send(res, 409, { error: 'Order already refunded' });
    order.status = 'refunded';
    const section = (await findConcert(order.concertId))?.sections.find((s) => s.id === order.sectionId);
    if (section) {
      section.remaining += order.tickets.length;
      order.seats?.forEach((id) => section.seating?.taken.delete(id));
    }
    return send(res, 200, order);
  }

  if (p.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

  // static files
  const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(__dirname, 'public'))) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http
  .createServer((req, res) =>
    handle(req, res).catch((err) => {
      console.error(err.message);
      send(res, err.status === 404 ? 404 : 502, { error: err.message });
    })
  )
  .listen(PORT, () => {
    console.log(`Spotify Concerts prototype → http://localhost:${PORT}`);
    console.log(`Artists: ${CATALOG.artists.length} top US artists (chart ${CATALOG.chartDate || 'n/a'})`);
    console.log(LIVE ? 'Search: any artist (Spotify Web API)' : 'Search: chart artists only (add Spotify keys to .env to search any artist)');
  });

// Builds data/artists.json: the current top US artists on Spotify, plus a few
// hand-picked extras, with real photos, top tracks, cover art and play counts.
// No Spotify API keys needed.
//
//   node scripts/fetch-artists.js
//
// Sources:
//   - kworb.net Spotify US daily chart -> artists ranked by 7-day US streams
//   - kworb.net monthly listeners + per-artist song totals -> real play counts
//   - open.spotify.com embed + oEmbed -> artist photo, top tracks, cover art

const fs = require('fs');
const path = require('path');

const TOP_N = 70;
const TRACKS_PER_ARTIST = 5;
const EXTRA_ARTISTS = {           // always included, even if not in the top 20
  '3TVXtAsR1Inumwj472S9r4': 'Drake',
  '7kNqXtgeIwFtelmRjWv205': 'John Summit',
  '0Y5tJX1MQlPlqiwlOH1tJY': 'Travis Scott',
  '1RyvyyTE3xzB2ZywiAwp0i': 'Future',
};
const OUT = path.join(__dirname, '..', 'data', 'artists.json');
const UA = { 'User-Agent': 'Mozilla/5.0 (concerts-prototype data script)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, type = 'text') {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: UA });
    if (res.ok) return type === 'json' ? res.json() : res.text();
    if (attempt >= 6 || res.status === 404) throw new Error(`${res.status} ${url}`);
    // Back off when rate-limited (429), honoring Retry-After when given.
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 2000 * 2 ** (attempt - 1));
  }
}
const num = (s) => Number(String(s).replace(/,/g, '')) || 0;
const unescapeHtml = (s) => s.replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const bigImage = (url) => url && url.replace(/^https:\/\/image-cdn-\w+\.spotifycdn\.com\/image\//, 'https://i.scdn.co/image/')
  .replace(/^(https:\/\/i\.scdn\.co\/image\/ab676161)00005174/, '$10000e5eb'); // 320px -> 640px artist photo

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Rank artists by total 7-day streams across the US daily Top 200.
async function topUsArtists() {
  const html = await get('https://kworb.net/spotify/country/us_daily.html');
  const date = html.match(/United States - (\d{4}\/\d{2}\/\d{2})/)?.[1] || null;
  const totals = new Map();
  for (const row of html.split('<tr>').slice(1)) {
    const cells = [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((m) => m[1]);
    if (cells.length < 9) continue;
    const sevenDay = num(cells[8]);
    for (const [, id, name] of cells[2].matchAll(/href="\.\.\/artist\/(\w{22})\.html">([^<]+)<\/a>/g)) {
      const t = totals.get(id) || { id, name: unescapeHtml(name), streams: 0 };
      t.streams += sevenDay;
      totals.set(id, t);
    }
  }
  const ranked = [...totals.values()].sort((a, b) => b.streams - a.streams).slice(0, TOP_N);
  return { date, ranked };
}

async function monthlyListeners() {
  const html = await get('https://kworb.net/spotify/listeners.html');
  const map = new Map();
  for (const m of html.matchAll(/artist\/(\w{22})_songs\.html">[^<]+<\/a><\/div><\/td><td>([\d,]+)<\/td>/g)) map.set(m[1], num(m[2]));
  return map;
}

async function songTotals(artistId) {
  try {
    const html = await get(`https://kworb.net/spotify/artist/${artistId}_songs.html`);
    const map = new Map();
    for (const m of html.matchAll(/open\.spotify\.com\/track\/(\w{22})"[^>]*>([^<]*)<\/a><\/div><\/td><td>([\d,]+)<\/td>/g)) {
      const plays = num(m[3]);
      const byName = 'name:' + normTitle(unescapeHtml(m[2]));
      if (!map.has(m[1])) map.set(m[1], plays);
      map.set(byName, Math.max(map.get(byName) || 0, plays)); // same song released under several IDs
    }
    return map;
  } catch { return new Map(); }
}
const normTitle = (s) => s.toLowerCase().replace(/\s*[([].*?[)\]]/g, '').replace(/\s+-\s+.*$/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

async function artistDetails(id) {
  const html = await get(`https://open.spotify.com/embed/artist/${id}`);
  const json = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s)?.[1];
  if (!json) throw new Error(`No embed data for artist ${id}`);
  const e = JSON.parse(json).props.pageProps.state.data.entity;
  const photo = await get(`https://open.spotify.com/oembed?url=https://open.spotify.com/artist/${id}`, 'json')
    .then((d) => d.thumbnail_url).catch(() => e.visualIdentity?.image?.[0]?.url);
  return { name: e.name, image: bigImage(photo), trackList: e.trackList || [] };
}

async function coverArt(trackId) {
  try {
    const d = await get(`https://open.spotify.com/oembed?url=https://open.spotify.com/track/${trackId}`, 'json');
    return d.thumbnail_url || null;
  } catch { return null; }
}

// Ticket prices in the app scale with this 0-99 score.
const popularityFrom = (listeners) => listeners ? Math.max(40, Math.min(99, Math.round(60 + 20 * Math.log10(listeners / 1e6)))) : 60;

async function main() {
  console.log('Fetching US chart…');
  const [{ date, ranked }, listeners] = await Promise.all([topUsArtists(), monthlyListeners()]);
  const list = ranked.map((a, i) => ({ id: a.id, name: a.name, usRank: i + 1 }));
  for (const [id, name] of Object.entries(EXTRA_ARTISTS)) if (!list.some((a) => a.id === id)) list.push({ id, name, usRank: null });

  // Reuse what the last run saved: cover art by track, and whole artists if a fetch fails.
  let previous = [];
  try { previous = JSON.parse(fs.readFileSync(OUT, 'utf8')).artists || []; } catch {}
  const prevArtist = new Map(previous.map((a) => [a.id, a]));
  const prevCover = new Map(previous.flatMap((a) => a.topTracks.map((t) => [t.id, t.image])));

  const results = await mapLimit(list, 2, async (a) => {
    try { return await buildArtist(a); }
    catch (e) {
      const old = prevArtist.get(a.id);
      console.warn(`  ! ${a.name}: ${e.message}${old ? ' (kept previous data)' : ' (skipped)'}`);
      return old ? { ...old, usRank: a.usRank } : null;
    }
  });
  const artists = results.filter(Boolean);

  async function buildArtist(a) {
    const [details, plays] = await Promise.all([artistDetails(a.id), songTotals(a.id)]);
    const tracks = await mapLimit(details.trackList.slice(0, TRACKS_PER_ARTIST), 2, async (t) => {
      const id = t.uri.split(':').pop();
      return {
        id,
        name: t.title,
        artists: t.subtitle?.replace(/ /g, ' ') || details.name,
        image: prevCover.get(id) || await coverArt(id),
        durationMs: t.duration,
        plays: plays.get(id) ?? plays.get('name:' + normTitle(t.title)) ?? null,
        url: `https://open.spotify.com/track/${id}`,
      };
    });
    const ml = listeners.get(a.id) ?? null;
    console.log(`  ${a.usRank ? '#' + a.usRank : '+ '}\t${details.name}\t${tracks.length} tracks`);
    return {
      id: a.id,
      name: details.name || a.name,
      image: details.image,
      usRank: a.usRank,
      monthlyListeners: ml,
      popularity: popularityFrom(ml),
      genres: [],
      url: `https://open.spotify.com/artist/${a.id}`,
      topTracks: tracks,
    };
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ chartDate: date, fetchedAt: new Date().toISOString(), artists }, null, 2));
  console.log(`Wrote ${artists.length} artists to ${path.relative(process.cwd(), OUT)} (US chart ${date})`);
}

main().catch((e) => { console.error(e); process.exit(1); });

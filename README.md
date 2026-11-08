# Spotify Concerts: Direct Ticketing (prototype)

A concept for a Spotify feature: each artist page gets a **Concerts** tab where fans can
buy tickets inside the app. The artist sells tickets directly through Spotify at face value,
without a separate ticketing platform.

## Run

```bash
node server.js
open http://localhost:3000
```

The home page lists the top artists on Spotify in the US, plus Travis Scott, John Summit and Future. Artist photos, top tracks, album covers, play counts and monthly listeners are real Spotify data. It's stored in `data/artists.json`. To refresh it from the latest US chart (no API keys needed):

```bash
node scripts/fetch-artists.js   # then restart the server
```

It ranks artists by total streams on Spotify's US Top 200 over the last 7 days (via [kworb.net](https://kworb.net/spotify/country/us_daily.html)), then pulls photos, top tracks and cover art from Spotify's public embed pages. To always include other artists, add them to `EXTRA_ARTISTS` at the top of the script.

### Search any artist on Spotify

1. Create an app at https://developer.spotify.com/dashboard
2. Copy `.env.example` to `.env` and fill in the Client ID and Secret
3. `node server.js`. Search now finds any artist on Spotify, not just the ones in the chart

Requires Node 18+ and nothing else. There are no npm dependencies.

## What uses the real Spotify Web API

| Data | Endpoint |
|---|---|
| Artist search | `GET /v1/search?type=artist` |
| Name, photo, followers, genres | `GET /v1/artists/{id}` |
| Popular tracks | `GET /v1/artists/{id}/top-tracks` (if your app tier allows it) |

Auth uses the Client Credentials flow on the server, so the secret never reaches the browser.

## What's hypothetical

Spotify has no public tour or ticketing API, so these parts are simulated on the server:

- **Tour dates.** Generated the same way every time for each artist. Prices scale with artist popularity.
- **Inventory.** Kept in memory per section, and the check and the decrement happen as one step, so a section can't oversell.
- **Checkout.** Payment is simulated ("Spotify Wallet"). The only fee is card processing (2.9% + $0.30).
- **Purchase limits.** Each fan can buy at most 4 tickets per show. Tickets are tied to the buyer's name and carry an HMAC-signed code, which stands in for a rotating QR code.
- **Refunds.** Refunds are issued at face value, and the seats go back on sale to other fans.
- **Top Fan Presale.** A badge on the earliest shows, based on the idea that Spotify can identify an artist's most engaged listeners.

Orders reset when the server restarts.

## Files

- `scripts/fetch-artists.js`: builds `data/artists.json` from the current US chart
- `server.js`: Spotify API proxy, concert generator, checkout/orders/refund API, static server
- `public/`: Spotify-style UI (search, artist page with Popular / Concerts tabs, checkout sheet, Your Tickets)

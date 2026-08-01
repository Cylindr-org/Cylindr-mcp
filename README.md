# LPG Connector — MCP Server

A remote MCP server that exposes live LPG price/stock data to Claude. Backed by
in-memory mock data for now; built to swap to MongoDB with no changes to the
tool logic.

## Tools

| Tool | What it does |
|------|--------------|
| `get_lpg_price(region?)` | Latest price/kg + stock per station in a region (omit region for all) |
| `find_nearest_station(lat, lng, limit?)` | Nearest stations to a coordinate, with distance + latest price |
| `get_market_trends(region, days?)` | Daily average price trend over the last N days |
| `report_price(stationId, pricePerKg, stock, reporter?)` | Submit a crowdsourced price/stock report |

`stock` is one of `in_stock` | `low` | `out_of_stock`.

## Run locally

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000/mcp
```

Health check: `GET http://localhost:3000/health`

Quick smoke test (list tools):

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Build for production

```bash
npm run build      # -> dist/
npm start          # node dist/index.js
```

## Project layout

```
src/
  index.ts              Express + streamable HTTP transport (the /mcp endpoint)
  server.ts             MCP server + the 4 tool definitions
  store/
    types.ts            Domain types (Station, PriceReport, ...)
    DataStore.ts        Interface every store implements
    InMemoryStore.ts    JSON-seeded implementation (current)
  data/seed.json        Mock stations + price history
```

## Swapping to MongoDB later

The tools only ever talk to the `DataStore` interface, so the migration is
localized:

1. `npm install mongodb`
2. Create `src/store/MongoStore.ts` implementing `DataStore` (same method
   signatures as `InMemoryStore`). Map `stations` and `priceReports` to two
   collections.
3. In `src/index.ts`, change one line:
   ```ts
   // const store = new InMemoryStore();
   const store = new MongoStore(process.env.MONGODB_URI!);
   ```

Nothing in `server.ts` changes. Seed the collections from `data/seed.json` once
for a matching demo dataset.

## Deploy (for the Claude custom connector)

Claude's cloud connects to this server over the public internet — a localhost
URL won't work for claude.ai. This repo is set up for **Render**.

### Deploy to Render

**Option A — Blueprint (uses `render.yaml`, one click):**

1. Push this project to a GitHub repo.
2. In Render: **New → Blueprint**, pick the repo. It reads `render.yaml`
   (build `npm install && npm run build`, start `npm start`, health check
   `/health`).
3. Deploy. You'll get a URL like `https://cylindr.onrender.com`.

**Option B — Manual web service:**

1. **New → Web Service**, connect the repo, set **Root Directory** to `zserver`.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Health check path: `/health`

### After it's live

- Confirm health: open `https://<your-app>.onrender.com/health` → `{"status":"ok"}`
- Add to Claude: **Settings → Connectors → Add custom connector**, paste
  `https://<your-app>.onrender.com/mcp`, then enable it in a chat via the **+** menu.

> **Free-tier note:** Render's free web services **sleep after ~15 min idle** and
> take ~30–60s to wake on the next request. Before your live demo, hit `/health`
> once to wake it so the first judge query isn't slow. Also: in-memory data is
> per-process, so a restart (or wake from sleep) **resets to the seed** and any
> `report_price` submissions are lost. The MongoDB swap removes both concerns.


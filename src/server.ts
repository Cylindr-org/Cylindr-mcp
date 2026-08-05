import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DataStore } from "./store/DataStore.js";
import type { PublicStation, PublicStationWithLatest } from "./store/types.js";
import { interpretMarket } from "./market/interpret.js";
import { buildMarketPayload, renderMarketText } from "./market/payload.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Bundled MCP App HTML (built by `npm run build:app`). Prefer the source-tree
// copy so `tsx watch` picks it up without needing dist/; fall back to dist for
// production `node dist/index.js`.
function loadMarketAppHtml(): string {
  const candidates = [
    path.join(__dirname, "market/market-app.html"), // dist/ or src/ alongside server
    path.join(__dirname, "market-app.html"),
    path.join(__dirname, "../src/market/market-app.html"), // production: dist -> src
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new Error(
    "Missing market-app.html. Run `npm run build:app` before starting the server."
  );
}

// Same fallback strategy for the review widget bundle.
function loadReviewAppHtml(): string {
  const candidates = [
    path.join(__dirname, "market/review-app.html"),
    path.join(__dirname, "review-app.html"),
    path.join(__dirname, "../src/market/review-app.html"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  throw new Error(
    "Missing review-app.html. Run `npm run build:app` before starting the server."
  );
}

const MARKET_APP_URI = "ui://cylindr/market-intelligence.html";
const REVIEW_APP_URI = "ui://cylindr/review.html";

// Shape a station's public PROFILE (bio) for a tool response — identity +
// location + whatever contact fields the station has made public. No price:
// listing stations and quoting prices are deliberately separate concerns.
// `undefined` fields were stripped upstream by the visibility projection, so
// they're simply omitted here.
function profilePayload(s: PublicStation) {
  return {
    station: s.name,
    area: s.area,
    region: s.region,
    ...(s.email ? { email: s.email } : {}),
    ...(s.phone ? { phone: s.phone } : {}),
    ...(s.websiteUrl ? { websiteUrl: s.websiteUrl } : {}),
    ...(s.address ? { address: s.address } : {}),
    ...(s.socialUrl ? { socialUrl: s.socialUrl } : {}),
    ...(s.cacNumber ? { cacNumber: s.cacNumber } : {}),
  };
}

// Shape a station's PRICE view — the latest price per kg and stock status,
// plus just enough contact (phone, when public) to actually reach the seller.
// Full bio lives in `list_stations` / `get_station`.
function pricePayload(r: PublicStationWithLatest) {
  return {
    station: r.name,
    area: r.area,
    region: r.region,
    pricePerKg: r.latest?.pricePerKg ?? null,
    stock: r.latest?.stock ?? "unknown",
    lastUpdated: r.latest?.timestamp ?? null,
    ...(r.phone ? { phone: r.phone } : {}),
  };
}

// Full public profile + latest price — used for single-station lookups and
// text search, where seeing everything at once is convenient.
function publicPayload(r: PublicStationWithLatest) {
  return {
    ...profilePayload(r),
    pricePerKg: r.latest?.pricePerKg ?? null,
    stock: r.latest?.stock ?? "unknown",
    lastUpdated: r.latest?.timestamp ?? null,
  };
}

// Build a configured MCP server backed by the given data store.
// Read-only: exposes live LPG data to Claude, never writes it.
export function createLpgServer(store: DataStore): McpServer {
  const server = new McpServer({
    name: "cylindr",
    version: "1.0.0",
  });

  // --- list_stations -------------------------------------------------------
  server.tool(
    "list_stations",
    "List LPG stations with their public PROFILE details — company name, " +
      "location, and any contact info (email, phone, website, socials, address, " +
      "CAC number) each station has chosen to make public. This is the station " +
      "directory / bio; it does NOT include prices. Use get_lpg_price for price " +
      "and stock. Omit region to list every station.",
    { region: z.string().optional().describe("e.g. 'Lagos', 'Rivers'") },
    async ({ region }) => {
      const rows = await store.listStations(region);
      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: region
                ? `No stations found for region "${region}".`
                : "No stations available.",
            },
          ],
        };
      }
      const payload = rows.map(profilePayload);
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // --- get_lpg_price -------------------------------------------------------
  server.tool(
    "get_lpg_price",
    "Get the latest LPG PRICE per kg and STOCK status (in stock / low / out of " +
      "stock) for stations in a region, with a phone number where available. " +
      "For full station profiles/contact details use list_stations or " +
      "get_station. Omit region to cover all stations.",
    { region: z.string().optional().describe("e.g. 'Lagos', 'Abuja'") },
    async ({ region }) => {
      const rows = await store.getLatestPrices(region);
      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: region
                ? `No stations found for region "${region}".`
                : "No stations available.",
            },
          ],
        };
      }
      const payload = rows.map(pricePayload);
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // --- find_stations -------------------------------------------------------
  server.tool(
    "find_stations",
    "Search for LPG stations by area, region, or name, with their latest price " +
      "and stock. Useful for 'where can I buy gas in <place>' questions.",
    {
      query: z.string().describe("Area, region, or station name, e.g. 'Ikeja'"),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ query, limit }) => {
      const rows = await store.findStations(query, limit);
      if (rows.length === 0) {
        return {
          content: [
            { type: "text", text: `No stations match "${query}".` },
          ],
        };
      }
      const payload = rows.map(publicPayload);
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );

  // --- get_station ---------------------------------------------------------
  server.tool(
    "get_station",
    "Get the full public profile of a single LPG station by name (or id), " +
      "including its latest price and any contact details the station has " +
      "chosen to make public.",
    {
      name: z
        .string()
        .describe("The station / company name, e.g. 'Vagan Oil'"),
    },
    async ({ name }) => {
      const row = await store.getStationDetail(name);
      if (!row) {
        return {
          content: [{ type: "text", text: `No station found for "${name}".` }],
        };
      }
      return {
        content: [
          { type: "text", text: JSON.stringify(publicPayload(row), null, 2) },
        ],
      };
    }
  );

  // --- get_market_trends ---------------------------------------------------
  server.tool(
    "get_market_trends",
    "Get the daily average LPG price trend for a region over a recent period.",
    {
      region: z.string().describe("e.g. 'Lagos'"),
      days: z.number().int().min(1).max(365).default(30),
    },
    async ({ region, days }) => {
      const trend = await store.getTrends(region, days);
      if (trend.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No price reports for "${region}" in the last ${days} days.`,
            },
          ],
        };
      }
      const first = trend[0].avgPricePerKg;
      const last = trend[trend.length - 1].avgPricePerKg;
      const change = Number((last - first).toFixed(2));
      const summary = {
        region,
        periodDays: days,
        startAvg: first,
        endAvg: last,
        change,
        direction: change > 0 ? "up" : change < 0 ? "down" : "flat",
        points: trend,
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // --- get_market_intelligence (MCP App) -----------------------------------
  // Claude hosts that support MCP Apps (SEP-1865) fetch the ui:// resource and
  // render it in a sandboxed iframe. The tool returns JSON text; the View
  // receives that via ui/notifications/tool-result and paints the card.
  registerAppResource(
    server,
    "Cylindr Market Intelligence",
    MARKET_APP_URI,
    {
      description: "Paybox-style market intelligence card for Nigerian LPG operators",
      _meta: {
        ui: {
          prefersBorder: true,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: MARKET_APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadMarketAppHtml(),
        },
      ],
    })
  );

  registerAppTool(
    server,
    "get_market_intelligence",
    {
      title: "Market Intelligence",
      description:
        "Get the current global LPG market reading — a Calm/Watch/Alert status with " +
        "plain-English analysis of the world price signals that drive Nigerian " +
        "cooking-gas prices (Brent/WTI crude, propane, and the naira/USD rate). " +
        "Shows a visual summary card plus the underlying numbers.",
      inputSchema: {
        days: z
          .number()
          .int()
          .min(2)
          .max(365)
          .default(120)
          .describe("How many days of history to base the trend/reading on."),
      },
      _meta: {
        ui: { resourceUri: MARKET_APP_URI },
      },
    },
    async ({ days }) => {
      const { latest, history } = await store.getMarketData(days);
      const reading = interpretMarket(latest, history);

      if (!latest || !reading) {
        return {
          content: [
            {
              type: "text",
              text: "No market intelligence available yet. The daily global-price fetch may not have run.",
            },
          ],
        };
      }

      const data = buildMarketPayload(
        reading,
        latest.date,
        latest.sources,
        history
      );

      return {
        content: [{ type: "text", text: renderMarketText(data) }],
        structuredContent: data as unknown as Record<string, unknown>,
      };
    }
  );

  // --- reviews (MCP App: inline stars + message in the chat) ---------------
  // leave_review renders an interactive widget (5 clickable stars + an optional
  // message + optional name). The widget submits back via submit_review, which
  // is the only write in this server. Omit `station` to leave developer /
  // platform feedback instead of rating a specific station.
  registerAppResource(
    server,
    "Cylindr Review",
    REVIEW_APP_URI,
    {
      description: "Inline star-rating + message widget for LPG stations",
      _meta: { ui: { prefersBorder: true } },
    },
    async () => ({
      contents: [
        {
          uri: REVIEW_APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadReviewAppHtml(),
        },
      ],
    })
  );

  registerAppTool(
    server,
    "leave_review",
    {
      title: "Leave a Review",
      description:
        "Show an interactive rating widget so the user can rate an LPG station " +
        "(1–5 clickable stars) with an optional message and name. Call this when " +
        "a user wants to review or rate a station, or to give feedback about the " +
        "Cylindr platform itself. Pass `station` (name) to rate a specific " +
        "station; omit it for platform/developer feedback.",
      inputSchema: {
        station: z
          .string()
          .optional()
          .describe("Station/company name to rate, e.g. 'Vagan Oil'. Omit for platform feedback."),
      },
      _meta: {
        ui: { resourceUri: REVIEW_APP_URI },
      },
    },
    async ({ station }) => {
      // Resolve the station name for display (so the widget can show what it's
      // rating) without failing the whole tool if it doesn't resolve — the
      // widget still works and submit_review will re-validate on submit.
      let resolved: string | null = null;
      if (station?.trim()) {
        const row = await store.getStationDetail(station.trim());
        resolved = row?.name ?? station.trim();
      }
      const data = {
        station: resolved,
        kind: resolved ? "station" : "developer",
      };
      return {
        content: [
          {
            type: "text",
            text: resolved
              ? `Rate ${resolved}: pick 1–5 stars and add an optional message.`
              : "Share feedback about Cylindr: pick 1–5 stars and add an optional message.",
          },
        ],
        structuredContent: data as unknown as Record<string, unknown>,
      };
    }
  );

  // Write tool — callable ONLY by the widget (hidden from the model). Persists
  // the review; transport/validation failures surface as isError.
  server.registerTool(
    "submit_review",
    {
      title: "Submit Review",
      description:
        "Persist a star rating submitted from the review widget. Internal — " +
        "invoked by the UI, not directly by the model.",
      inputSchema: {
        station: z.string().optional(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().optional(),
        reviewerName: z.string().optional(),
      },
      _meta: {
        ui: { visibility: ["app"] },
      },
    },
    async ({ station, rating, comment, reviewerName }) => {
      try {
        const res = await store.submitReview({
          stationQuery: station,
          rating,
          comment,
          reviewerName,
        });
        return {
          content: [
            {
              type: "text",
              text: res.station
                ? `Recorded a ${res.rating}★ review for ${res.station}.`
                : `Recorded a ${res.rating}★ platform review.`,
            },
          ],
          structuredContent: { ok: true, rating: res.rating },
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : "Failed to submit review.",
            },
          ],
        };
      }
    }
  );

  return server;
}

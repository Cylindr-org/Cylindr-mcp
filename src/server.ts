import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DataStore } from "./store/DataStore.js";
import type { PublicStation, PublicStationWithLatest } from "./store/types.js";

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

  return server;
}

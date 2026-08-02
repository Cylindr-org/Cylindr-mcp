import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DataStore } from "./store/DataStore.js";

// Build a configured MCP server backed by the given data store.
// Read-only: exposes live LPG data to Claude, never writes it.
export function createLpgServer(store: DataStore): McpServer {
  const server = new McpServer({
    name: "cylindr",
    version: "1.0.0",
  });

  // --- get_lpg_price -------------------------------------------------------
  server.tool(
    "get_lpg_price",
    "Get the latest LPG price per kg and stock status for stations in a region. " +
      "Omit region to list all stations.",
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
      const payload = rows.map((r) => ({
        station: r.name,
        area: r.area,
        region: r.region,
        pricePerKg: r.latest?.pricePerKg ?? null,
        stock: r.latest?.stock ?? "unknown",
        lastUpdated: r.latest?.timestamp ?? null,
      }));
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
      const payload = rows.map((r) => ({
        station: r.name,
        area: r.area,
        region: r.region,
        pricePerKg: r.latest?.pricePerKg ?? null,
        stock: r.latest?.stock ?? "unknown",
        phone: r.phone ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DataStore } from "./store/DataStore.js";

const stockEnum = z.enum(["in_stock", "low", "out_of_stock"]);

// Build a configured MCP server backed by the given data store.
// Called once per HTTP session in index.ts.
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
    { region: z.string().optional().describe("e.g. 'Metro Manila', 'Cebu'") },
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

  // --- find_nearest_station ------------------------------------------------
  server.tool(
    "find_nearest_station",
    "Find the LPG stations nearest to a coordinate, with their latest price and " +
      "distance in km. Useful for 'cheapest/closest gas near me' questions.",
    {
      lat: z.number().describe("Latitude of the user's location"),
      lng: z.number().describe("Longitude of the user's location"),
      limit: z.number().int().min(1).max(20).default(3),
    },
    async ({ lat, lng, limit }) => {
      const rows = await store.findNearest(lat, lng, limit);
      const payload = rows.map((r) => ({
        station: r.name,
        area: r.area,
        distanceKm: r.distanceKm,
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
      region: z.string().describe("e.g. 'Metro Manila'"),
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

  // --- report_price --------------------------------------------------------
  server.tool(
    "report_price",
    "Submit a new LPG price and stock report for a station (crowdsourced data).",
    {
      stationId: z.string().describe("Station id, e.g. 'st_001'"),
      pricePerKg: z.number().positive(),
      stock: stockEnum,
      reporter: z.string().optional().describe("Name or handle of the reporter"),
    },
    async ({ stationId, pricePerKg, stock, reporter }) => {
      try {
        const saved = await store.addPriceReport({
          stationId,
          pricePerKg,
          stock,
          reporter,
        });
        return {
          content: [
            {
              type: "text",
              text: `Recorded report ${saved.id} for ${stationId}: ₱${saved.pricePerKg}/kg (${saved.stock}) at ${saved.timestamp}.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text", text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}

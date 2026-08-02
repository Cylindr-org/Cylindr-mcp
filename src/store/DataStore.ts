import type {
  Station,
  StationWithLatest,
  TrendPoint,
} from "./types.js";

// The contract every data store must satisfy. Read-only: the MCP server
// exposes LPG data to Claude but never writes it (prices come from a feed).
export interface DataStore {
  listStations(region?: string): Promise<Station[]>;
  getStation(id: string): Promise<Station | null>;

  // Latest price report per station in a region (region optional = all).
  getLatestPrices(region?: string): Promise<StationWithLatest[]>;

  // Text search: stations whose region or area matches a query, each with
  // its latest price. Replaces coordinate-based nearest-station lookup.
  findStations(query: string, limit: number): Promise<StationWithLatest[]>;

  // Daily average price trend for a region over the last N days.
  getTrends(region: string, days: number): Promise<TrendPoint[]>;
}

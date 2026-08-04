import type {
  PublicStation,
  PublicStationWithLatest,
  TrendPoint,
} from "./types.js";

// The contract every data store must satisfy. Read-only: the MCP server
// exposes LPG data to Claude but never writes it (prices come from a feed).
// Every station returned here is already a PUBLIC projection — private fields
// have been stripped per each station's visibility flags before this point.
export interface DataStore {
  listStations(region?: string): Promise<PublicStation[]>;
  getStation(id: string): Promise<PublicStation | null>;

  // Latest price report per station in a region (region optional = all).
  getLatestPrices(region?: string): Promise<PublicStationWithLatest[]>;

  // Text search: stations whose region, area, or name matches a query, each
  // with its latest price.
  findStations(query: string, limit: number): Promise<PublicStationWithLatest[]>;

  // One station's public profile + latest price, looked up by id or name
  // (case-insensitive). Powers Claude's "individual station" lookups.
  getStationDetail(query: string): Promise<PublicStationWithLatest | null>;

  // Daily average price trend for a region over the last N days.
  getTrends(region: string, days: number): Promise<TrendPoint[]>;
}

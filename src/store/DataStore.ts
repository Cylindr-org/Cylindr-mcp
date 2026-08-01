import type {
  NewPriceReport,
  PriceReport,
  Station,
  StationWithLatest,
  TrendPoint,
} from "./types.js";

// The contract every data store must satisfy.
// Swap InMemoryStore for a MongoStore later — the MCP tools never change.
export interface DataStore {
  listStations(region?: string): Promise<Station[]>;
  getStation(id: string): Promise<Station | null>;

  // Latest price report per station in a region (region optional = all).
  getLatestPrices(region?: string): Promise<StationWithLatest[]>;

  // Stations nearest to a coordinate, each with its latest price + distance.
  findNearest(
    lat: number,
    lng: number,
    limit: number
  ): Promise<StationWithLatest[]>;

  // Daily average price trend for a region over the last N days.
  getTrends(region: string, days: number): Promise<TrendPoint[]>;

  addPriceReport(report: NewPriceReport): Promise<PriceReport>;
}

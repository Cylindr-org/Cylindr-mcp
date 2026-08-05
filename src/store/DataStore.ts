import type {
  MarketData,
  PublicStation,
  PublicStationWithLatest,
  TrendPoint,
} from "./types.js";

// The contract every data store must satisfy. Read-only EXCEPT `submitReview`,
// the single write path (customer reviews submitted from the Claude chat
// widget). Every station returned here is already a PUBLIC projection — private
// fields have been stripped per each station's visibility flags before this
// point.
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

  // Global market intelligence: the latest snapshot of world price signals
  // (crude, propane, NGN/USD) plus a history window for the trend/reading.
  getMarketData(days: number): Promise<MarketData>;

  // WRITE: record a customer review submitted from the Claude chat widget.
  // `stationQuery` (name or id) is resolved to a station; omit it for
  // developer/platform feedback (stored with station: null).
  submitReview(input: {
    stationQuery?: string;
    rating: number;
    comment?: string;
    reviewerName?: string;
  }): Promise<{ station: string | null; rating: number }>;
}

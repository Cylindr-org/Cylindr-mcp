// Shared domain types for the LPG connector.
// These stay identical whether the backing store is JSON or MongoDB.

export type StockStatus = "in_stock" | "low" | "out_of_stock";

export interface Station {
  id: string;
  name: string;
  region: string;
  area: string;
  lat: number;
  lng: number;
  phone?: string;
}

export interface PriceReport {
  id: string;
  stationId: string;
  pricePerKg: number;
  stock: StockStatus;
  reporter: string;
  timestamp: string; // ISO 8601
}

// A station combined with its most recent price report (convenience shape for tools).
export interface StationWithLatest extends Station {
  latest: PriceReport | null;
  distanceKm?: number;
}

export interface NewPriceReport {
  stationId: string;
  pricePerKg: number;
  stock: StockStatus;
  reporter?: string;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  avgPricePerKg: number;
  reportCount: number;
}

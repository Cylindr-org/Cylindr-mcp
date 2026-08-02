// Shared domain types for the Cylindr LPG connector.
// Backed by MongoDB (the same collections the backend writes to).

export type StockStatus = "in_stock" | "low" | "out_of_stock";

export interface Station {
  id: string;
  name: string;
  region: string;
  area: string;
  phone?: string;
}

export interface PriceReport {
  id: string;
  stationId: string;
  pricePerKg: number;
  stock: StockStatus;
  source: string;
  timestamp: string; // ISO 8601
}

// A station combined with its most recent price report.
export interface StationWithLatest extends Station {
  latest: PriceReport | null;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  avgPricePerKg: number;
  reportCount: number;
}

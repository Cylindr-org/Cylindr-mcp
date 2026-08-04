// Shared domain types for the Cylindr LPG connector.
// Backed by MongoDB (the same collections the backend writes to).

export type StockStatus = "in_stock" | "low" | "out_of_stock";

// Per-field public/private toggles. true = visible to Claude.
export interface StationVisibility {
  email: boolean;
  phone: boolean;
  websiteUrl: boolean;
  address: boolean;
  socialUrl: boolean;
  cacNumber: boolean;
}

// Full station as stored (internal). name + region/area are always public;
// the rest are gated by `visibility` before anything reaches Claude.
export interface Station {
  id: string;
  name: string;
  region: string;
  area: string;
  phone?: string;
  websiteUrl?: string;
  address?: string;
  socialUrl?: string;
  cacNumber?: string;
  companyId?: string;
  visibility?: Partial<StationVisibility>;
}

// The projected shape actually returned to Claude — private fields removed.
export interface PublicStation {
  id: string;
  name: string;
  region: string;
  area: string;
  phone?: string;
  websiteUrl?: string;
  address?: string;
  socialUrl?: string;
  cacNumber?: string;
  email?: string; // only when visibility.email and resolved from the account
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

// A public projection combined with its most recent price report — this is the
// shape actually handed to Claude.
export interface PublicStationWithLatest extends PublicStation {
  latest: PriceReport | null;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  avgPricePerKg: number;
  reportCount: number;
}

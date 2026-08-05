import type { DataStore } from "./DataStore.js";
import type {
  MarketData,
  PriceReport,
  PublicStation,
  PublicStationWithLatest,
  Station,
  TrendPoint,
} from "./types.js";
import { toPublicStation } from "./project.js";

const norm = (s: string) => s.trim().toLowerCase();

// In-memory store for unit tests or offline development fallback. It has no
// companies collection, so opted-in emails are never surfaced here (the public
// projection simply omits them).
export class InMemoryStore implements DataStore {
  private stations: Station[];
  private reports: PriceReport[];

  constructor(stations: Station[] = [], reports: PriceReport[] = []) {
    this.stations = structuredClone(stations);
    this.reports = structuredClone(reports);
  }

  private toPublic(stations: Station[]): PublicStation[] {
    return stations.filter((s) => s.name).map((s) => toPublicStation(s));
  }

  async listStations(region?: string): Promise<PublicStation[]> {
    const matched = region
      ? this.stations.filter((s) => norm(s.region) === norm(region))
      : [...this.stations];
    return this.toPublic(matched);
  }

  async getStation(id: string): Promise<PublicStation | null> {
    const s = this.stations.find((st) => st.id === id);
    return s ? (this.toPublic([s])[0] ?? null) : null;
  }

  private latestFor(stationId: string): PriceReport | null {
    const forStation = this.reports
      .filter((r) => r.stationId === stationId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return forStation[0] ?? null;
  }

  private withLatest(stations: PublicStation[]): PublicStationWithLatest[] {
    return stations.map((s) => ({ ...s, latest: this.latestFor(s.id) }));
  }

  async getLatestPrices(region?: string): Promise<PublicStationWithLatest[]> {
    return this.withLatest(await this.listStations(region));
  }

  async findStations(
    query: string,
    limit: number
  ): Promise<PublicStationWithLatest[]> {
    const q = norm(query);
    const matched = this.stations
      .filter(
        (s) =>
          norm(s.name).includes(q) ||
          norm(s.region).includes(q) ||
          norm(s.area).includes(q)
      )
      .slice(0, limit);
    return this.withLatest(this.toPublic(matched));
  }

  async getStationDetail(
    query: string
  ): Promise<PublicStationWithLatest | null> {
    const q = norm(query);
    const s =
      this.stations.find((st) => st.id === query) ??
      this.stations.find((st) => norm(st.name) === q);
    if (!s) return null;
    return this.withLatest(this.toPublic([s]))[0] ?? null;
  }

  async getTrends(region: string, days: number): Promise<TrendPoint[]> {
    const stationIds = new Set(
      this.stations
        .filter((s) => norm(s.region) === norm(region))
        .map((s) => s.id)
    );
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

    // Bucket reports by calendar day (UTC).
    const buckets = new Map<string, number[]>();
    for (const r of this.reports) {
      if (!stationIds.has(r.stationId)) continue;
      const t = Date.parse(r.timestamp);
      if (t < cutoff) continue;
      const day = r.timestamp.slice(0, 10);
      const arr = buckets.get(day) ?? [];
      arr.push(r.pricePerKg);
      buckets.set(day, arr);
    }

    return [...buckets.entries()]
      .map(([date, prices]) => ({
        date,
        avgPricePerKg: Number(
          (prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)
        ),
        reportCount: prices.length,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // The offline store carries no global-price feed, so there is no market
  // intelligence to serve here.
  async getMarketData(_days: number): Promise<MarketData> {
    return { latest: null, history: [] };
  }

  // In-memory review sink — kept only for the current process. Mirrors the
  // Mongo write path's validation and name resolution so tests behave the same.
  private reviews: Array<{
    station: string | null;
    rating: number;
    comment?: string;
    reviewerName?: string;
    createdAt: string;
  }> = [];

  async submitReview(input: {
    stationQuery?: string;
    rating: number;
    comment?: string;
    reviewerName?: string;
  }): Promise<{ station: string | null; rating: number }> {
    const rating = Math.round(input.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      throw new Error("rating must be a whole number from 1 to 5.");
    }

    let stationName: string | null = null;
    const q = input.stationQuery?.trim();
    if (q) {
      // Try id first, then normalized exact, then fuzzy contains.
      const s =
        this.stations.find((st) => st.id === q) ??
        this.stations.find((st) => norm(st.name) === norm(q)) ??
        this.stations.find((st) => norm(st.name).includes(norm(q)));
      if (!s) throw new Error(`No station named "${q}".`);
      stationName = s.name;
    }

    this.reviews.push({
      station: stationName,
      rating,
      comment: input.comment?.trim() || undefined,
      reviewerName: input.reviewerName?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });

    return { station: stationName, rating };
  }
}

import type { DataStore } from "./DataStore.js";
import type {
  PriceReport,
  Station,
  StationWithLatest,
  TrendPoint,
} from "./types.js";

const norm = (s: string) => s.trim().toLowerCase();

// In-memory store for unit tests or offline development fallback.
export class InMemoryStore implements DataStore {
  private stations: Station[];
  private reports: PriceReport[];

  constructor(stations: Station[] = [], reports: PriceReport[] = []) {
    this.stations = structuredClone(stations);
    this.reports = structuredClone(reports);
  }

  async listStations(region?: string): Promise<Station[]> {
    if (!region) return [...this.stations];
    return this.stations.filter((s) => norm(s.region) === norm(region));
  }

  async getStation(id: string): Promise<Station | null> {
    return this.stations.find((s) => s.id === id) ?? null;
  }

  private latestFor(stationId: string): PriceReport | null {
    const forStation = this.reports
      .filter((r) => r.stationId === stationId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return forStation[0] ?? null;
  }

  private getLatestPricesForStations(stations: Station[]): StationWithLatest[] {
    return stations.map((s) => ({ ...s, latest: this.latestFor(s.id) }));
  }

  async getLatestPrices(region?: string): Promise<StationWithLatest[]> {
    const stations = await this.listStations(region);
    return this.getLatestPricesForStations(stations);
  }

  async findStations(
    query: string,
    limit: number
  ): Promise<StationWithLatest[]> {
    const q = norm(query);
    const matched = this.stations
      .filter(
        (s) =>
          norm(s.name).includes(q) ||
          norm(s.region).includes(q) ||
          norm(s.area).includes(q)
      )
      .slice(0, limit);
    return this.getLatestPricesForStations(matched);
  }

  async getTrends(region: string, days: number): Promise<TrendPoint[]> {
    const stationIds = new Set(
      (await this.listStations(region)).map((s) => s.id)
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
}

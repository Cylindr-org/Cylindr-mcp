import { randomUUID } from "node:crypto";
import type { DataStore } from "./DataStore.js";
import type {
  NewPriceReport,
  PriceReport,
  Station,
  StationWithLatest,
  TrendPoint,
} from "./types.js";
import seed from "../data/seed.json" with { type: "json" };

// Haversine distance in kilometers.
function distanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const norm = (s: string) => s.trim().toLowerCase();

// In-memory store seeded from seed.json. Data lives only for the process
// lifetime — restarting resets to the seed. Good enough for a demo.
export class InMemoryStore implements DataStore {
  private stations: Station[];
  private reports: PriceReport[];

  constructor() {
    // Clone so we never mutate the imported JSON module object.
    this.stations = structuredClone(seed.stations) as Station[];
    this.reports = structuredClone(seed.priceReports) as PriceReport[];
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

  async getLatestPrices(region?: string): Promise<StationWithLatest[]> {
    const stations = await this.listStations(region);
    return stations.map((s) => ({ ...s, latest: this.latestFor(s.id) }));
  }

  async findNearest(
    lat: number,
    lng: number,
    limit: number
  ): Promise<StationWithLatest[]> {
    return this.stations
      .map((s) => ({
        ...s,
        latest: this.latestFor(s.id),
        distanceKm: Number(distanceKm(lat, lng, s.lat, s.lng).toFixed(2)),
      }))
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      .slice(0, limit);
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

  async addPriceReport(report: NewPriceReport): Promise<PriceReport> {
    const station = await this.getStation(report.stationId);
    if (!station) {
      throw new Error(`Unknown stationId: ${report.stationId}`);
    }
    const saved: PriceReport = {
      id: `pr_${randomUUID().slice(0, 8)}`,
      stationId: report.stationId,
      pricePerKg: report.pricePerKg,
      stock: report.stock,
      reporter: report.reporter?.trim() || "anonymous",
      timestamp: new Date().toISOString(),
    };
    this.reports.push(saved);
    return saved;
  }
}

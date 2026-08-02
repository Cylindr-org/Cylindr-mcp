import type { DataStore } from "./DataStore.js";
import type {
  Station,
  StationWithLatest,
  StockStatus,
  TrendPoint,
} from "./types.js";
import { PriceReportModel, StationModel } from "./models.js";

// Case-insensitive exact match for a region name.
const exact = (s: string) => new RegExp(`^${escapeRegex(s)}$`, "i");
// Case-insensitive contains match for free-text search.
const contains = (s: string) => new RegExp(escapeRegex(s), "i");

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type StationLean = {
  _id: unknown;
  name: string;
  region: string;
  area: string;
  phone?: string;
};

function toStation(doc: StationLean): Station {
  return {
    id: String(doc._id),
    name: doc.name,
    region: doc.region,
    area: doc.area,
    phone: doc.phone,
  };
}

// Reads LPG data live from MongoDB (same collections the backend writes to).
export class MongoStore implements DataStore {
  async listStations(region?: string): Promise<Station[]> {
    const filter = region ? { region: exact(region) } : {};
    const docs = await StationModel.find(filter)
      .sort({ name: 1 })
      .lean<StationLean[]>();
    return docs.map(toStation);
  }

  async getStation(id: string): Promise<Station | null> {
    const doc = await StationModel.findById(id).lean<StationLean>();
    return doc ? toStation(doc) : null;
  }

  // Most recent price report for one station id.
  private async latestFor(stationId: string) {
    const r = await PriceReportModel.findOne({ station: stationId })
      .sort({ createdAt: -1 })
      .lean();
    if (!r) return null;
    return {
      id: String(r._id),
      stationId,
      pricePerKg: r.pricePerKg as number,
      stock: r.stock as StockStatus,
      source: (r.source as string) ?? "feed",
      timestamp: (r.createdAt as Date).toISOString(),
    };
  }

  private async withLatest(stations: Station[]): Promise<StationWithLatest[]> {
    return Promise.all(
      stations.map(async (s) => ({ ...s, latest: await this.latestFor(s.id) }))
    );
  }

  async getLatestPrices(region?: string): Promise<StationWithLatest[]> {
    return this.withLatest(await this.listStations(region));
  }

  async findStations(
    query: string,
    limit: number
  ): Promise<StationWithLatest[]> {
    const rx = contains(query);
    const docs = await StationModel.find({
      $or: [{ region: rx }, { area: rx }, { name: rx }],
    })
      .sort({ name: 1 })
      .limit(limit)
      .lean<StationLean[]>();
    return this.withLatest(docs.map(toStation));
  }

  async getTrends(region: string, days: number): Promise<TrendPoint[]> {
    const stations = await StationModel.find({ region: exact(region) })
      .select("_id")
      .lean<{ _id: unknown }[]>();
    const ids = stations.map((s) => s._id);
    if (ids.length === 0) return [];

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Aggregate daily average price across the region's stations.
    const rows = await PriceReportModel.aggregate<{
      _id: string;
      avg: number;
      count: number;
    }>([
      { $match: { station: { $in: ids }, createdAt: { $gte: cutoff } } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          avg: { $avg: "$pricePerKg" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return rows.map((r) => ({
      date: r._id,
      avgPricePerKg: Number(r.avg.toFixed(2)),
      reportCount: r.count,
    }));
  }
}

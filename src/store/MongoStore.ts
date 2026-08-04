import type { DataStore } from "./DataStore.js";
import type {
  MarketData,
  MarketPoint,
  MarketSnapshot,
  PublicStation,
  PublicStationWithLatest,
  Station,
  StockStatus,
  TrendPoint,
} from "./types.js";
import {
  CompanyModel,
  GlobalPriceModel,
  PriceReportModel,
  StationModel,
} from "./models.js";
import { toPublicStation } from "./project.js";

// Case-insensitive exact match for a region name.
const exact = (s: string) => new RegExp(`^${escapeRegex(s)}$`, "i");
// Case-insensitive contains match for free-text search.
const contains = (s: string) => new RegExp(escapeRegex(s), "i");

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type StationLean = {
  _id: unknown;
  name?: string;
  region?: string;
  area?: string;
  phone?: string;
  websiteUrl?: string;
  address?: string;
  socialUrl?: string;
  cacNumber?: string;
  companyId?: unknown;
  visibility?: Record<string, boolean>;
};

// Map a raw Mongo doc to the full internal Station (all fields, unprojected).
function toStation(doc: StationLean): Station {
  return {
    id: String(doc._id),
    name: doc.name ?? "",
    region: doc.region ?? "",
    area: doc.area ?? "",
    phone: doc.phone,
    websiteUrl: doc.websiteUrl,
    address: doc.address,
    socialUrl: doc.socialUrl,
    cacNumber: doc.cacNumber,
    companyId: doc.companyId ? String(doc.companyId) : undefined,
    visibility: doc.visibility,
  };
}

// Reads LPG data live from MongoDB (same collections the backend writes to).
export class MongoStore implements DataStore {
  // Resolve login emails for the subset of stations that opted email in.
  // This is the ONLY place the MCP reads the private companies collection,
  // and only ever the `email` field, only for visibility.email stations.
  private async resolveEmails(
    stations: Station[]
  ): Promise<Map<string, string>> {
    const ids = stations
      .filter((s) => s.visibility?.email && s.companyId)
      .map((s) => s.companyId as string);
    const byCompany = new Map<string, string>();
    if (ids.length === 0) return byCompany;
    const companies = await CompanyModel.find({ _id: { $in: ids } })
      .select("email")
      .lean<{ _id: unknown; email?: string }[]>();
    for (const c of companies) {
      if (c.email) byCompany.set(String(c._id), c.email);
    }
    return byCompany;
  }

  // Project a batch of internal stations to public shape (drops private fields
  // and rows with no public name), resolving opted-in emails first.
  private async toPublicBatch(stations: Station[]): Promise<PublicStation[]> {
    const emails = await this.resolveEmails(stations);
    return stations
      .filter((s) => s.name)
      .map((s) =>
        toPublicStation(s, s.companyId ? emails.get(s.companyId) : undefined)
      );
  }

  async listStations(region?: string): Promise<PublicStation[]> {
    const filter = region ? { region: exact(region) } : {};
    const docs = await StationModel.find(filter)
      .sort({ name: 1 })
      .lean<StationLean[]>();
    return this.toPublicBatch(docs.map(toStation));
  }

  async getStation(id: string): Promise<PublicStation | null> {
    const doc = await StationModel.findById(id).lean<StationLean>();
    if (!doc) return null;
    const [pub] = await this.toPublicBatch([toStation(doc)]);
    return pub ?? null;
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

  private async withLatest(
    stations: PublicStation[]
  ): Promise<PublicStationWithLatest[]> {
    return Promise.all(
      stations.map(async (s) => ({ ...s, latest: await this.latestFor(s.id) }))
    );
  }

  async getLatestPrices(region?: string): Promise<PublicStationWithLatest[]> {
    return this.withLatest(await this.listStations(region));
  }

  async findStations(
    query: string,
    limit: number
  ): Promise<PublicStationWithLatest[]> {
    const rx = contains(query);
    const docs = await StationModel.find({
      $or: [{ region: rx }, { area: rx }, { name: rx }],
    })
      .sort({ name: 1 })
      .limit(limit)
      .lean<StationLean[]>();
    return this.withLatest(await this.toPublicBatch(docs.map(toStation)));
  }

  async getStationDetail(
    query: string
  ): Promise<PublicStationWithLatest | null> {
    // Try id first, then fall back to a case-insensitive name match.
    let doc: StationLean | null = null;
    if (/^[a-f0-9]{24}$/i.test(query)) {
      doc = await StationModel.findById(query).lean<StationLean>();
    }
    if (!doc) {
      doc = await StationModel.findOne({ name: exact(query) }).lean<StationLean>();
    }
    if (!doc) return null;
    const [pub] = await this.toPublicBatch([toStation(doc)]);
    if (!pub) return null;
    const [withLatest] = await this.withLatest([pub]);
    return withLatest;
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

  async getMarketData(days: number): Promise<MarketData> {
    // History window: newest `days` rows, then flipped to chronological order
    // (oldest -> newest) so trend maths and charts read left to right.
    const docs = await GlobalPriceModel.find({})
      .sort({ date: -1 })
      .limit(days)
      .lean<GlobalPriceLean[]>();

    const history: MarketPoint[] = docs.map(toMarketPoint).reverse();
    const latestDoc = docs[0] ?? null;
    const latest: MarketSnapshot | null = latestDoc
      ? { ...toMarketPoint(latestDoc), sources: latestDoc.sources ?? [] }
      : null;

    return { latest, history };
  }
}

type GlobalPriceLean = {
  date?: string;
  brentUsdPerBarrel?: number;
  wtiUsdPerBarrel?: number;
  propaneUsdPerGallon?: number;
  ngnPerUsd?: number;
  sources?: string[];
};

// Map a raw global-price doc to a MarketPoint (missing feeds -> null).
function toMarketPoint(d: GlobalPriceLean): MarketPoint {
  return {
    date: d.date ?? "",
    brentUsdPerBarrel: d.brentUsdPerBarrel ?? null,
    wtiUsdPerBarrel: d.wtiUsdPerBarrel ?? null,
    propaneUsdPerGallon: d.propaneUsdPerGallon ?? null,
    ngnPerUsd: d.ngnPerUsd ?? null,
  };
}

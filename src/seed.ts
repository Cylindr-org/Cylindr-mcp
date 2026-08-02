import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectDB } from "./db.js";
import { StationModel, PriceReportModel } from "./store/models.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function seed() {
  await connectDB();
  console.log("Seeding MongoDB database...");

  const seedPath = path.join(__dirname, "data", "seed.json");
  const raw = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, "utf-8") : "{}";
  const data = JSON.parse(raw);
  const stations = data.stations || [];
  const priceReports = data.priceReports || [];

  // Clear existing collections
  await StationModel.deleteMany({});
  await PriceReportModel.deleteMany({});
  console.log("Cleared existing station and price report collections.");

  const stationIdMap = new Map<string, any>();

  for (const s of stations) {
    const doc = await StationModel.create({
      name: s.name,
      region: s.region,
      area: s.area,
      phone: s.phone,
    });
    stationIdMap.set(s.id, doc._id);
    console.log(`Created station: ${s.name} (${doc._id})`);
  }

  for (const pr of priceReports) {
    const stationId = stationIdMap.get(pr.stationId);
    if (!stationId) {
      console.warn(`Station ID ${pr.stationId} not found for report ${pr.id}`);
      continue;
    }
    const createdAt = pr.timestamp ? new Date(pr.timestamp) : new Date();
    await PriceReportModel.create({
      station: stationId,
      pricePerKg: pr.pricePerKg,
      stock: pr.stock,
      source: pr.reporter || "seed",
      createdAt,
      updatedAt: createdAt,
    });
  }

  console.log(
    `Successfully seeded ${stations.length} stations and ${priceReports.length} price reports into MongoDB.`
  );
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seeding failed:", err);
  process.exit(1);
});

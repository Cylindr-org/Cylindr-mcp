import mongoose, { Schema } from "mongoose";

// These schemas MUST match the backend's collections. Model name "Station"
// -> collection "stations"; "PriceReport" -> "pricereports". The MCP server
// only reads from them.

const stationSchema = new Schema(
  {
    name: String,
    region: String,
    area: String,
    phone: String,
    websiteUrl: String,
    address: String,
    socialUrl: String,
    cacNumber: String,
    // Link back to the owning private account (used ONLY to fetch email when
    // visibility.email is true — see CompanyModel below).
    companyId: { type: Schema.Types.ObjectId, ref: "Company" },
    // Per-field public/private toggles (mirrors the backend). Absent/false = private.
    visibility: {
      email: Boolean,
      phone: Boolean,
      websiteUrl: Boolean,
      address: Boolean,
      socialUrl: Boolean,
      cacNumber: Boolean,
    },
  },
  { timestamps: true }
);

const priceReportSchema = new Schema(
  {
    station: { type: Schema.Types.ObjectId, ref: "Station" },
    pricePerKg: Number,
    stock: String,
    source: String,
  },
  { timestamps: true }
);

// DELIBERATE, WHITELISTED EXCEPTION to "the MCP never reads the companies
// collection": a minimal read-only model exposing ONLY `email`. It is used
// solely to resolve a station's contact email when that station has opted in
// (visibility.email === true), always via `.select("email")`. No other field
// of the private Company document is ever mapped or queryable here.
const companySchema = new Schema({ email: String });

// MARKET-INTELLIGENCE: the daily global-price snapshots the backend's fetch job
// writes (Brent/WTI crude, propane, NGN/USD). Non-sensitive global data — read
// here directly so the MCP can serve a market reading without a cross-service
// HTTP call. Model name "GlobalPrice" -> collection "globalprices" (matches the
// backend). Read-only, like every other model in this file.
const globalPriceSchema = new Schema(
  {
    date: String,
    brentUsdPerBarrel: Number,
    wtiUsdPerBarrel: Number,
    propaneUsdPerGallon: Number,
    ngnPerUsd: Number,
    sources: [String],
  },
  { timestamps: true }
);

export const StationModel = mongoose.model("Station", stationSchema);
export const PriceReportModel = mongoose.model("PriceReport", priceReportSchema);
export const CompanyModel = mongoose.model("Company", companySchema);
export const GlobalPriceModel = mongoose.model("GlobalPrice", globalPriceSchema);

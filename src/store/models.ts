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

export const StationModel = mongoose.model("Station", stationSchema);
export const PriceReportModel = mongoose.model("PriceReport", priceReportSchema);

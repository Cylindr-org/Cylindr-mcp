import dns from "node:dns";
import mongoose from "mongoose";
import { config } from "./config.js";

// Connect once, reuse the pooled connection. Read-only usage here — this
// service never writes to the LPG collections.
export async function connectDB(): Promise<void> {
  if (config.dnsServers.length > 0) {
    dns.setServers(config.dnsServers);
    console.log(`Using custom DNS resolvers: ${config.dnsServers.join(", ")}`);
  }
  mongoose.set("strictQuery", true);
  await mongoose.connect(config.mongoUri, { dbName: config.mongoDb });
  console.log(`MongoDB connected (db: ${config.mongoDb})`);
}

import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export const config = {
  mongoUri: required("MONGODB_URI"),
  mongoDb: process.env.MONGODB_DB || "cylindr",
  port: Number(process.env.PORT) || 3000,
  // Optional public DNS resolvers to work around networks that refuse
  // MongoDB Atlas SRV lookups (querySrv ECONNREFUSED).
  dnsServers: (process.env.DNS_SERVERS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

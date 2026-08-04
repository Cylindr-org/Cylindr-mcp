import type { MarketPoint } from "../store/types.js";
import type { MarketReading } from "./interpret.js";

// Shared shape returned by get_market_intelligence. Claude narrates from this
// JSON; the MCP App iframe renders the same payload as a Paybox-style card.
export interface MarketCardPayload {
  status: MarketReading["status"];
  headline: string;
  summary: string;
  advice: string;
  windowDays: number;
  latestDate: string;
  sources: string[];
  metrics: Array<{
    label: string;
    value: string;
    changePct: number | null;
    direction: MarketReading["metrics"][number]["direction"];
    note: string;
  }>;
  /** Propane series for the sparkline (oldest -> newest). */
  propaneSeries: number[];
}

export function buildMarketPayload(
  reading: MarketReading,
  latestDate: string,
  sources: string[],
  history: MarketPoint[]
): MarketCardPayload {
  return {
    status: reading.status,
    headline: reading.statusHeadline,
    summary: reading.summary,
    advice: reading.advice,
    windowDays: reading.windowDays,
    latestDate,
    sources,
    metrics: reading.metrics.map((m) => ({
      label: m.label,
      value: m.valueText,
      changePct: m.changePct,
      direction: m.direction,
      note: m.sentence,
    })),
    propaneSeries: history
      .map((p) => p.propaneUsdPerGallon)
      .filter((v): v is number => typeof v === "number"),
  };
}

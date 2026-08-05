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

// A clean, human-readable rendering of the same payload. This is the tool's
// TEXT content: what Claude narrates from, and what hosts that can't render the
// visual card (e.g. Claude mobile, which doesn't paint MCP-App iframes yet)
// show instead of a raw JSON dump. The visual card reads `structuredContent`.
export function renderMarketText(data: MarketCardPayload): string {
  const arrow = (d: string) => (d === "up" ? "↑" : d === "down" ? "↓" : "→");
  const lines: string[] = [];

  lines.push(data.headline);
  lines.push(
    `(${data.windowDays}-day window, latest data ${data.latestDate})`
  );
  lines.push("");

  for (const m of data.metrics) {
    const change =
      m.changePct == null
        ? ""
        : ` (${m.changePct > 0 ? "+" : ""}${m.changePct.toFixed(1)}% ${arrow(
            m.direction
          )})`;
    lines.push(`• ${m.label}: ${m.value}${change}`);
  }

  lines.push("");
  lines.push(data.summary);
  lines.push("");
  lines.push(`What to consider: ${data.advice}`);

  if (data.sources.length) {
    lines.push("");
    lines.push(`Sources: ${data.sources.join(", ")}.`);
  }

  return lines.join("\n");
}

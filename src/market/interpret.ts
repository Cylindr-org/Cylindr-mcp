import type { MarketPoint, MarketSnapshot } from "../store/types.js";

// Plain-English interpreter (ported from the web client's market/interpret.ts).
// Turns the raw global market numbers into a readable status + sentences a
// station operator can act on WITHOUT reading a chart. Everything here is
// derived straight from the data and is observational ("prices have risen"),
// not a prediction. Keeping the logic identical to the client's means Claude's
// card and the dashboard tell the same story.

export type MarketStatus = "calm" | "watch" | "alert";

export interface MetricReading {
  key: "propane" | "brent" | "wti" | "fx";
  label: string;
  /** Current value already formatted for display, e.g. "$0.68 / gal". */
  valueText: string;
  /** % change over the window, e.g. +9.4 (null if not enough history). */
  changePct: number | null;
  /** One plain sentence describing this metric's recent behaviour. */
  sentence: string;
  direction: "up" | "down" | "flat" | "unknown";
}

export interface MarketReading {
  status: MarketStatus;
  /** Big one-line status label, e.g. "Watch: some upward pressure building". */
  statusHeadline: string;
  /** A short paragraph summarising the whole picture in plain English. */
  summary: string;
  /** What the operator might consider doing. Not financial advice. */
  advice: string;
  /** Per-metric plain-English readings, most important first. */
  metrics: MetricReading[];
  /** How many days of history the reading is based on. */
  windowDays: number;
}

// Percentage change between the first and last non-null value of a series.
function pctChange(points: MarketPoint[], key: keyof MarketPoint): number | null {
  const vals = points
    .map((p) => p[key])
    .filter((v): v is number => typeof v === "number");
  if (vals.length < 2) return null;
  const first = vals[0];
  const last = vals[vals.length - 1];
  if (!first) return null;
  return ((last - first) / first) * 100;
}

function dir(pct: number | null): MetricReading["direction"] {
  if (pct == null) return "unknown";
  if (pct > 1) return "up";
  if (pct < -1) return "down";
  return "flat";
}

// Describe a change in words: magnitude ("sharply"/"slightly") + direction.
function describeMove(pct: number | null): string {
  if (pct == null) return "has no recent trend data yet";
  const a = Math.abs(pct);
  const mag = a >= 15 ? "sharply" : a >= 5 ? "noticeably" : a >= 1 ? "slightly" : "barely";
  const verb = pct > 1 ? "risen" : pct < -1 ? "fallen" : "held steady";
  if (verb === "held steady") return "has held roughly steady";
  return `has ${verb} ${mag} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`;
}

const money = (n: number, digits = 2) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

// "a, b and c" — human-friendly list joining.
function joinList(items: string[]): string {
  if (items.length === 0) return "signals were mixed";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Build the full reading from the latest snapshot + the trend window.
export function interpretMarket(
  snapshot: MarketSnapshot | null,
  points: MarketPoint[]
): MarketReading | null {
  if (!snapshot) return null;

  const windowDays = points.length;

  const propanePct = pctChange(points, "propaneUsdPerGallon");
  const brentPct = pctChange(points, "brentUsdPerBarrel");
  const wtiPct = pctChange(points, "wtiUsdPerBarrel");
  const fxPct = pctChange(points, "ngnPerUsd");

  const metrics: MetricReading[] = [];

  // Propane — the closest proxy to cooking gas, so it leads the list.
  if (snapshot.propaneUsdPerGallon != null) {
    metrics.push({
      key: "propane",
      label: "Propane (global LPG proxy)",
      valueText: `$${money(snapshot.propaneUsdPerGallon)} / gal`,
      changePct: propanePct,
      direction: dir(propanePct),
      sentence: `Global propane, the closest match to cooking gas, ${describeMove(
        propanePct
      )} over the last ${windowDays} days.`,
    });
  }

  // Naira/USD — the import-cost multiplier.
  if (snapshot.ngnPerUsd != null) {
    // A HIGHER naira-per-dollar number means a WEAKER naira (costlier imports).
    const weaker = fxPct != null && fxPct > 1;
    const stronger = fxPct != null && fxPct < -1;
    const fxSentence =
      fxPct == null
        ? `The naira is at ₦${money(snapshot.ngnPerUsd, 0)} per dollar. Not enough history yet to show a trend.`
        : weaker
        ? `The naira has weakened to ₦${money(snapshot.ngnPerUsd, 0)} per dollar (+${fxPct.toFixed(
            1
          )}%), which makes imported gas costlier.`
        : stronger
        ? `The naira has strengthened to ₦${money(snapshot.ngnPerUsd, 0)} per dollar (${fxPct.toFixed(
            1
          )}%), easing import costs.`
        : `The naira is steady at ₦${money(snapshot.ngnPerUsd, 0)} per dollar.`;
    metrics.push({
      key: "fx",
      label: "Naira / USD",
      valueText: `₦${money(snapshot.ngnPerUsd, 0)} / $`,
      changePct: fxPct,
      direction: dir(fxPct),
      sentence: fxSentence,
    });
  }

  // Brent & WTI — the broad energy backdrop.
  if (snapshot.brentUsdPerBarrel != null) {
    metrics.push({
      key: "brent",
      label: "Brent crude",
      valueText: `$${money(snapshot.brentUsdPerBarrel)} / bbl`,
      changePct: brentPct,
      direction: dir(brentPct),
      sentence: `Brent crude (the global oil benchmark Nigeria prices against) ${describeMove(
        brentPct
      )}.`,
    });
  }
  if (snapshot.wtiUsdPerBarrel != null) {
    metrics.push({
      key: "wti",
      label: "WTI crude",
      valueText: `$${money(snapshot.wtiUsdPerBarrel)} / bbl`,
      changePct: wtiPct,
      direction: dir(wtiPct),
      sentence: `WTI crude (the US oil benchmark) ${describeMove(wtiPct)}.`,
    });
  }

  // Derive an overall status from simple, explainable thresholds.
  // "Upward pressure" = propane rising AND/OR the naira weakening. These are
  // the two forces that push local LPG up. Deliberately conservative.
  const propaneUp = propanePct != null && propanePct >= 5;
  const propaneSurge = propanePct != null && propanePct >= 12;
  const nairaWeak = fxPct != null && fxPct >= 3;
  const crudeUp = brentPct != null && brentPct >= 8;

  const pressureSignals = [propaneUp, nairaWeak, crudeUp].filter(Boolean).length;

  let status: MarketStatus = "calm";
  if (propaneSurge || (nairaWeak && propaneUp) || pressureSignals >= 3) {
    status = "alert";
  } else if (pressureSignals >= 1) {
    status = "watch";
  }

  const statusHeadline =
    status === "alert"
      ? "Alert: strong upward pressure on gas prices"
      : status === "watch"
      ? "Watch: some upward pressure building"
      : "Calm: global signals are stable";

  // Compose a plain-English summary paragraph from the pieces.
  const drivers: string[] = [];
  if (propaneUp) drivers.push(`global propane is up ${propanePct!.toFixed(1)}%`);
  if (nairaWeak) drivers.push(`the naira has weakened ${fxPct!.toFixed(1)}%`);
  if (crudeUp) drivers.push(`crude oil is up ${brentPct!.toFixed(1)}%`);

  const summary =
    status === "calm"
      ? `Over the last ${windowDays} days the global signals that drive Nigerian cooking-gas prices have stayed broadly stable. Nothing in the data points to a near-term price jump.`
      : `Over the last ${windowDays} days, ${joinList(
          drivers
        )}. Because Nigeria imports most of its LPG, these are the forces that tend to push local cooking-gas prices up, usually with a lag of a few weeks.`;

  const advice =
    status === "alert"
      ? "Consider securing supply now: the combination above often precedes a local price rise. Lock in stock while costs are lower and review your pricing."
      : status === "watch"
      ? "Worth keeping an eye on. If these signals keep building, consider restocking within the next couple of weeks before prices catch up."
      : "No action needed for now. Prices look stable, so continue normal operations and check back periodically.";

  return { status, statusHeadline, summary, advice, metrics, windowDays };
}

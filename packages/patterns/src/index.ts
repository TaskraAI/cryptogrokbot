import type { ExitAction, MarketSnapshot, Pattern, Policy, PositionState } from "@night/shared";

export function classifyPattern(
  snap: MarketSnapshot,
  policy: Policy,
  extras?: { lpPulled?: boolean; creatorDumping?: boolean },
): Pattern {
  const dip = snap.pctFromPeak <= -policy.dipPctFromPeak;
  const volumeAlive = snap.volumeBaseline5m <= 0
    ? snap.volume5m > 0
    : snap.volume5m >= (snap.volumeBaseline5m * policy.volumeAlivePctOfBaseline) / 100;
  const sentimentHigh =
    snap.sentiment >= policy.highSentiment &&
    snap.mentionVelocity >= snap.mentionVelocityBaseline &&
    (snap.trustedSourcesStillPosting >= 1 || snap.uniqueRecentSources >= 2);
  const sentimentRising = snap.sentiment >= policy.highSentiment;
  const sentimentFalling = snap.sentiment < policy.highSentiment * 0.5;
  const mentionsDying = snap.mentionVelocity < snap.mentionVelocityBaseline * 0.5;
  const volumeDying = snap.volumeBaseline5m > 0 && snap.volume5m < snap.volumeBaseline5m * 0.4;
  const dumpTape =
    Boolean(extras?.lpPulled) ||
    Boolean(extras?.creatorDumping) ||
    snap.creatorPct > policy.maxCreatorPct ||
    (dip && snap.buySellRatio < 0.35 && snap.volumeDeltaPct > 40);

  if (dumpTape) return "dump";

  const sharpUp = snap.pctFromPeak > -3 && snap.pctFromEntry > 80 && snap.volumeDeltaPct > 80;
  const euphoriaStalling = snap.sentiment > 0.7 && snap.volumeDeltaPct < 0 && snap.pctFromPeak < -5;
  if (sharpUp && (euphoriaStalling || snap.buySellRatio < 0.45)) return "climax";

  if (dip && (sentimentHigh || sentimentRising) && volumeAlive && snap.buySellRatio >= 0.4) {
    return "healthy_dip";
  }

  if ((dip || snap.pctFromPeak < -5) && (sentimentFalling || mentionsDying || volumeDying)) {
    return "fade";
  }

  return "chop";
}

export function decideExit(opts: {
  position: PositionState;
  snap: MarketSnapshot;
  pattern: Pattern;
  policy: Policy;
  now?: number;
  sellAll?: boolean;
  lpPulled?: boolean;
}): ExitAction {
  const now = opts.now ?? Date.now();
  const pos = opts.position;
  const bagValueSol = pos.tokensHeld * solPerToken(opts.snap, pos);
  const recovered = pos.principalRecoveredSol >= pos.principalSol - 1e-9;

  if (opts.sellAll) return { type: "flatten", reason: "sellall" };
  if (opts.lpPulled) return { type: "flatten", reason: "rug" };
  if (opts.pattern === "dump") return { type: "flatten", reason: "dump" };

  const pnlPct = opts.snap.pctFromEntry;
  if (!recovered && pnlPct <= opts.policy.hardStopPct) {
    return { type: "flatten", reason: "hard_stop" };
  }
  if (recovered && opts.position.peakPriceUsd > 0) {
    const trailPct = ((opts.snap.priceUsd - pos.peakPriceUsd) / pos.peakPriceUsd) * 100;
    if (trailPct <= -opts.policy.runnerTrailPct && opts.pattern !== "healthy_dip") {
      return { type: "flatten", reason: "hard_stop" };
    }
  }

  const ageMin = (now - pos.openedAt) / 60000;
  if (!pos.everGreen && ageMin >= opts.policy.timeStopMinutesIfNeverGreen) {
    return { type: "flatten", reason: "time_stop" };
  }

  if (!recovered) {
    const ready =
      bagValueSol + pos.principalRecoveredSol >= pos.principalSol * opts.policy.returnPrincipalMultiple;
    if (ready) return { type: "return_principal", reason: "compound" };
    return { type: "hold", reason: "awaiting_principal" };
  }

  if (ageMin >= opts.policy.maxRunnerHoldMinutes) {
    return { type: "flatten", reason: "max_runner_hold" };
  }

  if (opts.pattern === "healthy_dip") {
    const started = pos.healthyDipSince ?? now;
    if ((now - started) / 60000 > opts.policy.healthyDipMaxHoldMinutes) {
      if (opts.snap.trustedSourcesStillPosting < 1 && opts.snap.uniqueRecentSources < 2) {
        return { type: "sell_runner", reason: "fade" };
      }
    }
    return { type: "hold", reason: "healthy_dip_hold" };
  }

  if (opts.pattern === "fade") return { type: "sell_runner", reason: "fade" };
  if (opts.pattern === "climax") return { type: "sell_runner", reason: "climax" };
  return { type: "hold", reason: "chop_hold" };
}

function solPerToken(snap: MarketSnapshot, pos: PositionState): number {
  if (pos.entryPriceUsd <= 0 || pos.principalSol <= 0 || pos.tokensInitial <= 0) {
    return 0;
  }
  const entrySolPerToken = pos.principalSol / pos.tokensInitial;
  return entrySolPerToken * (snap.priceUsd / pos.entryPriceUsd);
}

export function applyPeakAndGreen(pos: PositionState, priceUsd: number): PositionState {
  const peak = Math.max(pos.peakPriceUsd, priceUsd);
  const everGreen = pos.everGreen || priceUsd > pos.entryPriceUsd;
  return { ...pos, peakPriceUsd: peak, everGreen };
}

export function appendPatternPath(path: string, pattern: Pattern): string {
  if (!path) return pattern;
  const parts = path.split("→").map((s) => s.trim());
  if (parts[parts.length - 1] === pattern) return path;
  return `${path} → ${pattern}`;
}

export function mergeLlmAction(
  deterministic: ExitAction,
  llm?: { pattern?: Pattern; action?: "hold" | "sell"; confidence?: number },
): ExitAction {
  if (!llm) return deterministic;
  if (deterministic.reason === "healthy_dip_hold") return deterministic;
  if (deterministic.type === "flatten") return deterministic;
  if (deterministic.reason === "awaiting_principal") return deterministic;
  if (deterministic.type === "hold" && llm.action === "sell" && (llm.confidence ?? 0) >= 0.7) {
    return { type: "sell_runner", reason: "sentiment" };
  }
  return deterministic;
}

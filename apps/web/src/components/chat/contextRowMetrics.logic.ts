import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import type { TurnTokenUsage } from "@t3tools/contracts";

/** Session totals summed from turns. Avoids `totalProcessedTokens`, which is null mid-stream
 * and rewritten to the pre-compaction size after a compaction. `inputTokens` already includes
 * cache reads, so `cachedInputTokens` is a subset of it, never an addend. */
export interface SessionUsageSummary {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  /** Provider-ledger counts beyond the main agent: native subagents and compaction. */
  readonly otherInputTokens: number;
  readonly otherOutputTokens: number;
  /** Input plus output plus the provider-ledger counts. */
  readonly totalTokens: number;
  /** `cachedInputTokens / inputTokens`, or null when no input was reported. */
  readonly cacheHitRate: number | null;
  /** Summed turn duration, or null when no turn reported one. */
  readonly durationMs: number | null;
  /** Session average output speed in tokens per second, or null without a duration. */
  readonly tokensPerSecond: number | null;
  /** Tool calls the provider counted across the session, when it reports them. */
  readonly toolUses: number | null;
  /** Output tokens of the last turn alone, used while that turn is still producing them. */
  readonly lastTurnOutputTokens: number | null;
  /** That turn's time: settled between its timestamps, or the latest live report while running. */
  readonly lastTurnDurationMs: number | null;
  /** Its output speed, or null under one second where the sample is too small to mean anything. */
  readonly lastTurnTokensPerSecond: number | null;
  /** Input tokens of the most recent turn that reported any, for the turn-level cache rate. */
  readonly lastInputTokens: number | null;
  /** `lastCachedInputTokens / lastInputTokens`, or null when that turn cached nothing. */
  readonly lastCacheHitRate: number | null;
  /** True when at least one turn reported partial or unavailable usage, so totals run low. */
  readonly partial: boolean;
}

const EMPTY_SESSION_USAGE: SessionUsageSummary = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  otherInputTokens: 0,
  otherOutputTokens: 0,
  totalTokens: 0,
  cacheHitRate: null,
  durationMs: null,
  tokensPerSecond: null,
  toolUses: null,
  lastTurnOutputTokens: null,
  lastTurnDurationMs: null,
  lastTurnTokensPerSecond: null,
  lastInputTokens: null,
  lastCacheHitRate: null,
  partial: false,
};

/** Below this, the divisor is too small for a rate to mean anything. */
const MIN_RATE_SAMPLE_MS = 1_000;

function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/** One provider turn: its settled usage, its live usage, and the window it ran in. */
export interface SessionUsageTurn {
  readonly usage?: TurnUsageValue;
  /** Provider reports during the turn, before its usage settles. */
  readonly liveUsage?: LiveUsageValue;
  readonly startedAt?: SessionUsageTimestamp;
  readonly completedAt?: SessionUsageTimestamp;
}

type LiveUsageValue =
  | { readonly outputTokens?: number | undefined; readonly updatedAt?: SessionUsageTimestamp }
  | null
  | undefined;

type TurnUsageValue = TurnTokenUsage | null | undefined;

/** A timestamp as the contracts decode it, an ISO string, or raw milliseconds. */
export type SessionUsageTimestamp =
  | string
  | number
  | { readonly epochMilliseconds: number }
  | null
  | undefined;

function epochMillis(value: SessionUsageTimestamp): number {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return value.epochMilliseconds;
}

export interface SessionUsageInput {
  /** Every provider turn of the thread, in thread order. */
  readonly turns: readonly SessionUsageTurn[];
  /** A provider-reported total, used only when no turn carries both timestamps. */
  readonly durationMs?: number | null;
  readonly toolUses?: number | null;
}

/**
 * Sum a thread's turns into one session reading.
 * @param input - the thread's provider turns and any provider-reported totals.
 * @returns totals, cache hit rate, and average speed; zeros when nothing reported usage.
 */
export function summarizeSessionUsage(input: SessionUsageInput): SessionUsageSummary {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let otherInputTokens = 0;
  let otherOutputTokens = 0;
  let partial = false;
  let turnDurationMs = 0;
  let lastInputTokens: number | null = null;
  let lastCachedInputTokens = 0;

  for (const turn of input.turns) {
    const usage = turn.usage;
    // A turn's own window is the only duration that survives compaction, so sum it here.
    const startedAt = epochMillis(turn.startedAt);
    const completedAt = epochMillis(turn.completedAt);
    if (Number.isFinite(startedAt) && Number.isFinite(completedAt) && completedAt > startedAt) {
      turnDurationMs += completedAt - startedAt;
    }
    if (usage === null || usage === undefined) continue;
    // A local command's counters describe that command, not model work.
    if (usage.localCommand === true) continue;
    if (usage.usageStatus !== "complete") partial = true;
    inputTokens += positive(usage.inputTokens);
    cachedInputTokens += positive(usage.cachedInputTokens);
    outputTokens += positive(usage.outputTokens);
    otherInputTokens += positive(usage.otherUsage?.inputTokens);
    otherOutputTokens += positive(usage.otherUsage?.outputTokens);
    // Turns arrive in thread order, so the last one that reported input is this turn's.
    const turnInputTokens = positive(usage.inputTokens);
    if (turnInputTokens > 0) {
      lastInputTokens = turnInputTokens;
      lastCachedInputTokens = positive(usage.cachedInputTokens);
    }
  }

  const lastTurn = input.turns.at(-1);
  let lastTurnOutputTokens: number | null = null;
  let lastTurnDurationMs: number | null = null;
  if (lastTurn !== undefined) {
    const settled = lastTurn.usage?.localCommand === true ? null : (lastTurn.usage ?? null);
    const elapsedOutput = settled === null ? positive(lastTurn.liveUsage?.outputTokens) : 0;
    const output = settled === null ? elapsedOutput : positive(settled.outputTokens);
    if (output > 0) lastTurnOutputTokens = output;
    const startedAt = epochMillis(lastTurn.startedAt);
    // A settled turn measures between its own timestamps. A running one measures to the
    // provider's latest report, which arrives with the usage rather than from a clock here.
    const settledEnd = epochMillis(lastTurn.completedAt);
    const reportedEnd = epochMillis(lastTurn.liveUsage?.updatedAt);
    const end = settledEnd > startedAt ? settledEnd : reportedEnd;
    if (Number.isFinite(end) && end > startedAt) lastTurnDurationMs = end - startedAt;
  }

  const reportedDurationMs = positive(input.durationMs ?? undefined);
  const durationMs = turnDurationMs > 0 ? turnDurationMs : reportedDurationMs || null;
  const totalTokens = inputTokens + outputTokens + otherInputTokens + otherOutputTokens;
  // A first turn still running has no settled usage yet, but it does have a live report.
  if (totalTokens === 0 && durationMs === null && lastTurnOutputTokens === null) {
    return EMPTY_SESSION_USAGE;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    otherInputTokens,
    otherOutputTokens,
    totalTokens,
    // Cached reads are a subset of input tokens, so input alone is the denominator.
    cacheHitRate: inputTokens > 0 ? cachedInputTokens / inputTokens : null,
    durationMs,
    tokensPerSecond:
      durationMs !== null && outputTokens > 0 ? outputTokens / (durationMs / 1000) : null,
    toolUses: input.toolUses != null && input.toolUses > 0 ? input.toolUses : null,
    lastInputTokens,
    lastCacheHitRate: lastInputTokens !== null ? lastCachedInputTokens / lastInputTokens : null,
    lastTurnOutputTokens,
    lastTurnDurationMs,
    lastTurnTokensPerSecond:
      lastTurnDurationMs !== null &&
      lastTurnOutputTokens !== null &&
      lastTurnDurationMs >= MIN_RATE_SAMPLE_MS
        ? lastTurnOutputTokens / (lastTurnDurationMs / 1000)
        : null,
    partial,
  };
}

/**
 * Keep the occupancy reading while a turn streams.
 *
 * Live usage carries the used count but usually no capacity, so the ring would fall back to a
 * placeholder for the whole turn. The thread's persisted snapshot still knows the capacity.
 */
export function withPersistedContextCapacity(
  snapshot: ContextWindowSnapshot | null,
  persisted: { readonly maxTokens?: number | undefined } | null | undefined,
): ContextWindowSnapshot | null {
  if (snapshot === null) return null;
  if (snapshot.maxTokens != null && snapshot.maxTokens > 0) return snapshot;
  const maxTokens = persisted?.maxTokens;
  if (maxTokens == null || !Number.isFinite(maxTokens) || maxTokens <= 0) return snapshot;
  const usedPercentage =
    snapshot.usedTokens > 0 ? Math.min(100, (snapshot.usedTokens / maxTokens) * 100) : 0;
  return {
    ...snapshot,
    maxTokens,
    usedPercentage,
    remainingTokens: Math.max(0, Math.round(maxTokens - snapshot.usedTokens)),
    remainingPercentage: Math.max(0, 100 - usedPercentage),
  };
}

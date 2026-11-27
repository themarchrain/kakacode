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
  /** Summed provider-reported turn duration, or null when no turn reported one. */
  readonly durationMs: number | null;
  /** Session average output speed in tokens per second, or null without a duration. */
  readonly tokensPerSecond: number | null;
  /** Tool calls the provider counted across the session, when it reports them. */
  readonly toolUses: number | null;
  /** True when at least one turn reported partial or unavailable usage, so totals run low. */
  readonly partial: boolean;
}

const EMPTY: SessionUsageSummary = {
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
  partial: false,
};

function finite(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export interface SessionUsageInput {
  /** Per-turn settled usage, in thread order. Turns without usage are skipped. */
  readonly turns: readonly (TurnTokenUsage | null | undefined)[];
  readonly durationMs?: number | null;
  readonly toolUses?: number | null;
}

/**
 * Sum a thread's turns into one session reading.
 * @param input - the thread's per-turn usage.
 * @returns totals, cache hit rate, and average speed; zeros when nothing reported usage.
 */
export function summarizeSessionUsage(input: SessionUsageInput): SessionUsageSummary {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let otherInputTokens = 0;
  let otherOutputTokens = 0;
  let partial = false;

  for (const turn of input.turns) {
    if (turn === null || turn === undefined) continue;
    // A local command's counters describe that command, not model work.
    if (turn.localCommand === true) continue;
    if (turn.usageStatus !== "complete") partial = true;
    inputTokens += finite(turn.inputTokens);
    cachedInputTokens += finite(turn.cachedInputTokens);
    outputTokens += finite(turn.outputTokens);
    otherInputTokens += finite(turn.otherUsage?.inputTokens);
    otherOutputTokens += finite(turn.otherUsage?.outputTokens);
  }

  const durationMs = input.durationMs != null && input.durationMs > 0 ? input.durationMs : null;
  const totalTokens = inputTokens + outputTokens + otherInputTokens + otherOutputTokens;
  if (totalTokens === 0 && durationMs === null) return EMPTY;

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
    partial,
  };
}

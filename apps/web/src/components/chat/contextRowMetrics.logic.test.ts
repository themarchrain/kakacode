import { describe, expect, it } from "vite-plus/test";
import { summarizeSessionUsage } from "./contextRowMetrics.logic";

const at = (seconds: number) =>
  new Date(Date.UTC(2026, 0, 1, 0, 0, 0, seconds * 1_000)).toISOString();

describe("summarizeSessionUsage", () => {
  it("sums every settled turn and treats cached reads as a subset of input", () => {
    const summary = summarizeSessionUsage({
      turns: [
        {
          usage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 10_000,
            cachedInputTokens: 8_000,
            outputTokens: 1_000,
            hasSubagents: false,
          },
          startedAt: at(0),
          completedAt: at(10),
        },
        {
          usage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 5_000,
            cachedInputTokens: 5_000,
            outputTokens: 500,
            hasSubagents: false,
          },
          startedAt: at(20),
          completedAt: at(30),
        },
      ],
    });

    expect(summary.inputTokens).toBe(15_000);
    expect(summary.cachedInputTokens).toBe(13_000);
    expect(summary.outputTokens).toBe(1_500);
    expect(summary.cacheHitRate).toBeCloseTo(13_000 / 15_000);
    // Twenty seconds of turns in total, so the session average divides by that, not by wall clock.
    expect(summary.durationMs).toBe(20_000);
    expect(summary.tokensPerSecond).toBeCloseTo(75);
  });

  it("counts a running turn from its live report while it has no settled usage", () => {
    const summary = summarizeSessionUsage({
      turns: [
        {
          usage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 1_000,
            outputTokens: 100,
            hasSubagents: false,
          },
          startedAt: at(0),
          completedAt: at(5),
        },
        {
          startedAt: at(10),
          completedAt: null,
          liveUsage: { outputTokens: 600, updatedAt: at(30) },
        },
      ],
    });

    expect(summary.lastTurnOutputTokens).toBe(600);
    expect(summary.lastTurnDurationMs).toBe(20_000);
    expect(summary.lastTurnTokensPerSecond).toBeCloseTo(30);
  });

  it("withholds a turn rate under one second, where the sample means nothing", () => {
    const summary = summarizeSessionUsage({
      turns: [
        {
          startedAt: at(0),
          completedAt: null,
          liveUsage: { outputTokens: 20, updatedAt: at(0.4) },
        },
      ],
    });

    expect(summary.lastTurnDurationMs).toBe(400);
    expect(summary.lastTurnTokensPerSecond).toBeNull();
  });

  it("ignores turns a local command ran, since those counters describe the command", () => {
    const summary = summarizeSessionUsage({
      turns: [
        {
          usage: {
            usageScope: "main_agent",
            usageStatus: "complete",
            inputTokens: 9_000,
            outputTokens: 900,
            localCommand: true,
            hasSubagents: false,
          },
        },
      ],
    });

    expect(summary.totalTokens).toBe(0);
  });
});

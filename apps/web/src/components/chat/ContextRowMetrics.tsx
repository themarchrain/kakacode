import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { useGT, useLocale } from "gt-react";
import { Database, Layers, Zap } from "lucide-react";
import { memo, type ReactNode } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { SessionUsageSummary } from "./contextRowMetrics.logic";

/** Ring geometry: a 14px viewBox with a 2.4px stroke. */
const RADIUS = 5.4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Percent used at which the ring turns from the accent to the warning tone, and then to error. */
const WARNING_PERCENT = 70;
const ERROR_PERCENT = 90;

type MetricTone = "normal" | "warning" | "error";

function ringTone(percent: number | null): MetricTone {
  if (percent === null) return "normal";
  if (percent >= ERROR_PERCENT) return "error";
  if (percent >= WARNING_PERCENT) return "warning";
  return "normal";
}

const TONE_STROKE: Record<MetricTone, string> = {
  normal: "stroke-primary",
  warning: "stroke-warning",
  error: "stroke-error",
};

const TONE_TEXT: Record<MetricTone, string> = {
  normal: "text-foreground",
  warning: "text-warning-foreground",
  error: "text-error-foreground",
};

/** One equal column, reading as a capsule the moment it is hovered or focused. */
const CELL_CLASS_NAME =
  "mx-0.5 flex min-w-0 items-center justify-center gap-1 overflow-hidden rounded-lg px-1.5 py-1 text-2xs leading-5 whitespace-nowrap text-muted-foreground tabular-nums outline-none transition-colors hover:bg-black/[0.035] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-popup-open:bg-black/[0.035] dark:hover:bg-white/[0.08] dark:data-popup-open:bg-white/[0.08] [&:not(:first-child)]:border-s [&:not(:first-child)]:border-border/60";

const VALUE_CLASS_NAME = "font-medium text-foreground";

const ICON_CLASS_NAME = "size-3 shrink-0 opacity-70";

export interface ContextRowMetricsProps {
  readonly usage: ContextWindowSnapshot;
  /** Session totals across every turn; null while the thread has only live usage. */
  readonly session: SessionUsageSummary | null;
  /** True while a turn is producing tokens, so the speed icon reads as live. */
  readonly streaming?: boolean | undefined;
}

/**
 * The thread's context window, read as four equal cells: occupancy ring, output speed,
 * session tokens, and cache hit rate. Every cell but the speed opens a tooltip.
 */
export const ContextRowMetrics = memo(function ContextRowMetrics(props: ContextRowMetricsProps) {
  const gt = useGT();
  const locale = useLocale();
  const { usage, session } = props;

  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const usedPercent =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const threshold = usage.autoCompactThreshold ?? null;
  const tone = ringTone(usedPercent);

  const tokensPerSecond =
    session?.tokensPerSecond != null ? session.tokensPerSecond.toFixed(1) : null;
  const totalTokens = session !== null && session.totalTokens > 0 ? session.totalTokens : null;
  const cachePercent =
    session?.cacheHitRate != null ? Math.round(session.cacheHitRate * 100) : null;
  const lastCachePercent =
    session?.lastCacheHitRate != null ? Math.round(session.lastCacheHitRate * 100) : null;
  const otherTokens = session !== null ? session.otherInputTokens + session.otherOutputTokens : 0;

  const tokens = (value: number) => formatContextWindowTokens(value);
  const exact = (value: number) => value.toLocaleString(locale);

  return (
    <div className="grid grid-cols-4 items-center">
      <Cell
        ariaLabel={
          usedPercent !== null
            ? gt("Context: {percent}% used", { percent: usedPercent })
            : gt("Context: {tokens} tokens used", { tokens: tokens(usage.usedTokens) })
        }
        tooltip={
          <>
            <Row label={gt("Used")} value={tokens(usage.usedTokens)} />
            {maxTokens !== null ? <Row label={gt("Limit")} value={tokens(maxTokens)} /> : null}
            {threshold !== null && threshold > 0 ? (
              <>
                <Rule />
                <Row label={gt("Auto-compact")} value={tokens(threshold)} />
              </>
            ) : null}
          </>
        }
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
          <circle
            cx="7"
            cy="7"
            r={RADIUS}
            fill="none"
            className="stroke-foreground/15"
            strokeWidth="2.4"
          />
          {usedPercent !== null ? (
            <circle
              cx="7"
              cy="7"
              r={RADIUS}
              fill="none"
              className={TONE_STROKE[tone]}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray={`${(CIRCUMFERENCE * usedPercent) / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          ) : null}
        </svg>
        <span className={cn("font-medium tabular-nums", TONE_TEXT[tone])}>
          {usedPercent !== null ? `${usedPercent}%` : "–"}
        </span>
      </Cell>

      {/* The speed cell opens nothing: the reading is the whole message. */}
      <div
        className={cn(CELL_CLASS_NAME, "cursor-default")}
        aria-label={
          tokensPerSecond !== null
            ? gt("{value} tokens per second", { value: tokensPerSecond })
            : gt("Speed unavailable")
        }
      >
        <Zap
          className={cn(ICON_CLASS_NAME, props.streaming === true && "text-success opacity-100")}
          aria-hidden
        />
        <span className={VALUE_CLASS_NAME}>{tokensPerSecond ?? "–"}</span>
      </div>

      <Cell
        ariaLabel={
          totalTokens !== null
            ? gt("{value} tokens used this session", { value: tokens(totalTokens) })
            : gt("Session tokens unavailable")
        }
        tooltip={
          session !== null && totalTokens !== null ? (
            <>
              <Row label={gt("Input tokens")} value={tokens(session.inputTokens)} />
              <Row label={gt("Cache hits")} value={tokens(session.cachedInputTokens)} />
              <Row label={gt("Output tokens")} value={tokens(session.outputTokens)} />
              {otherTokens > 0 ? (
                <Row label={gt("Subagents and compaction")} value={tokens(otherTokens)} />
              ) : null}
              <Rule />
              <Row
                label={gt("Total")}
                value={session.partial ? `~${tokens(totalTokens)}` : tokens(totalTokens)}
              />
              {session.toolUses !== null ? (
                <Row label={gt("Tool calls")} value={exact(session.toolUses)} />
              ) : null}
            </>
          ) : null
        }
      >
        <Database className={ICON_CLASS_NAME} aria-hidden />
        <span className={VALUE_CLASS_NAME}>{totalTokens !== null ? tokens(totalTokens) : "–"}</span>
      </Cell>

      <Cell
        ariaLabel={
          cachePercent !== null
            ? gt("Cache hit rate {percent}%", { percent: cachePercent })
            : gt("Cache hit rate unavailable")
        }
        tooltip={
          session !== null && cachePercent !== null ? (
            <>
              <Row label={gt("This session")} value={`${cachePercent}%`} />
              {lastCachePercent !== null ? (
                <Row label={gt("This turn")} value={`${lastCachePercent}%`} />
              ) : null}
              <Rule />
              <Row label={gt("Cached")} value={tokens(session.cachedInputTokens)} />
              <Row label={gt("Input total")} value={tokens(session.inputTokens)} />
            </>
          ) : null
        }
      >
        <Layers className={ICON_CLASS_NAME} aria-hidden />
        <span className={VALUE_CLASS_NAME}>{cachePercent !== null ? `${cachePercent}%` : "–"}</span>
      </Cell>
    </div>
  );
});

/** One label on the left and its reading on the right, at a shared rule. */
function Row(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-muted-foreground">{props.label}</span>
      <span className="font-medium text-foreground tabular-nums">{props.value}</span>
    </div>
  );
}

function Rule() {
  return <div aria-hidden className="my-0.5 h-px bg-border" />;
}

function Cell(props: {
  readonly children: ReactNode;
  readonly ariaLabel: string;
  readonly tooltip: ReactNode;
}) {
  if (props.tooltip === null) {
    return (
      <div className={CELL_CLASS_NAME} aria-label={props.ariaLabel}>
        {props.children}
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={<div tabIndex={0} className={CELL_CLASS_NAME} aria-label={props.ariaLabel} />}
      >
        {props.children}
      </TooltipTrigger>
      {/* The popup is a bare box, so the readings need their own column. */}
      <TooltipPopup side="top">
        <div className="flex min-w-44 flex-col gap-1">{props.tooltip}</div>
      </TooltipPopup>
    </Tooltip>
  );
}

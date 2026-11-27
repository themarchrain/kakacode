import type { ContextWindowSnapshot } from "@t3tools/client-runtime/state/context-window";
import { useGT, useLocale, useMessages } from "gt-react";
import { CircleDollarSign, Database, Layers, Zap } from "lucide-react";
import { memo, type ReactNode } from "react";

import { formatContextWindowTokens } from "../../lib/contextWindow";
import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatContextWindowCompactionMessage } from "./compaction.logic";
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

/** Shared cell chrome: one equal column, a divider before every cell but the first. */
const CELL_CLASS_NAME =
  "flex min-w-0 items-center justify-center gap-1 rounded-md px-1 py-0.5 text-2xs leading-5 text-muted-foreground tabular-nums [&:not(:first-child)]:border-s [&:not(:first-child)]:border-border/60";

const VALUE_CLASS_NAME = "font-medium text-foreground";

const ICON_CLASS_NAME = "size-3 shrink-0 opacity-70";

export interface ContextRowMetricsProps {
  readonly usage: ContextWindowSnapshot;
  /** Session totals across every turn; null while the thread has only live usage. */
  readonly session: SessionUsageSummary | null;
  /** Provider-reported session cost, when the provider reports one. */
  readonly costUsd?: number | null;
  /** True while a turn is producing tokens, so the speed icon reads as live. */
  readonly streaming?: boolean;
}

/**
 * The thread's context window, read as five equal cells: occupancy ring, output speed,
 * session tokens, cache hit rate, and cost. Each cell but the speed opens a tooltip.
 */
export const ContextRowMetrics = memo(function ContextRowMetrics(props: ContextRowMetricsProps) {
  const gt = useGT();
  const m = useMessages();
  const locale = useLocale();
  const { usage, session } = props;

  const maxTokens = usage.maxTokens != null && usage.maxTokens > 0 ? usage.maxTokens : null;
  const usedPercent =
    maxTokens !== null && usage.usedPercentage !== null
      ? Math.round(Math.max(0, Math.min(100, usage.usedPercentage)))
      : null;
  const usedTokens = formatContextWindowTokens(usage.usedTokens);
  const threshold = usage.autoCompactThreshold ?? null;
  const tone = ringTone(usedPercent);

  const tokensPerSecond =
    session?.tokensPerSecond != null ? session.tokensPerSecond.toFixed(1) : null;
  const totalTokens = session !== null && session.totalTokens > 0 ? session.totalTokens : null;
  const cachePercent =
    session?.cacheHitRate != null ? Math.round(session.cacheHitRate * 100) : null;
  const cost = props.costUsd != null && Number.isFinite(props.costUsd) ? props.costUsd : null;

  return (
    <div className="grid grid-cols-5 items-center">
      <Cell
        ariaLabel={
          usedPercent !== null
            ? gt("Context: {percent}% used", { percent: usedPercent })
            : gt("Context: {tokens} tokens used", { tokens: usedTokens })
        }
        tooltip={
          <>
            <span className="text-foreground">
              {usedPercent !== null
                ? gt("Context: {percent}% used", { percent: usedPercent })
                : gt("Context: {tokens} tokens used", { tokens: usedTokens })}
            </span>
            {maxTokens !== null ? (
              <span className="text-muted-foreground">
                {gt("{used} of {max} tokens", {
                  used: usage.usedTokens.toLocaleString(locale),
                  max: maxTokens.toLocaleString(locale),
                })}
              </span>
            ) : null}
            {threshold !== null && threshold > 0 ? (
              <span className="text-muted-foreground">
                {formatContextWindowCompactionMessage(threshold, m)}
              </span>
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
        className={CELL_CLASS_NAME}
        aria-label={
          tokensPerSecond !== null
            ? gt("{value} tokens per second", { value: tokensPerSecond })
            : gt("Speed unavailable")
        }
      >
        <Zap
          className={cn(ICON_CLASS_NAME, props.streaming === true && "opacity-100 text-success")}
          aria-hidden
        />
        <span className={VALUE_CLASS_NAME}>{tokensPerSecond ?? "–"}</span>
        <span>tps</span>
      </div>

      <Cell
        ariaLabel={
          totalTokens !== null
            ? gt("{value} tokens used this session", {
                value: formatContextWindowTokens(totalTokens),
              })
            : gt("Session tokens unavailable")
        }
        tooltip={
          session !== null && totalTokens !== null ? (
            <>
              <span className="text-foreground">
                {gt("{value} tokens this session", {
                  value: formatContextWindowTokens(totalTokens),
                })}
              </span>
              <span className="text-muted-foreground">
                {gt("Input {input} · cache {cached} · output {output}", {
                  input: formatContextWindowTokens(session.inputTokens),
                  cached: formatContextWindowTokens(session.cachedInputTokens),
                  output: formatContextWindowTokens(session.outputTokens),
                })}
              </span>
              {session.otherInputTokens + session.otherOutputTokens > 0 ? (
                <span className="text-muted-foreground">
                  {gt("Subagents and compaction {value}", {
                    value: formatContextWindowTokens(
                      session.otherInputTokens + session.otherOutputTokens,
                    ),
                  })}
                </span>
              ) : null}
              {session.toolUses !== null ? (
                <span className="text-muted-foreground">
                  {gt("{count} tool calls", { count: session.toolUses })}
                </span>
              ) : null}
              {session.partial ? (
                <span className="text-muted-foreground">
                  {gt("Some turns did not report usage")}
                </span>
              ) : null}
            </>
          ) : null
        }
      >
        <Database className={ICON_CLASS_NAME} aria-hidden />
        <span className={VALUE_CLASS_NAME}>
          {totalTokens !== null ? formatContextWindowTokens(totalTokens) : "–"}
        </span>
        {totalTokens !== null ? <span>tok</span> : null}
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
              <span className="text-foreground">
                {gt("Cache hit rate {percent}%", { percent: cachePercent })}
              </span>
              <span className="text-muted-foreground">
                {gt("Cached {cached} of {input} input tokens", {
                  cached: formatContextWindowTokens(session.cachedInputTokens),
                  input: formatContextWindowTokens(session.inputTokens),
                })}
              </span>
            </>
          ) : null
        }
      >
        <Layers className={ICON_CLASS_NAME} aria-hidden />
        <span className={VALUE_CLASS_NAME}>{cachePercent !== null ? `${cachePercent}%` : "–"}</span>
      </Cell>

      <Cell
        ariaLabel={
          cost !== null
            ? gt("Session cost {value}", { value: formatCost(cost, locale) })
            : gt("Session cost unavailable")
        }
        tooltip={
          cost !== null ? (
            <span className="text-foreground">
              {gt("Session cost {value}", { value: formatCost(cost, locale) })}
            </span>
          ) : null
        }
      >
        <CircleDollarSign className={ICON_CLASS_NAME} aria-hidden />
        <span className={VALUE_CLASS_NAME}>{cost !== null ? formatCost(cost, locale) : "–"}</span>
      </Cell>
    </div>
  );
});

/** Costs come from the pricing table, which is denominated in US dollars. */
function formatCost(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount < 1 ? 3 : 2,
  }).format(amount);
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
      <TooltipPopup side="top">{props.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

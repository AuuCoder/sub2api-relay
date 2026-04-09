import { type ReactNode, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, X } from "lucide-react";
import { copyText, cn, formatDate, formatMoney } from "../lib/utils";
import type { LimitSegment } from "../types";

type Tone = "success" | "warning" | "danger" | "neutral";

export function StatusBadge({
  tone = "neutral",
  children
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return <span className={cn("status-badge", `is-${tone}`)}>{children}</span>;
}

export function CopyField({
  label,
  value,
  displayValue,
  footer
}: {
  label: string;
  value: string;
  displayValue?: string;
  footer?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    await copyText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="copy-field">
      <button type="button" className="copy-main" onClick={() => void onCopy()}>
        <div className="copy-text">
          <p className="page-kicker">{label}</p>
          <code>{displayValue ?? value}</code>
        </div>
        <span className="copy-icon">{copied ? <Check size={16} /> : <Copy size={16} />}</span>
      </button>
      {footer ? <div className="copy-footer">{footer}</div> : null}
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="markdown-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-card surface-card-strong">
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function LimitTimeline({
  segments,
  currentTime,
  originalExpiresAt,
  compact = false
}: {
  segments: LimitSegment[];
  currentTime?: string | null;
  originalExpiresAt?: string | null;
  compact?: boolean;
}) {
  const model = useMemo(() => {
    const points = segments.flatMap((segment) => [
      new Date(segment.startAt).getTime(),
      new Date(segment.endAt).getTime()
    ]);

    if (currentTime) points.push(new Date(currentTime).getTime());
    if (originalExpiresAt) points.push(new Date(originalExpiresAt).getTime());

    const valid = points.filter(Number.isFinite);
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const span = Math.max(1, max - min);

    return {
      min,
      max,
      span,
      place(time: string) {
        const point = new Date(time).getTime();
        return ((point - min) / span) * 100;
      }
    };
  }, [segments, currentTime, originalExpiresAt]);

  if (!segments.length) {
    return <div className={cn("timeline-empty", compact && "is-compact")}>暂无变化</div>;
  }

  return (
    <div className={cn("timeline-card", compact && "is-compact")}>
      <div className="timeline-track" />
      {currentTime ? (
        <Marker label="当前" left={model.place(currentTime)} tone="cyan" compact={compact} />
      ) : null}
      {originalExpiresAt ? (
        <Marker label="原到期" left={model.place(originalExpiresAt)} tone="amber" compact={compact} />
      ) : null}
      <div className="timeline-layers">
        {segments.map((segment) => {
          const left = model.place(segment.startAt);
          const right = model.place(segment.endAt);
          const width = Math.max(2, right - left);
          const isPast = currentTime
            ? new Date(segment.endAt).getTime() <= new Date(currentTime).getTime()
            : false;

          return (
            <div
              key={`${segment.label}-${segment.startAt}-${segment.endAt}`}
              className={cn("timeline-segment", isPast && "is-past")}
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <span>{segment.label}</span>
              {!compact ? <strong>{formatMoney(segment.dailyQuotaUsd)}</strong> : null}
            </div>
          );
        })}
      </div>
      {!compact ? (
        <div className="timeline-meta">
          {segments.map((segment) => (
            <div key={`${segment.label}-${segment.startAt}`} className="timeline-meta-item">
              <span>{segment.label}</span>
              <p>
                {formatDate(segment.startAt)} → {formatDate(segment.endAt)}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Marker({
  label,
  left,
  tone,
  compact
}: {
  label: string;
  left: number;
  tone: "cyan" | "amber";
  compact: boolean;
}) {
  return (
    <div className={cn("timeline-marker", `is-${tone}`)} style={{ left: `${left}%` }}>
      <span className="timeline-marker-line" />
      {!compact ? <span className="timeline-marker-label">{label}</span> : null}
    </div>
  );
}

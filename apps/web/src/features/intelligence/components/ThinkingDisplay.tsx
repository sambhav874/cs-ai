import React, { useRef, useEffect, useState } from "react";
import { Loader2, ChevronDown, BrainCircuit, EyeOff } from "lucide-react";

interface ThinkingDisplayProps {
  /** The full thinking text (may be appended to over time while streaming). */
  thinking?: string;
  /** True while the model is still generating thinking content. */
  isStreaming: boolean;
  /** Set by the backend when Claude redacts one or more thinking blocks. */
  hasRedacted?: boolean;
  /** How long the full turn took — shown once streaming is done. */
  durationMs?: number;
  /** Whether the panel starts expanded. */
  defaultExpanded?: boolean;
}

function formatDuration(ms?: number) {
  if (!ms) return "0.0s";
  const s = Math.round((ms / 1000) * 10) / 10;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round((s % 60) * 10) / 10;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

export function ThinkingDisplay({
  thinking,
  isStreaming,
  hasRedacted = false,
  durationMs,
  defaultExpanded = false,
}: ThinkingDisplayProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || isStreaming);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom while streaming
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thinking, isStreaming]);

  // Auto-collapse when streaming finishes
  useEffect(() => {
    if (!isStreaming) setExpanded(false);
  }, [isStreaming]);

  const hasContent = Boolean(thinking?.trim()) || hasRedacted;
  if (!hasContent && !isStreaming) return null;

  return (
    <div
      style={{
        marginBottom: "0.75rem",
        borderLeft: "2px solid var(--border)",
        paddingLeft: "0.75rem",
      }}
    >
      {/* ── Header row ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: "12px",
          userSelect: "none",
        }}
      >
        {isStreaming ? (
          <>
            <Loader2
              style={{
                width: 12,
                height: 12,
                animation: "spin 1s linear infinite",
                opacity: 0.6,
              }}
            />
            <span style={{ fontStyle: "italic" }}>Thinking…</span>
          </>
        ) : (
          <>
            <BrainCircuit style={{ width: 12, height: 12, opacity: 0.5 }} />
            <span style={{ fontStyle: "italic" }}>
              Thought for {formatDuration(durationMs)}
            </span>
            {hasRedacted && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "3px",
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  opacity: 0.7,
                }}
              >
                <EyeOff style={{ width: 9, height: 9 }} />
                partial
              </span>
            )}
            <ChevronDown
              style={{
                width: 11,
                height: 11,
                transition: "transform 0.2s",
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </>
        )}
      </button>

      {/* ── Expanded thinking body ── */}
      {(expanded || isStreaming) && (
        <div
          ref={scrollRef}
          style={{
            marginTop: "0.5rem",
            maxHeight: isStreaming ? "200px" : "320px",
            overflowY: "auto",
            scrollbarWidth: "none",
            // Fade bottom edge to signal more content below
            WebkitMaskImage: isStreaming
              ? "linear-gradient(to bottom, black 70%, transparent 100%)"
              : undefined,
            maskImage: isStreaming
              ? "linear-gradient(to bottom, black 70%, transparent 100%)"
              : undefined,
          }}
        >
          {/* Redacted-block notice — shown at top if any block was hidden */}
          {hasRedacted && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                marginBottom: "6px",
                background: "var(--surface-1)",
                borderRadius: "var(--radius)",
                fontSize: "11px",
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              <EyeOff style={{ width: 10, height: 10, flexShrink: 0 }} />
              Some reasoning was hidden by the provider.
            </div>
          )}

          {/* Thinking text — split on double-newline so multi-block Claude
              thinking renders as visually distinct paragraphs */}
          {thinking
            ?.split(/\n\n+/)
            .filter(Boolean)
            .map((block, i) => (
              <p
                key={i}
                style={{
                  margin: i === 0 ? 0 : "0.6rem 0 0",
                  fontSize: "12px",
                  lineHeight: 1.65,
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-mono)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {block}
              </p>
            ))}

          {/* Streaming cursor */}
          {isStreaming && (
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "13px",
                marginLeft: "2px",
                verticalAlign: "middle",
                background: "var(--text-muted)",
                borderRadius: "1px",
                animation: "blink 1s step-end infinite",
                opacity: 0.5,
              }}
            />
          )}
        </div>
      )}

      {/* ── Keyframe styles injected once ── */}
      <style>{`
        @keyframes blink { 0%,100%{opacity:0.5} 50%{opacity:0} }
        @keyframes spin   { to{transform:rotate(360deg)} }
      `}</style>
    </div>
  );
}

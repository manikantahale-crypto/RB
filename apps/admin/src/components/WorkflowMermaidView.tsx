import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import mermaid from "mermaid";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import {
  resolveNodeCopy,
  resolveNodeType,
  type NodeCopy,
  type NodeRunStatus,
  type VisualNodeType,
} from "@tekisho/authoring/src/graph-visual-registry.js";
import { graphToMermaid, type GraphToMermaidOptions } from "../lib/graph-to-mermaid.js";

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    flowchart: {
      htmlLabels: true,
      curve: "basis",
    },
  });
  mermaidInitialized = true;
}

type WorkflowMermaidViewProps = {
  definition: GraphDefinition;
  title?: string;
  version?: number | null;
  mermaidOptions?: GraphToMermaidOptions;
};

/** View-model for a clickable node — copy is static; toolKey is internal only. */
type NodeViewModel = {
  graphNodeId: string;
  /** Internal — used for mapping / tests; never shown in the popover. */
  toolKey: string;
  visualType: VisualNodeType;
  copy: NodeCopy;
  /** Reserved for future live-run wiring — omit when absent. */
  status?: NodeRunStatus;
};

const OUTCOME_STYLES = {
  positive: {
    bg: "#ecfdf3",
    text: "#027a48",
    border: "#a6e8bf",
  },
  negative: {
    bg: "#fef3f2",
    text: "#b42318",
    border: "#fecdca",
  },
} as const;

const STATUS_CHIP: Record<
  NodeRunStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  pending: { label: "Pending", bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
  running: { label: "Running", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  succeeded: { label: "Done", bg: "#ecfdf3", color: "#027a48", border: "#a6e8bf" },
  failed: { label: "Failed", bg: "#fef3f2", color: "#b42318", border: "#fecdca" },
  waiting: { label: "Waiting on you", bg: "#fff8ec", color: "#7a3d00", border: "#e2a53a" },
};

function sectionHeading(label: string) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "#94a3b8",
        marginBottom: 6,
      }}
    >
      {label}
    </div>
  );
}

function HeaderIcon({ isGate }: { isGate: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        background: isGate ? "#fef3c7" : "#f1f5f9",
        border: isGate ? "1px solid #e2a53a" : "1px solid #e2e8f0",
        color: isGate ? "#7a3d00" : "#334155",
        fontSize: 16,
        fontWeight: 800,
      }}
    >
      {isGate ? "!" : "↻"}
    </span>
  );
}

function NodeDetailPopover({
  details,
  style,
  popoverRef,
  closeButtonRef,
  onClose,
}: {
  details: NodeViewModel;
  style?: CSSProperties;
  popoverRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const isGate = details.visualType === "human_gate";
  const copy = details.copy;
  const headerBg = isGate ? "#fff8ec" : "#fff";
  const producesHeading = isGate ? "What you'll need to do" : "What it produces";
  const outcomesHeading = isGate
    ? "What happens after you decide"
    : "Where it goes next";
  const statusChip = details.status ? STATUS_CHIP[details.status] : null;

  return (
    <div
      ref={popoverRef}
      data-testid="workflow-node-popover"
      role="dialog"
      aria-label={`${copy.title} details`}
      style={{
        ...(style ?? {}),
        width: 440,
        maxWidth: "min(440px, 92vw)",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,0.14)",
        overflow: "hidden",
        zIndex: 60,
        outline: "2px solid #93c5fd",
        outlineOffset: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 14px 12px",
          background: headerBg,
          borderBottom: "1px solid #eef2f7",
        }}
      >
        <HeaderIcon isGate={isGate} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: isGate ? "#7a3d00" : "#64748b",
              marginBottom: 2,
            }}
            data-testid="workflow-node-kicker"
          >
            {copy.kicker}
          </div>
          <div
            style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", lineHeight: 1.25 }}
            data-testid="workflow-node-title"
          >
            {copy.title}
          </div>
          {statusChip ? (
            <span
              data-testid="workflow-node-status"
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 999,
                background: statusChip.bg,
                color: statusChip.color,
                border: `1px solid ${statusChip.border}`,
              }}
            >
              {statusChip.label}
            </span>
          ) : null}
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          data-testid="workflow-node-popover-close"
          onClick={onClose}
          aria-label="Close"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            border: "1px solid #e5e7eb",
            background: "#fff",
            borderRadius: 10,
            fontWeight: 800,
            color: "#64748b",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          padding: "16px 16px 18px",
          maxHeight: "70vh",
          overflowY: "auto",
          overscrollBehavior: "contain",
        }}
      >
        <section style={{ marginBottom: 16 }} data-testid="workflow-node-why">
          {sectionHeading("Why this step happens")}
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: "#334155",
            }}
            data-testid="workflow-node-why-text"
          >
            {copy.why}
          </p>
        </section>

        <section style={{ marginBottom: copy.outcomes.length ? 16 : 0 }} data-testid="workflow-node-produces">
          {sectionHeading(producesHeading)}
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: "#334155",
            }}
            data-testid="workflow-node-produces-text"
          >
            {copy.produces}
          </p>
        </section>

        {copy.outcomes.length > 0 ? (
          <section data-testid="workflow-node-outcomes">
            {sectionHeading(outcomesHeading)}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {copy.outcomes.map((o) => {
                const s = OUTCOME_STYLES[o.tone];
                return (
                  <div
                    key={`${o.tone}-${o.label}`}
                    data-testid="workflow-node-outcome"
                    data-tone={o.tone}
                    className={`workflow-outcome workflow-outcome--${o.tone}`}
                    style={{
                      background: s.bg,
                      color: s.text,
                      border: `1px solid ${s.border}`,
                      borderRadius: 10,
                      padding: "10px 12px",
                    }}
                  >
                    <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 3 }}>
                      {o.label}
                    </div>
                    <div style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.95 }}>
                      {o.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function WorkflowMermaidView({
  definition,
  title,
  version,
  mermaidOptions,
}: WorkflowMermaidViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const openNodeIdRef = useRef<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [popoverContainerRect, setPopoverContainerRect] = useState<DOMRect | null>(
    null,
  );

  const lastFocusedNodeRef = useRef<HTMLElement | SVGElement | null>(null);
  const popoverCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | undefined>(undefined);

  const nodesById = useMemo(() => {
    const m = new Map<string, NodeViewModel>();

    for (const n of definition.nodes) {
      const toolKey = n.impl;
      m.set(n.id, {
        graphNodeId: n.id,
        toolKey,
        visualType: resolveNodeType(toolKey),
        copy: resolveNodeCopy(toolKey),
        // status intentionally omitted until run-data wiring lands
      });
    }

    m.set("__start__", {
      graphNodeId: "__start__",
      toolKey: "__start__",
      visualType: "start",
      copy: resolveNodeCopy("__start__"),
    });
    m.set("__end__", {
      graphNodeId: "__end__",
      toolKey: "__end__",
      visualType: "end",
      copy: resolveNodeCopy("__end__"),
    });

    return m;
  }, [definition]);

  useEffect(() => {
    openNodeIdRef.current = openNodeId;
  }, [openNodeId]);

  useEffect(() => {
    ensureMermaidInit();
    const el = containerRef.current;
    if (!el) return;

    setOpenNodeId(null);
    setAnchorRect(null);
    setPopoverContainerRect(null);
    setPopoverStyle(undefined);

    let cancelled = false;
    const source = graphToMermaid(definition, mermaidOptions);

    let cleanupNodeListeners: (() => void) | null = null;

    void (async () => {
      try {
        setError(null);
        const { svg } = await mermaid.render(`workflow-${renderId}`, source);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;

        const svgEl = containerRef.current.querySelector("svg");
        if (!svgEl) return;

        // Color edge labels to match outcome tones (linkStyle colors the path;
        // labels need an extra pass for readable green/red text).
        for (const labelEl of svgEl.querySelectorAll("g.edgeLabel, .edgeLabel")) {
          const text = (labelEl.textContent ?? "").trim().toLowerCase();
          const span = labelEl.querySelector("span, foreignObject, p, div") as
            | HTMLElement
            | null;
          const target = (span ?? labelEl) as HTMLElement;
          if (
            text.includes("no duplicate") ||
            text === "approved" ||
            text.includes("approv")
          ) {
            target.style.color = "#027a48";
            target.style.fontWeight = "700";
          } else if (
            text.includes("duplicate found") ||
            text === "rejected" ||
            text.includes("reject")
          ) {
            target.style.color = "#b42318";
            target.style.fontWeight = "700";
          }
        }

        const nodeEls = Array.from(svgEl.querySelectorAll<SVGGElement>("g.node"));
        const graphNodeIdByEl = new Map<SVGGElement, string>();
        const cleanupFns: Array<() => void> = [];

        for (const nodeEl of nodeEls) {
          const graphSpan = nodeEl.querySelector<HTMLElement>(
            "span[data-graph-node-id]",
          );
          if (graphSpan?.dataset.graphNodeId) {
            const gid = graphSpan.dataset.graphNodeId;
            graphNodeIdByEl.set(nodeEl, gid);
            nodeEl.setAttribute("data-graph-node-id", gid);
            nodeEl.setAttribute(
              "data-tool-key",
              nodesById.get(gid)?.toolKey ?? "",
            );
          } else {
            const t = (nodeEl.textContent ?? "").trim();
            const gid = t.includes("Start")
              ? "__start__"
              : t.includes("End")
                ? "__end__"
                : "";
            if (gid) {
              graphNodeIdByEl.set(nodeEl, gid);
              nodeEl.setAttribute("data-graph-node-id", gid);
              nodeEl.setAttribute(
                "data-tool-key",
                nodesById.get(gid)?.toolKey ?? "",
              );
            }
          }

          const focusEl =
            (nodeEl.querySelector<SVGGraphicsElement>(
              "rect, circle, polygon, path",
            ) ?? nodeEl);

          nodeEl.style.cursor = "pointer";
          focusEl.style.cursor = "pointer";
          focusEl.setAttribute("role", "button");
          focusEl.setAttribute("tabIndex", "0");
          focusEl.setAttribute("data-testid", "workflow-mermaid-node");
          const toolKey = graphNodeIdByEl.get(nodeEl)
            ? nodesById.get(graphNodeIdByEl.get(nodeEl)!)?.toolKey ?? ""
            : "";
          focusEl.setAttribute("data-tool-key", toolKey);
          const aria = graphNodeIdByEl.get(nodeEl)
            ? nodesById.get(graphNodeIdByEl.get(nodeEl)!)?.copy.title ?? ""
            : "";
          if (aria) focusEl.setAttribute("aria-label", aria);
        }

        const openOrToggle = (graphNodeId: string, nodeEl: SVGGElement) => {
          const details = nodesById.get(graphNodeId);
          if (!details) return;

          const currentOpen = openNodeIdRef.current;
          if (currentOpen === graphNodeId) {
            setOpenNodeId(null);
            setAnchorRect(null);
            setPopoverContainerRect(null);
            setPopoverStyle(undefined);
            return;
          }

          const active = document.activeElement as Element | null;
          if (active?.getAttribute?.("data-testid") === "workflow-mermaid-node") {
            lastFocusedNodeRef.current = active as HTMLElement;
          } else {
            lastFocusedNodeRef.current = nodeEl;
          }
          setAnchorRect(nodeEl.getBoundingClientRect());
          setPopoverContainerRect(
            containerRef.current?.getBoundingClientRect() ?? null,
          );
          setOpenNodeId(graphNodeId);
        };

        for (const nodeEl of nodeEls) {
          const graphNodeId = graphNodeIdByEl.get(nodeEl);
          if (!graphNodeId) continue;

          const onClick = () => openOrToggle(graphNodeId, nodeEl);

          const rect = nodeEl.getBoundingClientRect();
          const overlay = document.createElement("button");
          overlay.type = "button";
          overlay.tabIndex = 0;
          overlay.setAttribute("data-testid", "workflow-mermaid-node");
          overlay.setAttribute(
            "data-tool-key",
            nodesById.get(graphNodeId)?.toolKey ?? "",
          );
          overlay.setAttribute(
            "aria-label",
            nodesById.get(graphNodeId)?.copy.title ?? graphNodeId,
          );
          overlay.style.position = "fixed";
          overlay.style.left = `${rect.left}px`;
          overlay.style.top = `${rect.top}px`;
          overlay.style.width = `${Math.max(rect.width, 1)}px`;
          overlay.style.height = `${Math.max(rect.height, 1)}px`;
          overlay.style.background = "transparent";
          overlay.style.border = "none";
          overlay.style.padding = "0";
          overlay.style.margin = "0";
          overlay.style.cursor = "pointer";
          overlay.style.zIndex = "10";
          overlay.style.color = "transparent";
          overlay.style.fontSize = "0px";
          document.body.appendChild(overlay);
          overlay.addEventListener("click", onClick);

          const focusEl =
            (nodeEl.querySelector<SVGGraphicsElement>(
              "rect, circle, polygon, path",
            ) ?? nodeEl);
          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openOrToggle(graphNodeId, nodeEl);
            }
          };

          nodeEl.addEventListener("click", onClick);
          focusEl.addEventListener("keydown", onKeyDown);
          overlay.addEventListener("keydown", onKeyDown);

          cleanupFns.push(() => {
            nodeEl.removeEventListener("click", onClick);
            focusEl.removeEventListener("keydown", onKeyDown);
            overlay.removeEventListener("click", onClick);
            overlay.removeEventListener("keydown", onKeyDown);
            overlay.remove();
          });
        }

        cleanupNodeListeners = () => {
          for (const fn of cleanupFns) fn();
        };
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        el.innerHTML = "";
      }
    })();

    return () => {
      cancelled = true;
      cleanupNodeListeners?.();
    };
  }, [definition, mermaidOptions, renderId, nodesById]);

  const openDetails = openNodeId ? nodesById.get(openNodeId) : undefined;

  const closePopover = () => {
    setOpenNodeId(null);
    setAnchorRect(null);
    setPopoverContainerRect(null);
    setPopoverStyle(undefined);
    requestAnimationFrame(() => {
      lastFocusedNodeRef.current?.focus?.();
    });
  };

  useLayoutEffect(() => {
    if (!openNodeId) return;
    popoverCloseButtonRef.current?.focus();
  }, [openNodeId]);

  useEffect(() => {
    if (!openNodeId) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
      }
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (popoverRef.current && popoverRef.current.contains(target)) return;
      const node = target.closest?.("g.node");
      const nodeBtn = target.closest?.('[data-testid="workflow-mermaid-node"]');
      if (node || nodeBtn) return;
      closePopover();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openNodeId]);

  useLayoutEffect(() => {
    if (!openNodeId || !anchorRect) return;
    const containerRect =
      popoverContainerRect ?? containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const pop = popoverRef.current;
    if (!pop) return;

    const gap = 12;
    const popRect = pop.getBoundingClientRect();
    const popW = popRect.width;
    const popH = popRect.height;

    const spaceRight = containerRect.right - anchorRect.right;
    const spaceLeft = anchorRect.left - containerRect.left;
    const placeRight = spaceRight >= spaceLeft;

    const spaceBottom = containerRect.bottom - anchorRect.bottom;
    const spaceTop = anchorRect.top - containerRect.top;
    const placeBelow = spaceBottom >= spaceTop;

    const pad = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const rectsOverlap = (
      ax: number,
      ay: number,
      aw: number,
      ah: number,
      bx: number,
      by: number,
      bw: number,
      bh: number,
    ) => {
      return !(ax + aw <= bx || bx + bw <= ax || ay + ah <= by || by + bh <= ay);
    };

    const tryPlace = (tryRight: boolean, tryBelow: boolean) => {
      const candidateLeft = tryRight
        ? anchorRect.right + gap
        : anchorRect.left - popW - gap;
      const candidateTop = tryBelow
        ? anchorRect.bottom + gap
        : anchorRect.top - popH - gap;

      const left = Math.min(
        Math.max(candidateLeft, pad),
        Math.min(viewportW - popW - pad, containerRect.right - popW - pad),
      );
      const top = Math.min(
        Math.max(candidateTop, pad),
        Math.min(viewportH - popH - pad, containerRect.bottom - popH - pad),
      );

      const overlapsAnchor = rectsOverlap(
        left,
        top,
        popW,
        popH,
        anchorRect.left,
        anchorRect.top,
        anchorRect.width,
        anchorRect.height,
      );

      return overlapsAnchor ? null : { left, top };
    };

    const candidates = [
      { right: placeRight, below: placeBelow },
      { right: !placeRight, below: placeBelow },
      { right: placeRight, below: !placeBelow },
      { right: !placeRight, below: !placeBelow },
    ];

    const chosen =
      candidates.map((c) => tryPlace(c.right, c.below)).find(Boolean) ?? {
        left: pad,
        top: pad,
      };

    setPopoverStyle({
      position: "fixed",
      left: chosen.left,
      top: chosen.top,
      zIndex: 60,
    });
  }, [openNodeId, anchorRect, popoverContainerRect]);

  return (
    <div
      className="workflow-canvas workflow-canvas--mermaid"
      style={{
        background: "#f8fafc",
        borderRadius: 14,
        boxShadow: "0 2px 16px rgba(0,0,0,0.09), 0 0 0 1px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "rgba(255,255,255,0.94)",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "#64748b",
              letterSpacing: "0.14em",
            }}
          >
            SYNTRA
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#0f172a",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title ?? "Workflow"}
          </span>
        </div>
        <MermaidLegend />
      </div>

      <div
        data-testid="workflow-mermaid"
        ref={containerRef}
        className="workflow-mermaid"
        style={{
          width: "100%",
          minHeight: 560,
          height: "min(80vh, 840px)",
          padding: "24px 16px",
          overflow: "auto",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      />

      {error ? (
        <p className="muted" style={{ padding: "8px 16px", color: "#b45309" }} role="alert">
          Mermaid render failed: {error}
        </p>
      ) : null}

      {version != null ? (
        <div
          style={{
            fontSize: 11,
            color: "#94a3b8",
            padding: "5px 14px",
            borderTop: "1px solid #e5e7eb",
            textAlign: "right",
            background: "#fff",
          }}
        >
          version {version}
        </div>
      ) : null}

      {openDetails && anchorRect
        ? createPortal(
            <NodeDetailPopover
              details={openDetails}
              style={popoverStyle}
              popoverRef={popoverRef}
              closeButtonRef={popoverCloseButtonRef}
              onClose={closePopover}
            />,
            document.body,
          )
        : null}
    </div>
  );
}

function MermaidLegend() {
  return (
    <div
      data-testid="workflow-legend"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 11,
        color: "#64748b",
        flexShrink: 0,
      }}
    >
      <LegendChip shape="circle" bg="#14161c" border="transparent" label="Start / End" />
      <LegendChip shape="square" bg="#fff" border="#e4e6eb" label="Automatic" />
      <LegendChip shape="square" bg="#fff8ec" border="#e2a53a" label="Needs a person" />
    </div>
  );
}

function LegendChip({
  shape,
  bg,
  border,
  label,
}: {
  shape: "circle" | "square";
  bg: string;
  border: string;
  label: string;
}) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          display: "inline-block",
          width: 13,
          height: 13,
          borderRadius: shape === "circle" ? 999 : 3,
          background: bg,
          border: `1.5px solid ${border}`,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}

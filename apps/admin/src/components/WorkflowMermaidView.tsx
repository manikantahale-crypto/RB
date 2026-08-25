import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import mermaid from "mermaid";
import { token } from "../lib/tokens.js";
import type { GraphDefinition } from "@tekisho/authoring/src/graph-definition.js";
import {
  resolveNodeCopy,
  resolveNodeType,
  resolveToolFamily,
  toolFamilyBlurb,
  toolFamilyLabel,
  type NodeCopy,
  type NodeRunStatus,
  type ToolFamily,
  type VisualNodeType,
} from "@tekisho/authoring/src/graph-visual-registry.js";
import { graphToMermaid, type GraphToMermaidOptions } from "../lib/graph-to-mermaid.js";
import { friendlyEventLabel } from "../lib/friendly-labels";

/** Start-node copy: explain *when* this workflow runs (not a separate banner). */
function startNodeCopy(triggerEventType?: string | null): NodeCopy {
  const eventLabel = triggerEventType?.trim()
    ? friendlyEventLabel(triggerEventType.trim())
    : null;
  return {
    title: "Start",
    kicker: "When this workflow starts",
    why: eventLabel
      ? `This workflow begins when: ${eventLabel}. That event is what kicks off every run of this agent.`
      : "This is where the workflow begins. Set a trigger event in Policy so everyone can see exactly what starts each run.",
    produces: eventLabel
      ? "When that event arrives, the first automatic step runs right away."
      : "Hand-off into the first automatic step so processing can begin.",
    outcomes: [],
  };
}

const PANEL_WIDTH_PX = 400;
/** Must match the app body font so Mermaid's measure pass agrees with render. */
const MERMAID_FONT_FAMILY =
  '"Source Sans 3", "Segoe UI", system-ui, -apple-system, sans-serif';

const EDGE_TONE_COLORS = {
  positive: {
    bg: "var(--success-bg-canvas)",
    text: "var(--green-success-strong)",
    border: "var(--success-border-canvas)",
  },
  negative: {
    bg: "var(--danger-bg-canvas)",
    text: "var(--status-danger-fg)",
    border: "var(--danger-border-canvas)",
  },
} as const;

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      fontFamily: MERMAID_FONT_FAMILY,
      // Neutral default — per-tone colors applied after render.
      //
      // RESOLVED, not `var(...)`. Mermaid runs theme variables through its own
      // colour maths — lighten, darken, pick contrasting text — so a custom
      // property string reaches those functions unparsed and renders an
      // invisible diagram. Reading the token keeps the value in tokens.css,
      // so restyling the app still restyles the diagram.
      edgeLabelBackground: token("--neutral-0", "#ffffff"),
    },
    flowchart: {
      htmlLabels: true,
      curve: "basis",
      // Extra padding around label text inside Mermaid's measured box.
      padding: 12,
      // Keep content (incl. edge labels at extremes) off the SVG boundary.
      diagramPadding: 24,
    },
    fontFamily: MERMAID_FONT_FAMILY,
  });
  mermaidInitialized = true;
}

function resolveLabelTone(
  text: string,
): "positive" | "negative" | null {
  const t = text.trim().toLowerCase();
  if (
    t.includes("no duplicate") ||
    t === "approved" ||
    t.includes("approv")
  ) {
    return "positive";
  }
  if (
    t.includes("duplicate found") ||
    t === "rejected" ||
    t.includes("reject")
  ) {
    return "negative";
  }
  return null;
}

/** Style Mermaid edge labels with tone text colors (no outline boxes). */
function applyEdgeLabelTones(svgEl: Element) {
  for (const labelEl of svgEl.querySelectorAll("g.edgeLabel, .edgeLabel")) {
    const text = (labelEl.textContent ?? "").replace(/\s+/g, " ").trim();
    const tone = resolveLabelTone(text);
    if (!tone) continue;

    const colors = EDGE_TONE_COLORS[tone];
    labelEl.setAttribute("data-edge-tone", tone);
    labelEl.setAttribute("data-testid", "workflow-edge-label");

    // Hide Mermaid's default rect backdrop — labels are plain colored text.
    for (const rect of labelEl.querySelectorAll("rect")) {
      rect.setAttribute("fill", "none");
      rect.setAttribute("stroke", "none");
    }

    const fo = labelEl.querySelector("foreignObject");
    if (fo) {
      fo.setAttribute("overflow", "visible");
      const w = Number(fo.getAttribute("width") ?? "0");
      if (Number.isFinite(w) && w > 0) {
        fo.setAttribute("width", String(w + 16));
        const x = Number(fo.getAttribute("x") ?? "0");
        if (Number.isFinite(x)) fo.setAttribute("x", String(x - 8));
      }
    }

    for (const el of labelEl.querySelectorAll<HTMLElement>(
      "div, span, p, label",
    )) {
      // Soft mask so text stays readable where it crosses a connector line.
      el.style.background = "var(--surface-tint-c)";
      el.style.color = colors.text;
      el.style.border = "none";
      el.style.borderRadius = "0";
      el.style.padding = "0 2px";
      el.style.fontWeight = "700";
      el.style.fontFamily = MERMAID_FONT_FAMILY;
      el.style.whiteSpace = "nowrap";
      el.style.overflow = "visible";
      el.style.display = "inline-block";
      el.style.boxSizing = "border-box";
    }
  }
}

/**
 * Expand the SVG viewBox/size so edge labels past the rightmost/leftmost nodes
 * aren't clipped by the SVG viewport (Mermaid often sizes from node bounds only).
 */
function expandSvgToFitEdgeLabels(svgEl: SVGSVGElement, pad = 24) {
  const vb = svgEl.viewBox?.baseVal;
  if (!vb || vb.width <= 0 || vb.height <= 0) return;

  let minX = vb.x;
  let minY = vb.y;
  let maxX = vb.x + vb.width;
  let maxY = vb.y + vb.height;

  for (const labelEl of svgEl.querySelectorAll("g.edgeLabel, .edgeLabel")) {
    try {
      const box = (labelEl as SVGGElement).getBBox();
      if (!Number.isFinite(box.width) || box.width <= 0) continue;
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    } catch {
      // Element not in render tree yet — skip.
    }
  }

  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  svgEl.setAttribute("viewBox", `${minX} ${minY} ${width} ${height}`);
  svgEl.setAttribute("width", String(width));
  svgEl.setAttribute("height", String(height));
  svgEl.style.overflow = "visible";
  svgEl.style.maxWidth = "none";
}

type WorkflowMermaidViewProps = {
  definition: GraphDefinition;
  title?: string;
  version?: number | null;
  mermaidOptions?: GraphToMermaidOptions;
  /** Event that starts this workflow — shown when Start is clicked. */
  triggerEventType?: string | null;
  /** Whether this graph is bound live. */
  isLive?: boolean;
};

/** View-model for a clickable node — copy is static; toolKey is internal only. */
type NodeViewModel = {
  graphNodeId: string;
  /** Internal — used for mapping / tests; never shown as the main title. */
  toolKey: string;
  visualType: VisualNodeType;
  family: ToolFamily;
  copy: NodeCopy;
  /** Reserved for future live-run wiring — omit when absent. */
  status?: NodeRunStatus;
};

const OUTCOME_STYLES = {
  positive: {
    bg: "var(--success-bg-canvas)",
    text: "var(--green-success-strong)",
    border: "var(--success-border-canvas)",
  },
  negative: {
    bg: "var(--danger-bg-canvas)",
    text: "var(--status-danger-fg)",
    border: "var(--danger-border-canvas)",
  },
} as const;

const STATUS_CHIP: Record<
  NodeRunStatus,
  { label: string; bg: string; color: string; border: string }
> = {
  pending: { label: "Pending", bg: "var(--slate-50)", color: "var(--slate-500)", border: "var(--slate-200)" },
  running: { label: "Running", bg: "var(--info-bg)", color: "var(--info-fg)", border: "var(--info-border)" },
  succeeded: { label: "Done", bg: "var(--success-bg-canvas)", color: "var(--green-success-strong)", border: "var(--success-border-canvas)" },
  failed: { label: "Failed", bg: "var(--danger-bg-canvas)", color: "var(--status-danger-fg)", border: "var(--danger-border-canvas)" },
  waiting: { label: "Waiting on you", bg: "var(--warning-bg-canvas)", color: "var(--warning-fg-canvas)", border: "var(--warning-accent-canvas)" },
};

function sectionHeading(label: string) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--slate-400)",
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
        background: isGate ? "var(--warning-bg-canvas-alt)" : "var(--slate-100)",
        border: isGate ? "1px solid var(--warning-accent-canvas)" : "1px solid var(--slate-200)",
        color: isGate ? "var(--warning-fg-canvas)" : "var(--slate-700)",
        fontSize: 16,
        fontWeight: 800,
      }}
    >
      {isGate ? "!" : "↻"}
    </span>
  );
}

function NodeDetailPanel({
  details,
  panelRef,
  closeButtonRef,
  onClose,
}: {
  details: NodeViewModel;
  panelRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const isGate = details.visualType === "human_gate";
  const isStart = details.visualType === "start";
  const isEnd = details.visualType === "end";
  const copy = details.copy;
  const familyLabel = toolFamilyLabel(details.family);
  const familyBlurb = toolFamilyBlurb(details.family);
  const familyColor =
    details.family === "astra"
      ? { bg: "var(--info-bg)", text: "var(--info-fg)", border: "var(--info-border)" }
      : details.family === "syntra"
        ? { bg: "var(--success-bg-canvas-alt)", text: "var(--green-600)", border: "var(--success-border-canvas-alt)" }
        : details.family === "platform"
          ? { bg: "var(--purple-bg-canvas)", text: "var(--purple-fg-canvas)", border: "var(--purple-border-canvas)" }
          : null;
  const headerBg = isGate ? "var(--warning-bg-canvas)" : "var(--neutral-0)";
  const whyHeading = isStart
    ? "When this workflow starts"
    : isEnd
      ? "What End means"
      : "Why this step happens";
  const producesHeading = isGate
    ? "What you'll need to do"
    : isStart
      ? "What happens next"
      : "What it produces";
  const outcomesHeading = isGate
    ? "What happens after you decide"
    : "Where it goes next";
  const statusChip = details.status ? STATUS_CHIP[details.status] : null;

  return (
    <aside
      ref={panelRef}
      data-testid="workflow-node-popover"
      role="dialog"
      aria-label={`${copy.title} details`}
      className="workflow-detail-panel"
      style={{
        width: PANEL_WIDTH_PX,
        flexShrink: 0,
        alignSelf: "stretch",
        display: "flex",
        flexDirection: "column",
        background: "var(--neutral-0)",
        borderLeft: "1px solid var(--slate-210)",
        overflow: "hidden",
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          padding: "14px 14px 12px",
          background: headerBg,
          borderBottom: "1px solid var(--slate-150)",
          flexShrink: 0,
        }}
      >
        <HeaderIcon isGate={isGate} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: isGate ? "var(--warning-fg-canvas)" : "var(--slate-500)",
              marginBottom: 2,
            }}
            data-testid="workflow-node-kicker"
          >
            {copy.kicker}
          </div>
          <div
            style={{ fontSize: 17, fontWeight: 800, color: "var(--slate-900)", lineHeight: 1.25 }}
            data-testid="workflow-node-title"
          >
            {copy.title}
          </div>
          {familyLabel && familyColor ? (
            <span
              data-testid="workflow-node-family"
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: 999,
                background: familyColor.bg,
                color: familyColor.text,
                border: `1px solid ${familyColor.border}`,
              }}
            >
              {familyLabel}
            </span>
          ) : null}
          {statusChip ? (
            <span
              data-testid="workflow-node-status"
              style={{
                display: "inline-block",
                marginTop: 8,
                marginLeft: familyLabel ? 6 : 0,
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
            border: "1px solid var(--slate-210)",
            background: "var(--neutral-0)",
            borderRadius: 10,
            fontWeight: 800,
            color: "var(--slate-500)",
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
          overflowY: "auto",
          overscrollBehavior: "contain",
          flex: 1,
          minHeight: 0,
        }}
      >
        {familyBlurb ? (
          <section style={{ marginBottom: 16 }} data-testid="workflow-node-family-blurb">
            {sectionHeading("Which tools this uses")}
            <p
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.6,
                color: "var(--slate-700)",
              }}
            >
              {familyBlurb}
            </p>
          </section>
        ) : null}

        <section style={{ marginBottom: 16 }} data-testid="workflow-node-why">
          {sectionHeading(whyHeading)}
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--slate-700)",
            }}
            data-testid="workflow-node-why-text"
          >
            {copy.why}
          </p>
        </section>

        <section
          style={{ marginBottom: copy.outcomes.length ? 16 : 0 }}
          data-testid="workflow-node-produces"
        >
          {sectionHeading(producesHeading)}
          <p
            style={{
              margin: 0,
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--slate-700)",
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
    </aside>
  );
}

export function WorkflowMermaidView({
  definition,
  title,
  version,
  mermaidOptions,
  triggerEventType,
  isLive,
}: WorkflowMermaidViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderId = useId().replace(/:/g, "");
  const [error, setError] = useState<string | null>(null);

  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const openNodeIdRef = useRef<string | null>(null);

  const lastFocusedNodeRef = useRef<HTMLElement | SVGElement | null>(null);
  const panelCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const overlayResyncRef = useRef<(() => void) | null>(null);

  const nodesById = useMemo(() => {
    const m = new Map<string, NodeViewModel>();

    for (const n of definition.nodes) {
      const toolKey = n.impl;
      m.set(n.id, {
        graphNodeId: n.id,
        toolKey,
        visualType: resolveNodeType(toolKey),
        family: resolveToolFamily(toolKey),
        copy: resolveNodeCopy(toolKey),
        // status intentionally omitted until run-data wiring lands
      });
    }

    m.set("__start__", {
      graphNodeId: "__start__",
      toolKey: "__start__",
      visualType: "start",
      family: "none",
      copy: startNodeCopy(triggerEventType),
    });
    m.set("__end__", {
      graphNodeId: "__end__",
      toolKey: "__end__",
      visualType: "end",
      family: "none",
      copy: resolveNodeCopy("__end__"),
    });

    return m;
  }, [definition, triggerEventType]);

  useEffect(() => {
    openNodeIdRef.current = openNodeId;
  }, [openNodeId]);

  useEffect(() => {
    ensureMermaidInit();
    const el = containerRef.current;
    if (!el) return;

    setOpenNodeId(null);

    let cancelled = false;
    const source = graphToMermaid(definition, mermaidOptions);

    let cleanupNodeListeners: (() => void) | null = null;

    void (async () => {
      try {
        setError(null);
        // Wait for webfonts so Mermaid measures label boxes with the real font —
        // otherwise the fallback font undersizes the box and clips the last glyph.
        if (typeof document !== "undefined" && document.fonts?.ready) {
          await document.fonts.ready;
        }
        const { svg } = await mermaid.render(`workflow-${renderId}`, source);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;

        const svgEl = containerRef.current.querySelector("svg");
        if (!svgEl) return;

        applyEdgeLabelTones(svgEl);
        expandSvgToFitEdgeLabels(svgEl);

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
            return;
          }

          const active = document.activeElement as Element | null;
          if (active?.getAttribute?.("data-testid") === "workflow-mermaid-node") {
            lastFocusedNodeRef.current = active as HTMLElement;
          } else {
            lastFocusedNodeRef.current = nodeEl;
          }
          setOpenNodeId(graphNodeId);
        };

        // Overlays live inside the scroll container (absolute, not fixed) so they
        // move with the SVG on scroll and don't intercept the wrong nodes.
        const host = containerRef.current;
        const hostStyle = getComputedStyle(host);
        if (hostStyle.position === "static") {
          host.style.position = "relative";
        }

        type OverlayPair = { nodeEl: SVGGElement; overlay: HTMLButtonElement };
        const pairs: OverlayPair[] = [];

        const syncOverlay = (pair: OverlayPair) => {
          const nodeRect = pair.nodeEl.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          pair.overlay.style.left = `${
            nodeRect.left - hostRect.left + host.scrollLeft
          }px`;
          pair.overlay.style.top = `${
            nodeRect.top - hostRect.top + host.scrollTop
          }px`;
          pair.overlay.style.width = `${Math.max(nodeRect.width, 1)}px`;
          pair.overlay.style.height = `${Math.max(nodeRect.height, 1)}px`;
        };

        for (const nodeEl of nodeEls) {
          const graphNodeId = graphNodeIdByEl.get(nodeEl);
          if (!graphNodeId) continue;

          const onClick = () => openOrToggle(graphNodeId, nodeEl);

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
          overlay.style.position = "absolute";
          overlay.style.background = "transparent";
          overlay.style.border = "none";
          overlay.style.padding = "0";
          overlay.style.margin = "0";
          overlay.style.cursor = "pointer";
          overlay.style.zIndex = "2";
          overlay.style.color = "transparent";
          overlay.style.fontSize = "0px";
          host.appendChild(overlay);
          pairs.push({ nodeEl, overlay });
          syncOverlay({ nodeEl, overlay });
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

        const resyncAll = () => {
          for (const pair of pairs) syncOverlay(pair);
        };
        overlayResyncRef.current = resyncAll;
        // After FO widen / style paint, remeasure once.
        requestAnimationFrame(resyncAll);
        host.addEventListener("scroll", resyncAll, { passive: true });
        window.addEventListener("resize", resyncAll);
        const ro =
          typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => resyncAll())
            : null;
        ro?.observe(host);
        cleanupFns.push(() => {
          host.removeEventListener("scroll", resyncAll);
          window.removeEventListener("resize", resyncAll);
          ro?.disconnect();
          if (overlayResyncRef.current === resyncAll) {
            overlayResyncRef.current = null;
          }
        });

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

  const closePanel = () => {
    setOpenNodeId(null);
    requestAnimationFrame(() => {
      lastFocusedNodeRef.current?.focus?.();
    });
  };

  // Highlight the selected graph node while the side panel is open.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    for (const nodeEl of root.querySelectorAll("g.node")) {
      const gid = nodeEl.getAttribute("data-graph-node-id");
      if (openNodeId && gid === openNodeId) {
        nodeEl.setAttribute("data-selected", "true");
      } else {
        nodeEl.removeAttribute("data-selected");
      }
    }
    // Graph width changes when the panel opens — remeasure hit overlays.
    requestAnimationFrame(() => overlayResyncRef.current?.());
  }, [openNodeId]);

  useLayoutEffect(() => {
    if (!openNodeId) return;
    panelCloseButtonRef.current?.focus();
  }, [openNodeId]);

  useEffect(() => {
    if (!openNodeId) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel();
      }
    }

    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      const node = target.closest?.("g.node");
      const nodeBtn = target.closest?.('[data-testid="workflow-mermaid-node"]');
      if (node || nodeBtn) return;
      closePanel();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [openNodeId]);

  return (
    <div
      className="workflow-canvas workflow-canvas--mermaid"
      style={{
        background: "var(--slate-50)",
        borderRadius: 14,
        boxShadow: "var(--shadow-popover)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "var(--white-alpha-94)",
          borderBottom: "1px solid var(--slate-210)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              color: "var(--slate-500)",
              letterSpacing: "0.14em",
            }}
          >
            WORKFLOW
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "var(--slate-900)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {title ?? "Workflow"}
          </span>
          {triggerEventType ? (
            <span
              style={{
                fontSize: 12,
                color: "var(--slate-500)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={friendlyEventLabel(triggerEventType)}
            >
              Click Start to see when this runs · {friendlyEventLabel(triggerEventType)}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: "var(--slate-400)" }}>
              Click any step — including Start — for plain-English details
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {isLive ? <span className="workflow-live-badge">Live</span> : null}
          <MermaidLegend />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          height: "min(80vh, 840px)",
          alignItems: "stretch",
        }}
      >
        <div
          data-testid="workflow-mermaid"
          ref={containerRef}
          className="workflow-mermaid"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 560,
            height: "100%",
            padding: "24px 28px",
            overflow: "auto",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
          }}
        />

        {openDetails ? (
          <NodeDetailPanel
            details={openDetails}
            panelRef={panelRef}
            closeButtonRef={panelCloseButtonRef}
            onClose={closePanel}
          />
        ) : null}
      </div>

      {error ? (
        <p className="muted" style={{ padding: "8px 16px", color: "var(--warning-strong-canvas)" }} role="alert">
          Mermaid render failed: {error}
        </p>
      ) : null}

      {version != null ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--slate-400)",
            padding: "5px 14px",
            borderTop: "1px solid var(--slate-210)",
            textAlign: "right",
            background: "var(--neutral-0)",
            flexShrink: 0,
          }}
        >
          version {version}
        </div>
      ) : null}
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
        color: "var(--slate-500)",
        flexShrink: 0,
      }}
    >
      <LegendChip shape="circle" bg="var(--slate-950)" border="transparent" label="Start / End" />
      <LegendChip shape="square" bg="var(--neutral-0)" border="var(--green-600)" label="SYNTRA" />
      <LegendChip shape="square" bg="var(--neutral-0)" border="var(--info-fg-canvas)" label="ASTRA" />
      <LegendChip shape="square" bg="var(--warning-bg-canvas)" border="var(--warning-accent-canvas)" label="Needs a person" />
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

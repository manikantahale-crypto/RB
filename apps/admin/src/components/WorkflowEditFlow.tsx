import { useCallback, useMemo, useRef } from "react";
import "@xyflow/react/dist/style.css";
import {
  Background,
  ConnectionLineType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import dagre from "dagre";
import { getToolCatalog } from "@tekisho/authoring/src/tool-registry.js";
import type { WorkflowStep } from "../lib/workflow-steps.js";
import { token } from "../lib/tokens.js";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 56;

const dagreGraph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));

function toolLabel(impl: string): string {
  const tool = getToolCatalog().find((t) => t.key === impl);
  if (!tool) return impl;
  return tool.description.split(":")[0]?.trim() || impl;
}

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({ rankdir: direction, nodesep: 48, ranksep: 64 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const pos = dagreGraph.node(node.id);
    return {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function StepNode({ data }: { data: { label: string; index: number } }) {
  return (
    <div
      data-testid="workflow-edit-node"
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        boxSizing: "border-box",
        background: "var(--neutral-0)",
        border: "1.5px solid var(--slate-220)",
        borderRadius: 10,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        boxShadow: "var(--shadow-card)",
        fontSize: 13,
        fontWeight: 600,
        color: "var(--slate-900)",
      }}
    >
      <span style={{ fontSize: 10, color: "var(--slate-400)", fontWeight: 700 }}>
        Step {String(data.index).padStart(2, "0")}
      </span>
      <span style={{ lineHeight: 1.3 }}>{data.label}</span>
    </div>
  );
}

const nodeTypes = { step: StepNode };

type WorkflowEditFlowProps = {
  steps: WorkflowStep[];
  version?: number | null;
};

export function WorkflowEditFlow({ steps, version }: WorkflowEditFlowProps) {
  const fittedRef = useRef(false);

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = steps.map((step, index) => ({
      id: step.id,
      type: "step",
      data: { label: toolLabel(step.impl), index: index + 1 },
      position: { x: 0, y: 0 },
    }));

    const rawEdges: Edge[] = [];
    for (let i = 0; i < steps.length - 1; i++) {
      rawEdges.push({
        id: `e-${steps[i]!.id}-${steps[i + 1]!.id}`,
        source: steps[i]!.id,
        target: steps[i + 1]!.id,
        type: "smoothstep",
        animated: false,
      });
    }

    return getLayoutedElements(rawNodes, rawEdges);
  }, [steps]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    requestAnimationFrame(() => {
      instance.fitView({ padding: 0.2 });
    });
  }, []);

  return (
    <div
      className="workflow-canvas workflow-canvas--edit-flow"
      data-testid="workflow-edit-flow"
      style={{
        background: "var(--slate-50)",
        borderRadius: 14,
        border: "1px solid var(--line)",
        overflow: "hidden",
      }}
    >
      <div className="workflow-canvas-head" style={{ padding: "10px 16px" }}>
        <span className="workflow-canvas-title">Edit workflow steps</span>
        {version != null ? (
          <span className="muted workflow-canvas-version">v{version}</span>
        ) : null}
      </div>
      <div style={{ width: "100%", height: 480 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={onInit}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnScroll={false}
          connectionLineType={ConnectionLineType.SmoothStep}
          proOptions={{ hideAttribution: true }}
        >
          {/* Resolved, not `var(...)`: this becomes an SVG presentation
              attribute, where custom properties are not reliably supported. */}
          <Background gap={20} size={0.6} color={token("--slate-230", "#e8edf2")} />
        </ReactFlow>
      </div>
      <p className="muted" style={{ padding: "8px 16px 12px", fontSize: 12, margin: 0 }}>
        Use the step editor controls to change tools and order.
      </p>
    </div>
  );
}

"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, RefAttributes } from "react";
import { useMemo, useRef, useState } from "react";
import {
  LocateFixedIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  MinusIcon,
  NetworkIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import type { Node, NVL, Relationship } from "@neo4j-nvl/base";
import type { InteractiveNvlWrapperProps } from "@neo4j-nvl/react";
import {
  PanInteraction,
  ZoomInteraction,
} from "@neo4j-nvl/interaction-handlers";

import { Button } from "@/components/ui/button";
import { ErrorMessage } from "@/components/graph/feedback";
import type { GraphVisualization } from "@/components/graph/types";
import type { GraphVisualizationStore } from "@/components/graph/use-graph-visualization";
import { cn } from "@/lib/utils";

type NvlWrapperProps = InteractiveNvlWrapperProps &
  Omit<ComponentProps<"div">, "ref"> &
  RefAttributes<NVL>;

const InteractiveNvlWrapper = dynamic<NvlWrapperProps>(
  () => import("@neo4j-nvl/react").then((mod) => mod.InteractiveNvlWrapper),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[32rem] items-center justify-center text-sm text-muted-foreground">
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        Loading graph renderer...
      </div>
    ),
  },
);

function buildNvlGraph(graph: GraphVisualization | null): {
  nodes: Node[];
  relationships: Relationship[];
} {
  if (!graph) return { nodes: [], relationships: [] };

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      caption: node.label,
      color:
        node.type === "application"
          ? "#111827"
          : node.type === "suggestion"
            ? "#d97706"
            : node.type === "dataset"
              ? "#0891b2"
              : node.type === "schema"
                ? "#0d9488"
                : node.type === "table"
                  ? "#2563eb"
                  : node.type === "reference"
                    ? "#7c3aed"
                    : node.type === "chunk"
                      ? "#9333ea"
                      : "#64748b",
      size:
        node.type === "application"
          ? 56
          : node.type === "suggestion"
            ? 30
            : node.type === "dataset"
              ? 52
              : node.type === "schema"
                ? 46
                : node.type === "table"
                  ? 44
                  : node.type === "reference"
                    ? 32
                    : 24,
    })),
    relationships: graph.edges.map((edge) => ({
      id: edge.id,
      from: edge.source,
      to: edge.target,
      caption: edge.label,
      type: edge.label,
      color: edge.label.startsWith("JOINS_ON") ? "#16a34a" : "#94a3b8",
      width: edge.label.startsWith("JOINS_ON") ? 2.5 : 1.5,
    })),
  };
}

export function VisualizationTab({
  visualization,
}: {
  visualization: GraphVisualizationStore;
}) {
  return (
    <section className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Graph Visualization</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tables, columns, and relationships currently stored in the graph.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void visualization.reload()}
          disabled={visualization.loading}
        >
          {visualization.loading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <RotateCcwIcon className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      <ErrorMessage message={visualization.error} />

      <GraphVisualizationPanel
        graph={visualization.graph}
        loading={visualization.loading}
      />
    </section>
  );
}

function GraphVisualizationPanel({
  graph,
  loading,
}: {
  graph: GraphVisualization | null;
  loading: boolean;
}) {
  const nvlRef = useRef<NVL | null>(null);
  const panInteractionRef = useRef<PanInteraction | null>(null);
  const zoomInteractionRef = useRef<ZoomInteraction | null>(null);
  const [expanded, setExpanded] = useState(false);
  const nvlGraph = useMemo(() => buildNvlGraph(graph), [graph]);
  const countByType = (type: GraphVisualization["nodes"][number]["type"]) =>
    graph?.nodes.filter((node) => node.type === type).length ?? 0;
  const graphHeight = expanded ? "h-[calc(100dvh-13rem)]" : "h-[32rem]";

  const fitGraph = () => {
    nvlRef.current?.fit(nvlGraph.nodes.map((node) => node.id));
  };

  const enableMouseNavigation = () => {
    const nvl = nvlRef.current;
    if (!nvl) return;

    panInteractionRef.current?.destroy();
    zoomInteractionRef.current?.destroy();

    const panInteraction = new PanInteraction(nvl);
    panInteraction.updateTargets([], true);
    const zoomInteraction = new ZoomInteraction(nvl);

    panInteractionRef.current = panInteraction;
    zoomInteractionRef.current = zoomInteraction;
  };

  const zoomGraph = (direction: "in" | "out") => {
    const nvl = nvlRef.current;
    if (!nvl) return;

    const nextZoom =
      direction === "in" ? nvl.getScale() * 1.25 : nvl.getScale() / 1.25;
    nvl.setZoom(nextZoom);
  };

  if (loading && !graph) {
    return (
      <div className="flex min-h-[28rem] items-center justify-center rounded-md border text-sm text-muted-foreground">
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        Loading graph visualization...
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex min-h-[28rem] flex-col items-center justify-center gap-2 rounded-md border text-sm text-muted-foreground">
        <NetworkIcon className="size-5" />
        No graph data found.
      </div>
    );
  }

  return (
    <div className="flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-md border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <NetworkIcon className="size-4" />
          {countByType("dataset")} datasets
          <span className="text-muted-foreground">/</span>
          {countByType("schema")} schemas
          <span className="text-muted-foreground">/</span>
          {countByType("table")} tables
          <span className="text-muted-foreground">/</span>
          {countByType("column")} columns
          <span className="text-muted-foreground">/</span>
          {countByType("reference")} references
          <span className="text-muted-foreground">/</span>
          {countByType("chunk")} chunks
          <span className="text-muted-foreground">/</span>
          {countByType("suggestion")} suggestions
        </div>
        <div className="text-xs text-muted-foreground">
          {graph.edges.length} relationships
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => zoomGraph("out")}
            title="Zoom out"
          >
            <MinusIcon className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => zoomGraph("in")}
            title="Zoom in"
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={fitGraph}>
            <LocateFixedIcon className="size-4" />
            Fit
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => nvlRef.current?.resetZoom()}
          >
            <RotateCcwIcon className="size-4" />
            Reset
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
            {expanded ? "Compact" : "Expand"}
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "min-h-[32rem] flex-1 cursor-grab bg-muted/10 active:cursor-grabbing",
          graphHeight,
        )}
      >
        <InteractiveNvlWrapper
          ref={nvlRef}
          className="h-full w-full"
          nodes={nvlGraph.nodes}
          rels={nvlGraph.relationships}
          layout="forceDirected"
          nvlCallbacks={{
            onInitialization: enableMouseNavigation,
            onLayoutDone: fitGraph,
          }}
          nvlOptions={{
            initialZoom: 0.75,
            minZoom: 0.05,
            maxZoom: 4,
          }}
        />
      </div>
    </div>
  );
}

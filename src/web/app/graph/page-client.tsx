"use client";

import { useState } from "react";

import { DatasetsTab } from "@/components/graph/datasets-tab";
import { JoinsTab } from "@/components/graph/joins-tab";
import { ReferencesTab } from "@/components/graph/references-tab";
import { SuggestionsTab } from "@/components/graph/suggestions-tab";
import { GRAPH_TABS, type GraphTab } from "@/components/graph/types";
import { useGraphVisualization } from "@/components/graph/use-graph-visualization";
import { useSchemaTables } from "@/components/graph/use-schema-tables";
import { VisualizationTab } from "@/components/graph/visualization-tab";
import { cn } from "@/lib/utils";

export function GraphPageClient() {
  const [activeTab, setActiveTab] = useState<GraphTab>("Datasets");
  const schema = useSchemaTables();
  const visualization = useGraphVisualization(
    activeTab === "Graph Visualization",
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b px-5">
          <div className="flex h-11 items-end gap-1">
            {GRAPH_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "h-10 border-b-2 px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent",
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {activeTab === "Datasets" ? (
          <DatasetsTab
            schema={schema}
            onGraphChanged={visualization.invalidate}
          />
        ) : activeTab === "Joins" ? (
          <JoinsTab schema={schema} onGraphChanged={visualization.invalidate} />
        ) : activeTab === "References" ? (
          <ReferencesTab
            schema={schema}
            onGraphChanged={visualization.invalidate}
          />
        ) : activeTab === "Suggestions" ? (
          <SuggestionsTab onGraphChanged={visualization.invalidate} />
        ) : activeTab === "Graph Visualization" ? (
          <VisualizationTab visualization={visualization} />
        ) : null}
      </div>
    </main>
  );
}

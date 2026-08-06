"use client";

import type { ModelOption } from "@/lib/ai/model";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

type ModelContextValue = {
  model: string | null;
  models: ModelOption[];
  setModel: (model: string) => void;
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    const loadModel = async () => {
      try {
        const response = await fetch("/api/model", {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load model: ${response.status}`);
        }

        const data: { model?: string; models?: ModelOption[] } =
          await response.json();
        setModel(data.model ?? null);
        setModels(data.models ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setModel(null);
          setModels([]);
        }
      }
    };

    void loadModel();

    return () => {
      controller.abort();
    };
  }, []);

  return (
    <ModelContext.Provider value={{ model, models, setModel }}>
      {children}
    </ModelContext.Provider>
  );
}

export function useModel() {
  const context = useContext(ModelContext);

  if (!context) {
    throw new Error("useModel must be used within a ModelProvider");
  }

  return context;
}

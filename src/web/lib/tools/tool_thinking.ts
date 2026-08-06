import { tool } from "ai";
import { z } from "zod";

export const tool_thinking = () =>
  tool({
      description:
        "Tool for strategic planning on data analysis and decision-making.",
      inputSchema: z.object({
        reflection: z
          .string()
          .describe(
            "Your brief step-by-step data analysis strategy in the language of the user input.",
          ),
      }),
      execute: async (reflection) => {
        const REFLECTION = `Reflection recorded \`${reflection}\``;
        return REFLECTION;
      },
    });
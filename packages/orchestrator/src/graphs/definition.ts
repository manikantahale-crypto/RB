import { z } from 'zod';

/** Graph definition JSON shape stored in graph_definitions.definition (design §5.1). */
export const GraphDefinitionSchema = z.object({
  graphKey: z.string().min(1),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      impl: z.string().min(1),
      config: z.record(z.string(), z.unknown()).optional(),
    })
  ).min(1),
  edges: z.array(z.tuple([z.string(), z.string()])).min(1),
  conditionalEdges: z
    .array(
      z.object({
        from: z.string(),
        router: z.string(),
        map: z.record(z.string(), z.string()),
      })
    )
    .optional(),
});

export type GraphDefinition = z.infer<typeof GraphDefinitionSchema>;

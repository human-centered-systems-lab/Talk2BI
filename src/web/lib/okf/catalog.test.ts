import { describe, expect, test } from "bun:test";

import {
  buildWarehouseBundle,
  getAppMetadata,
  mergeWarehouseDescription,
} from "@/lib/okf/catalog";

describe("warehouse comments in OKF", () => {
  test("renders imported table and column comments", () => {
    const bundle = buildWarehouseBundle({
      database: "main",
      dialect: "Databricks",
      tables: [
        {
          database: "main",
          schema: "sales",
          name: "orders",
          description: "One row per order",
        },
      ],
      columns: [
        {
          database: "main",
          schema: "sales",
          name: "orders",
          column: "customer_id",
          dataType: "BIGINT",
          ordinalPosition: 1,
          description: "Customer foreign key",
        },
      ],
      joins: [],
      quoteIdentifier: (identifier) => `\`${identifier}\``,
    });
    const table = bundle.concepts[0]!;
    const metadata = getAppMetadata(table);

    expect(table.description).toBe("One row per order");
    expect(table.body).toContain(
      "| `customer_id` | BIGINT | NULLABLE | Customer foreign key |",
    );
    expect(metadata?.kind === "table" && metadata.sourceDescription).toBe(
      "One row per order",
    );
    expect(
      metadata?.kind === "table" && metadata.columns[0]?.sourceDescription,
    ).toBe("Customer foreign key");
  });

  test("refreshes source comments without overwriting manual edits", () => {
    expect(mergeWarehouseDescription("New", "Old", "Old")).toBe("New");
    expect(mergeWarehouseDescription("New", "Manual", "Old")).toBe("Manual");
    expect(mergeWarehouseDescription("New", "")).toBe("New");
    expect(mergeWarehouseDescription("New", "Legacy manual")).toBe(
      "Legacy manual",
    );
  });
});

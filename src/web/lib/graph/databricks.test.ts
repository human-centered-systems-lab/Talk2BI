import { describe, expect, test } from "bun:test";

import {
  databricksColumnFromRow,
  databricksTableFromRow,
} from "@/lib/graph/databricks";

describe("Databricks metadata rows", () => {
  test("maps table comments to descriptions", () => {
    expect(
      databricksTableFromRow("main", {
        table_schema: "sales",
        table_name: "orders",
        table_comment: "One row per order",
      }),
    ).toEqual({
      database: "main",
      schema: "sales",
      name: "orders",
      description: "One row per order",
    });
  });

  test("maps column comments to descriptions", () => {
    expect(
      databricksColumnFromRow("main", {
        table_catalog: "main",
        table_schema: "sales",
        table_name: "orders",
        column_name: "customer_id",
        full_data_type: "BIGINT",
        ordinal_position: 1,
        column_comment: "Customer foreign key",
      }),
    ).toEqual({
      database: "main",
      schema: "sales",
      name: "orders",
      column: "customer_id",
      dataType: "BIGINT",
      ordinalPosition: 1,
      description: "Customer foreign key",
    });
  });
});

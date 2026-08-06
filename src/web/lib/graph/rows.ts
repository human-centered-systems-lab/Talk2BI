// Warehouse drivers disagree on result-column casing: Snowflake returns
// upper-case keys, Databricks lower-case ones. These readers accept either.

export function readString(row: Record<string, unknown>, key: string) {
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  return typeof value === "string" ? value : "";
}

export function readNumber(row: Record<string, unknown>, key: string) {
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
}

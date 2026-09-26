type CsvCell = string | number | boolean | null | undefined;

type CsvRow = Record<string, CsvCell>;

const FORMULA_PREFIX_PATTERN = /^[=+\-@\t\r]/;

function escapeCsvCell(value: CsvCell): string {
  let text = value == null ? "" : String(value);

  if (FORMULA_PREFIX_PATTERN.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

function csvHeaders(rows: CsvRow[]): string[] {
  const seen = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => seen.add(key));
  });
  return Array.from(seen);
}

export function downloadCsv(filename: string, rows: CsvRow[]): void {
  const headers = csvHeaders(rows);
  const lines = [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Code2, Table2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TableDiagnostics {
  data_row_count: number;
  blank_rows: number;
  sparse_rows: number;
  possible_multi_table: boolean;
}

interface ExtractedTable {
  table_id: string;
  ordinal: number;
  /** Which sentinel this came from, and which slice of it — several logical
   * tables can be recovered from one fused grid. */
  source_ordinal: number;
  source_part: number;
  source_part_count: number;
  caption: string | null;
  page: number | null;
  section_path: string | null;
  rows: number;
  cols: number;
  body: string;
  /** Stable across documents — the key a later revision of this schedule hashes to. */
  signature: string;
  table_type: string | null;
  classification_confidence: number | null;
  /** "user" once someone has corrected the label; re-runs then leave it alone. */
  classification_source?: string | null;
  trackable?: boolean | null;
  diagnostics: TableDiagnostics;
}

interface ContractTables {
  contract_id: string;
  contract_name: string;
  table_count: number;
  tables: ExtractedTable[];
}

interface TablesResponse {
  contracts: ContractTables[];
  categories: string[];
  totals: {
    contracts_with_tables: number;
    table_count: number;
    row_count: number;
  };
}

/** Split a pipe row into cells without collapsing empty ones — an empty cell is
 * signal here, not noise. */
function splitCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseTable(body: string): { header: string[]; rows: string[][] } {
  const lines = body.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { header: [], rows: [] };
  const header = splitCells(lines[0]);
  // Line 2 is the markdown delimiter row; it carries no data.
  const rows = lines.slice(2).map((line) => {
    const cells = splitCells(line);
    while (cells.length < header.length) cells.push("");
    return cells;
  });
  return { header, rows };
}

function TablePreview({
  table,
  categories,
  onReclassify,
}: {
  table: ExtractedTable;
  categories: string[];
  onReclassify: (signature: string, tableType: string) => Promise<void>;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { header, rows } = useMemo(() => parseTable(table.body), [table.body]);
  const { diagnostics } = table;

  const handleChange = async (value: string) => {
    if (!value || value === table.table_type) return;
    setIsSaving(true);
    await onReclassify(table.signature, value);
    setIsSaving(false);
  };

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/30 px-2.5 py-2">
        <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11px] font-medium text-foreground">
          {table.caption || table.table_id}
        </span>
        {table.page !== null && (
          <span className="text-[10px] text-muted-foreground">p.{table.page}</span>
        )}
        {table.source_part_count > 1 && (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
            title="Recovered from a grid the parser had fused into one table"
          >
            split {table.source_part}/{table.source_part_count}
          </Badge>
        )}
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-normal">
          {table.rows}×{table.cols}
        </Badge>
        <select
          value={table.table_type || ""}
          disabled={isSaving}
          onChange={(event) => handleChange(event.target.value)}
          title={
            table.classification_source === "user"
              ? "Set by hand — automatic runs will not change it"
              : table.classification_confidence != null
                ? `Suggested automatically (confidence ${table.classification_confidence})`
                : "Not classified yet"
          }
          className={[
            "h-5 max-w-[13rem] truncate rounded border bg-transparent px-1 text-[10px] outline-none",
            "focus:ring-1 focus:ring-ring disabled:opacity-50",
            table.table_type ? "border-border text-foreground" : "border-dashed border-border text-muted-foreground",
          ].join(" ")}
        >
          <option value="">Unclassified</option>
          {categories.map((category) => (
            <option key={category} value={category}>{category}</option>
          ))}
        </select>
        {table.classification_source === "user" && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal" title="Corrected by a person">
            edited
          </Badge>
        )}
        {table.trackable && (
          <Badge
            variant="outline"
            className="h-4 px-1 text-[10px] font-normal text-muted-foreground"
            title="Values are expected to change between contract revisions, so this table can be tracked over time"
          >
            trackable
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          title={showRaw ? "Show rendered table" : "Show raw markdown"}
          onClick={() => setShowRaw((current) => !current)}
        >
          <Code2 className="h-3 w-3" />
        </Button>
      </div>

      {table.section_path && (
        <p className="truncate border-b border-border/50 px-2.5 py-1 text-[10px] text-muted-foreground">
          {table.section_path}
        </p>
      )}

      {diagnostics.possible_multi_table && (
        <div className="flex items-start gap-1.5 border-b border-border/50 bg-amber-500/5 px-2.5 py-1.5">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-amber-600" />
          <p className="text-[10px] text-muted-foreground">
            {diagnostics.blank_rows > 0 && `${diagnostics.blank_rows} blank row${diagnostics.blank_rows === 1 ? "" : "s"}`}
            {diagnostics.blank_rows > 0 && diagnostics.sparse_rows > 0 && ", "}
            {diagnostics.sparse_rows > 0 && `${diagnostics.sparse_rows} mostly-empty row${diagnostics.sparse_rows === 1 ? "" : "s"}`}
            {" — may be several tables merged into one, or a ragged parse."}
          </p>
        </div>
      )}

      {showRaw ? (
        <pre className="max-h-64 overflow-auto whitespace-pre p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {table.body}
        </pre>
      ) : (
        <div className="max-h-64 overflow-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead className="sticky top-0 bg-card">
              <tr>
                {header.map((cell, index) => (
                  <th
                    key={index}
                    className="border-b border-border px-2 py-1 text-left font-medium text-foreground"
                  >
                    {cell || <span className="text-muted-foreground/40">—</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((cells, rowIndex) => {
                const filled = cells.filter((cell) => cell).length;
                const isBlank = filled === 0;
                const isSparse = !isBlank && filled * 2 <= cells.length;
                return (
                  <tr
                    key={rowIndex}
                    className={[
                      "border-b border-border/40 last:border-0",
                      isBlank ? "bg-destructive/5" : isSparse ? "bg-amber-500/5" : "",
                    ].join(" ")}
                  >
                    {cells.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-2 py-1 align-top text-muted-foreground">
                        {cell || <span className="text-muted-foreground/30">·</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ProjectTablesTab({ projectId }: { projectId: string }) {
  const { isAuthenticated, authenticatedFetch } = useAuth();
  const apiUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;

  const [data, setData] = useState<TablesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTables = useCallback(async () => {
    if (!isAuthenticated || !apiUrl || !projectId) return;
    setIsLoading(true);
    const { data: payload } = await authenticatedFetch(`${apiUrl}/projects/${projectId}/tables`);
    if (payload) setData(payload as TablesResponse);
    setIsLoading(false);
  }, [isAuthenticated, apiUrl, projectId, authenticatedFetch]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  const reclassify = useCallback(
    async (contractId: string, signature: string, tableType: string) => {
      if (!apiUrl) return;
      const { error } = await authenticatedFetch(
        `${apiUrl}/projects/${projectId}/tables/${signature}/classification`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contract_id: contractId, table_type: tableType }),
        },
      );
      if (error) return;
      // Reflect the correction locally rather than refetching — the label is
      // the only thing that changed, and a refetch would re-render every table.
      setData((current) => current && {
        ...current,
        contracts: current.contracts.map((contract) =>
          contract.contract_id !== contractId ? contract : {
            ...contract,
            tables: contract.tables.map((table) =>
              table.signature !== signature ? table : {
                ...table,
                table_type: tableType,
                classification_source: "user",
                classification_confidence: 1,
              },
            ),
          },
        ),
      });
    },
    [apiUrl, projectId, authenticatedFetch],
  );

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;

  const totals = data?.totals;
  if (!totals || totals.table_count === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No tables found. Tables are detected during ingestion, so documents indexed before table
        extraction was added will not show any here until they are re-ingested.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-muted-foreground">
        {totals.table_count} table{totals.table_count === 1 ? "" : "s"} across{" "}
        {totals.contracts_with_tables} document{totals.contracts_with_tables === 1 ? "" : "s"} ·{" "}
        {totals.row_count} rows. Shown exactly as extracted, including empty rows.
      </p>

      <div className="flex max-h-[520px] flex-col gap-4 overflow-y-auto">
        {data!.contracts.map((contract) => (
          <div key={contract.contract_id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="truncate text-xs font-medium text-foreground">
                {contract.contract_name}
              </span>
              <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">
                {contract.table_count}
              </Badge>
            </div>
            {contract.tables.map((table) => (
              <TablePreview
                key={`${contract.contract_id}-${table.ordinal}`}
                table={table}
                categories={data!.categories || []}
                onReclassify={(signature, tableType) =>
                  reclassify(contract.contract_id, signature, tableType)
                }
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

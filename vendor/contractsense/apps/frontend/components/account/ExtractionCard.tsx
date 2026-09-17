"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export interface CatalogParser {
  id: string;
  label: string;
  description: string;
  /** Whether this engine is usable on the server. Never a key value. */
  configured: boolean;
}

/** Which engine turns an uploaded PDF into text. Split out of the page body so
 * it can be rendered and checked on its own. */
export function ExtractionCard({
  parsers,
  defaultParser,
  selected,
  isReadOnly,
  onSelect,
}: {
  parsers: CatalogParser[];
  defaultParser: string;
  selected?: string;
  isReadOnly: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Text extraction</CardTitle>
        <CardDescription>
          How an uploaded PDF is turned into text and tables. Applies to documents ingested from
          now on — already-indexed documents keep the text they were parsed with until re-uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {parsers.map((parser) => {
          const isActive = (selected || defaultParser) === parser.id;
          const disabled = !parser.configured || isReadOnly;
          return (
            <button
              key={parser.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(parser.id)}
              className={[
                "rounded-lg border p-3 text-left text-sm transition-colors",
                isActive ? "border-primary bg-primary/5" : "border-border",
                disabled ? "cursor-not-allowed opacity-50" : "hover:border-primary/60",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{parser.label}</span>
                {parser.id === defaultParser && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    Default
                  </Badge>
                )}
                {!parser.configured && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    No key
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{parser.description}</p>
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

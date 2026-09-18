import React from "react";

interface VarianceComparisonProps {
  expected: string;
  actual: string;
}

export function VarianceComparison({ expected, actual }: VarianceComparisonProps) {
  return (
    <div className="grid grid-cols-[1fr_1px_1fr] bg-surface-50 border border-surface-200 rounded-[10px] p-[14px_20px] mb-[16px]">
      <div className="pr-4 pl-0 py-0.5">
        <div className="text-[12px] font-semibold text-fg-500 mb-1.5">
          Expected (contract)
        </div>
        <div className="text-[16px] font-semibold leading-[1.2] text-fg-950">
          {expected}
        </div>
      </div>
      <div className="bg-surface-200" />
      <div className="pl-4 pr-0 py-0.5">
        <div className="text-[12px] font-semibold text-fg-500 mb-1.5">
          Actual (ingested)
        </div>
        <div className="flex items-center gap-[7px] text-[16px] font-semibold leading-[1.2] text-fg-950">
          <span className="w-[7px] h-[7px] rounded-full bg-risk-600 shrink-0" />
          {actual}
        </div>
      </div>
    </div>
  );
}

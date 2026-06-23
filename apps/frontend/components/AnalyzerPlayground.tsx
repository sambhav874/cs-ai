"use client";

import { useState, useRef } from "react";
import { Play, Brain, Terminal, Layers, Shield } from "lucide-react";
import { cn } from "@/lib/utils";

const contractData = [
  {
    category: "IFRS 15",
    question: "What is the revenue recognition method prescribed by the contract?",
    answer: "The contract prescribes revenue recognition over time using the cost-to-cost input method. Progress is determined based on costs incurred relative to total estimated costs.",
    confidence: "high",
    citation: "9.2. Measurement of Progress. Given that control transfers over time, revenue shall be recognized over the construction period...",
    reason: "Paragraph 95.2 explicitly states the use of the 'cost-to-cost method' for progress measurement.",
    page: 1,
    refId: "9.2"
  },
  {
    category: "Payment Terms",
    question: "What are the stated payment terms and advance payment requirements?",
    answer: "Milestone-based payment terms with a 20% Advance Payment (USD $150M) due upon the Effective Date to fund initial mobilization.",
    confidence: "high",
    citation: "7.3. Liquidated Damages for Delay... An Advance Payment representing twenty percent (20%) of the total Contract Price...",
    reason: "Article 15 and Exhibit B detail the milestone schedule and the mandatory 20% upfront component.",
    page: 3,
    refId: "7.3"
  },
  {
    category: "Performance Obligations",
    question: "Are the obligations distinct or integrated for financial reporting?",
    answer: "The obligations are described as a single, integrated performance obligation because the design, procurement, and construction phases are highly interdependent.",
    confidence: "high",
    citation: "3.3.2. The individual goods and services are highly interdependent... the Parties agree that this Agreement comprises a single, integrated Performance Obligation.",
    reason: "Section 3.3.3 stipulates that the contractor provides a significant integration service that creates a unified functional asset.",
    page: 2,
    refId: "3.3.2"
  }
];

export function AnalyzerPlayground() {
  const [activeCriterion, setActiveCriterion] = useState("IFRS 15");
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  return (
    <section className="py-24 md:py-48 bg-background border-y border-foreground/10" id="interactive">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="flex flex-col md:flex-row justify-between items-end mb-24 gap-8 reveal">
          <div className="max-w-[600px]">
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary mb-8 block">Interactive Playground</span>
            <h2 className="text-[48px] md:text-[80px] font-light leading-[0.9] tracking-tighter">
              The <i className="text-primary">Analyzer</i>
            </h2>
          </div>
          <p className="text-[13px] text-muted-foreground uppercase tracking-[0.2em] max-w-[300px] leading-relaxed">
            Click a citation in the analysis to reveal its ground truth in the document.
          </p>
        </div>

        <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 lg:p-12 overflow-y-auto lg:overflow-visible">
          {/* Document Section */}
          <div className={cn(
            "bg-background/95 backdrop-blur-sm shadow-2xl p-6 lg:p-12 flex flex-col border border-foreground/10",
            "h-[400px] lg:h-auto"
          )}>
            <div className="flex justify-between items-center mb-6 px-2">
              <div className="flex gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400/20" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/20" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400/20" />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.2em]">Infrastructure_Agreement_v4.pdf</span>
              <span className="text-[9px] font-mono text-muted-foreground uppercase">Page 1 of 5</span>
            </div>

            <div className="flex-1 bg-muted/20 border border-foreground/10 shadow-2xl overflow-hidden relative group">
              <div className="absolute inset-0 overflow-y-auto py-16 px-12 md:px-20 space-y-24 scroll-smooth" ref={pdfContainerRef} style={{ scrollbarWidth: "none" }}>
                {/* Page 1 */}
                <div id="page-1" className="relative pb-24 border-b border-foreground/5">
                  <span className="absolute -left-8 top-0 text-[10px] font-mono text-muted-foreground/50">01</span>
                  <h4 className="font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-foreground pb-4">Article 9: Financial Provisions</h4>
                  <p className="text-[15px] leading-[1.8] text-foreground/80 space-y-6">
                    <span className={cn("inline transition-all duration-700", selectedCitation === "9.2" ? "bg-yellow-400/40 text-foreground px-1 -mx-1" : "")}>
                      9.2. Measurement of Progress. Given that control transfers over time, revenue shall be recognized over the construction period relative to the progress made towards satisfaction of the Performance Obligation. The Contractor shall utilize the cost-to-cost input method to measure progress.
                    </span>
                    <br /><br />
                    9.3. Billing and Payment. Invoices shall be submitted monthly based on progress certificates approved by the Owner's Representative. Payments shall be remitted within thirty (30) days of receipt of a valid and undisputed invoice.
                    <br /><br />
                    9.4. Milestone Schedule. The following billing milestones are established for the initial phase: (a) Effective Date - 20%; (b) Detailed Design Approval - 10%; (c) Procurement Completion - 15%;.
                  </p>
                </div>

                {/* Page 2 */}
                <div id="page-2" className="relative py-24 border-b border-foreground/5">
                  <span className="absolute -left-8 top-24 text-[10px] font-mono text-muted-foreground/50">02</span>
                  <h4 className="font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-foreground pb-4">Article 3: Scope of Services</h4>
                  <p className="text-[15px] leading-[1.8] text-foreground/80">
                    3.3. Performance Obligations. The Services shall be performed as a unified sequence of engineering and construction activities.
                    <br /><br />
                    <span className={cn("inline transition-all duration-700", selectedCitation === "3.3.2" ? "bg-yellow-400/40 text-foreground px-1 -mx-1" : "")}>
                      3.3.2. The individual goods and services are highly interdependent and represent a complex integration service. As such, the Parties agree that this Agreement comprises a single, integrated Performance Obligation for financial reporting purposes.
                    </span>
                    <br /><br />
                    3.4. Exclusions. The following activities are excluded from the Scope of Services...
                  </p>
                </div>

                {/* Page 3 */}
                <div id="page-3" className="relative py-24 border-b border-foreground/5">
                  <span className="absolute -left-8 top-24 text-[10px] font-mono text-muted-foreground/50">03</span>
                  <h4 className="font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-foreground pb-4">Article 7: Liquidated Damages</h4>
                  <p className="text-[15px] leading-[1.8] text-foreground/80">
                    7.1. Delay in Completion. If the Contractor fails to achieve Substantial Completion by the Milestone Date...
                    <br /><br />
                    7.2. Limitation of Liability. The total aggregate liability for liquidated damages shall not exceed ten percent (10%) of the Contract Price.
                    <br /><br />
                    <span className={cn("inline transition-all duration-700", selectedCitation === "7.3" ? "bg-yellow-400/40 text-foreground px-1 -mx-1" : "")}>
                      7.3. Advance Payment and Mobilization. An Advance Payment representing twenty percent (20%) of the total Contract Price (equivalent to USD $150,000,000) shall be payable upon the Effective Date to fund initial mobilization.
                    </span>
                  </p>
                </div>

                {/* Faded pages for stack effect */}
                <div className="h-64 opacity-10 flex flex-col justify-center items-center gap-4">
                  <div className="w-full h-1 bg-foreground/20" />
                  <div className="w-3/4 h-1 bg-foreground/20" />
                  <span className="text-[10px] font-mono uppercase">Page 4 & 5 (End of Document)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Analysis View - AI Inspector */}
          <div className="reveal reveal-delay-2 flex flex-col gap-10">
            <div className="flex gap-4 border-b border-foreground/10 pb-8">
              {["IFRS 15", "Payment Terms", "Performance Obligations"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCriterion(cat);
                    const item = contractData.find(d => d.category === cat);
                    if (item) {
                      setSelectedCitation(item.refId);
                      const el = document.getElementById(`page-${item.page}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }
                  }}
                  className={cn(
                    "text-[10px] tracking-[0.2em] uppercase transition-all pb-2 px-1",
                    activeCriterion === cat ? "text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {contractData.filter(d => d.category === activeCriterion).map((data, i) => (
              <div key={i} className="flex-1 space-y-12">
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-primary">AI Extraction</span>
                      <span className="text-[9px] font-mono px-2 py-0.5 bg-green-500/10 text-green-600 rounded-sm">98.2% Confidence</span>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedCitation(data.refId);
                        const el = document.getElementById(`page-${data.page}`);
                        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                      className="flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase text-primary hover:underline"
                    >
                      <Play size={10} fill="currentColor" /> View Reference
                    </button>
                  </div>
                  <h3 className="text-[32px] leading-tight">{data.question}</h3>
                  <p className="text-[14px] leading-relaxed text-muted-foreground italic">{data.answer}</p>
                </div>

                <div className="p-8 bg-background border border-foreground/5 shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <Brain size={16} className="text-primary" />
                    <span className="text-[10px] tracking-[0.2em] uppercase font-bold">Analysis Context</span>
                  </div>
                  <p className="text-[13px] text-muted-foreground leading-relaxed mb-6">"{data.reason}"</p>
                  <div className="flex gap-4">
                    <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground uppercase">
                      <Terminal size={12} /> Standards Log: 4.2.1
                    </div>
                    <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground uppercase">
                      <Layers size={12} /> Model: CS-REASONER-V2
                    </div>
                  </div>
                </div>

                <div className="p-8 bg-foreground text-background rounded-sm group relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 blur-3xl group-hover:bg-primary/40 transition-colors" />
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-8 h-8 rounded-full border border-background/10 flex items-center justify-center">
                      <Shield size={14} className="text-primary" />
                    </div>
                    <span className="text-[10px] tracking-[0.2em] uppercase text-background/40">Verifiable Extraction</span>
                  </div>
                  <p className="text-[12px] text-background/60 italic leading-relaxed">
                    Citied directly from <span className="text-primary/80 underline underline-offset-4 cursor-pointer" onClick={() => {
                      const el = document.getElementById(`page-${data.page}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}>Article {data.refId}</span>. This extraction is cryptographically linked to the source PDF hash to prevent tampering.
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

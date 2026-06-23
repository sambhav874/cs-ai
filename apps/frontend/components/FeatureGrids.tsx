"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Globe, Mail, BarChart3, Shield, Sparkles } from "lucide-react";

export function Pillars() {
  return (
    <section id="pillars" className="py-24 md:py-40 border-b border-foreground/10 bg-background/40">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-24">
          {[
            { num: "01", title: "Human-Centricity", desc: "Technology should amplify, not replace, the human spark.", tag: "Augmented Intelligence" },
            { num: "02", title: "Radical Transparency", desc: "Risk should be surfaced, explained, and understood by all.", tag: "Explainability" },
            { num: "03", title: "Scalable Precision", desc: "Complexity is a challenge to be mastered, not an excuse for error.", tag: "Precision Engineering" }
          ].map((pillar, i) => (
            <div key={pillar.num} className={cn("reveal", i === 1 && "reveal-delay-1", i === 2 && "reveal-delay-2")}>
              <h3 className="font-semibold text-[10px] tracking-[0.2em] uppercase mb-8 text-primary">Principle {pillar.num}</h3>
              <p className="text-[28px] md:text-[34px] leading-[1.2] mb-10 font-light italic">"{pillar.desc}"</p>
              <div className="flex items-center gap-3">
                <span className="w-4 h-[1px] bg-foreground/20" />
                <p className="text-[10px] text-muted-foreground uppercase tracking-[0.1em] font-medium">{pillar.tag}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProcessSteps() {
  const [currentStep, setCurrentStep] = useState(1);
  return (
    <section className="py-24 md:py-40 bg-muted/30">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-16 items-start">
          <div className="md:col-span-4 reveal">
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary mb-8 block">The Process</span>
            <h2 className="text-[40px] md:text-[52px] font-light leading-tight mb-8">
              Three Steps to <br />
              <i className="text-primary">Contract Intelligence</i>
            </h2>
            <div className="w-12 h-[1px] bg-foreground/20 mb-8" />
            <p className="text-[12px] text-muted-foreground leading-relaxed max-w-[300px]">
              We've abstracted the complexity of AR and risk workflows into a unified, high-performance interface.
            </p>
          </div>

          <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-3 gap-12">
            {[
              { id: 1, title: "Ingest", desc: "Automated ingestion via Rest APIs from ERPs or high-volume file uploads." },
              { id: 2, title: "Resolve", desc: "AI identifies and explains obligations with high-fidelity citations." },
              { id: 3, title: "Track", desc: "Monitor performance and mitigate risk via automated audit trails." }
            ].map((step, i) => (
              <div
                key={step.id}
                className={cn("reveal", i === 1 && "reveal-delay-1", i === 2 && "reveal-delay-2")}
                onMouseEnter={() => setCurrentStep(step.id)}
              >
                <div className={cn(
                  "w-10 h-10 rounded-full border border-foreground/10 flex items-center justify-center text-[11px] font-mono mb-8 transition-colors duration-500",
                  currentStep === step.id ? "bg-foreground text-background" : "text-muted-foreground"
                )}>
                  0{step.id}
                </div>
                <h3 className="font-semibold text-[11px] tracking-[0.1em] uppercase mb-4">{step.title}</h3>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Connectivity() {
  return (
    <section className="py-24 md:py-40 bg-background border-y border-foreground/10">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
          <div className="reveal">
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary mb-8 block">Connectivity</span>
            <h2 className="text-[48px] md:text-[64px] font-light leading-none mb-12">
              Unified <i className="text-primary">Data</i> Streams
            </h2>
            <p className="text-[13px] leading-[1.8] text-muted-foreground mb-12 max-w-[480px]">
              ContractSense.ai doesn't live in a vacuum. We ingest directly from your ERPs, data streams, and active file stores to track contract performance in real-time.
            </p>
            <div className="space-y-8">
              {[
                { title: "ERP & API Ingest", desc: "Seamless sync with Oracle, SAP, and custom REST APIs for high-volume ingestion.", icon: Globe },
                { title: "Invoice & File Streams", desc: "Automated analysis of incoming invoices, remittance, and legal file ingests.", icon: Mail },
                { title: "Omni-Source Tracking", desc: "Monitor milestones and obligations across disparate data sources in real-time.", icon: BarChart3 }
              ].map((item, i) => (
                <div key={item.title} className="flex gap-6 items-start">
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <item.icon size={16} className="text-primary" />
                  </div>
                  <div>
                    <h4 className="font-bold text-[11px] tracking-[0.1em] uppercase mb-2">{item.title}</h4>
                    <p className="text-[12px] text-muted-foreground max-w-[320px]">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative reveal reveal-delay-2">
            <div className="bg-foreground p-8 md:p-12 rounded-sm shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,hsl(var(--primary))_0%,transparent_70%)] opacity-20" />
              <div className="flex justify-between items-center mb-12">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] tracking-[0.2em] uppercase text-background/50">Live Stream: ERP_CONNECT_V4</span>
                </div>
                <span className="text-[9px] font-mono text-background/20">00:42:12</span>
              </div>
              <div className="space-y-6">
                {[
                  { label: "Contract Value", val: "$750,000,000", textColor: "text-background" },
                  { label: "Milestones Reached", val: "14 / 22", textColor: "text-primary/80" },
                  { label: "Pending Obligations", val: "03 Critical", textColor: "text-background" }
                ].map((stat, i) => (
                  <div key={stat.label} className="border-b border-background/10 pb-6">
                    <span className="text-[9px] tracking-[0.1em] uppercase text-background/50 block mb-2">{stat.label}</span>
                    <span className={cn(
                      "text-[28px] font-mono font-bold",
                      stat.textColor
                    )}>
                      {stat.val}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            {/* Decorative Dots */}
            <div className="absolute -bottom-6 -left-6 w-24 h-24 grid grid-cols-4 gap-2 opacity-20">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="w-1 h-1 bg-foreground rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Suite() {
  return (
    <section id="suite" className="py-24 md:py-40 bg-background">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-8 reveal">
          <h2 className="text-[48px] md:text-[64px] font-light leading-none tracking-tight">
            The <i className="text-primary">Suite</i>
          </h2>
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground max-w-[300px] leading-relaxed">
            Specialized intelligence for high-velocity enterprise capital.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-foreground/10 border border-foreground/10">
          {[
            {
              num: "01",
              title: "ContractSense Core",
              desc: "The foundational reasoning engine. It extracts, explains, and cites every obligation with absolute legal precision.",
              tag: "Extraction Engine"
            },
            {
              num: "02",
              title: "Risk Intelligence",
              desc: "Benchmark your contracts against IFRS 15 and global accounting standards. High-fidelity Q&A for complex risk discovery.",
              tag: "Compliance"
            },
            {
              num: "03",
              title: "Enterprise Integration",
              desc: "Bridge the gap between legal and finance. Automate AR, track performance, and monitor milestones in real-time.",
              tag: "Automation"
            }
          ].map((product, i) => (
            <div key={product.num} className="bg-muted/30 p-12 group hover:bg-background transition-colors duration-500 reveal">
              <div className="flex justify-between items-start mb-12">
                <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground">{product.num}</span>
                <span className="text-[9px] tracking-[0.15em] uppercase px-3 py-1 border border-foreground/10 rounded-full text-muted-foreground/80">{product.tag}</span>
              </div>
              <h3 className="text-[32px] mb-6 group-hover:text-primary transition-colors">{product.title}</h3>
              <p className="text-[12px] leading-[1.8] text-muted-foreground">{product.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Compliance() {
  return (
    <section id="compliance" className="py-24 md:py-48 bg-foreground text-background overflow-hidden relative">
      <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[radial-gradient(circle,hsl(var(--primary))_0%,transparent_70%)] opacity-10 pointer-events-none" />

      <div className="max-w-[1240px] mx-auto px-6 md:px-12 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center mb-32">
          <div className="reveal">
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary/80 mb-8 block">Reporting & Audits</span>
            <h2 className="text-[48px] md:text-[80px] font-light leading-[0.9] tracking-tighter mb-12">
              Verifiable <i className="text-primary/80">Compliance</i>
            </h2>
            <div className="space-y-12">
              <div>
                <h4 className="font-bold text-[13px] tracking-[0.1em] uppercase mb-4 text-primary/80">Standard-Specific Reporting</h4>
                <p className="text-[13px] text-background/60 leading-relaxed max-w-[440px]">
                  Generate instantaneous IFRS 15 5-step reports, SOX benchmarks, and multi-contract aggregate risk profiles in a single click.
                </p>
              </div>
              <div>
                <h4 className="font-bold text-[13px] tracking-[0.1em] uppercase mb-4 text-primary/80">Org-Wide Audit Logs</h4>
                <p className="text-[13px] text-background/60 leading-relaxed max-w-[440px]">
                  Complete transparency into who accessed, reviewed, or approved every contract. Track report generation and system processing timestamps globally.
                </p>
              </div>
            </div>
          </div>

          <div className="reveal reveal-delay-2 p-8 bg-background/5 border border-background/10 rounded-sm backdrop-blur-sm shadow-2xl">
            <div className="flex justify-between items-center mb-10 border-b border-background/10 pb-6">
              <div className="flex items-center gap-3">
                <Shield size={18} className="text-primary/80" />
                <span className="text-[10px] tracking-[0.2em] uppercase font-bold">Audit Certificate V4</span>
              </div>
              <span className="text-[9px] font-mono text-background/40">HASH: 0x82f...a1c</span>
            </div>
            <div className="space-y-6 mb-10 text-[11px] font-mono">
              <div className="flex justify-between py-3 border-b border-background/5">
                <span className="text-background/40 uppercase">Processor Status</span>
                <span className="text-primary/80">Active (Multiple Orgs)</span>
              </div>
              <div className="flex justify-between py-3 border-b border-background/5">
                <span className="text-background/40 uppercase">Approval Chain</span>
                <span className="text-green-400">Verified by CFO_User_01</span>
              </div>
              <div className="flex justify-between py-3 border-b border-background/5">
                <span className="text-background/40 uppercase">IFRS 15 5-Step Report</span>
                <span className="text-primary/80">Generated</span>
              </div>
            </div>
            <button className="w-full py-4 bg-primary/80 text-foreground text-[10px] font-bold tracking-[0.2em] uppercase hover:bg-background transition-colors">
              Generate Full Audit Report
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Questionnaire() {
  return (
    <section className="py-24 md:py-40 bg-background border-b border-foreground/10">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12">
        <div className="text-center mb-24 reveal">
          <span className="text-[10px] tracking-[0.3em] uppercase text-primary mb-8 block">Inquiry Assistance</span>
          <h2 className="text-[48px] md:text-[64px] font-light leading-none mb-8">
            The <i className="text-primary">Suggestion</i> Engine
          </h2>
          <p className="text-[13px] text-muted-foreground uppercase tracking-[0.2em] max-w-[500px] mx-auto">
            Automatic inquiry generation based on contract type and regulatory context.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 reveal reveal-delay-1">
          {[
            { title: "Question Generation", desc: "Whenever a question is created, the AI provides well-prompted suggestions for mapping and extraction." },
            { title: "Dynamic Logic", desc: "Suggestions evolve in real-time as the engine learns the specific nuances of your organizational legal standards." },
            { title: "Refined Q&A", desc: "Automatically generate high-precision inquiries tailored to the specific contract context." }
          ].map((item, i) => (
            <div key={item.title} className="p-10 border border-foreground/5 bg-muted/30 hover:bg-background transition-all group">
              <div className="w-8 h-8 rounded-full border border-primary/20 flex items-center justify-center mb-8 group-hover:bg-primary transition-colors">
                <Sparkles size={14} className="text-primary group-hover:text-primary-foreground" />
              </div>
              <h4 className="font-bold text-[11px] tracking-[0.1em] uppercase mb-6 leading-tight">{item.title}</h4>
              <p className="text-[12px] text-muted-foreground leading-relaxed mb-8">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

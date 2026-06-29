"use client";

import { motion } from "framer-motion";
import { 
  Search, 
  Activity, 
  ShieldAlert, 
  PlaneTakeoff, 
  Clock, 
  AlertTriangle,
  CheckCircle,
  FileText,
  Database,
  Network,
  Zap,
  CheckCircle2,
  Cpu,
  BarChart3,
  Wifi,
  Lightbulb,
  XCircle,
  ArrowRight
} from "lucide-react";

export function ValueProposition() {
  return (
    <div className="w-full flex flex-col bg-background font-sans overflow-hidden">
      


      {/* =========================================
          FEATURE 1: ANALYSE
          ========================================= */}
      <section className="py-24 md:py-40 bg-background border-b border-foreground/5 overflow-hidden">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1">
              <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-8">
                <Search className="text-primary" size={32} />
              </div>
              <h2 className="text-[40px] md:text-[64px] font-light leading-[1.1] mb-6">
                Deep Contextual <i className="text-primary">Extraction.</i>
              </h2>
              <p className="text-[18px] leading-[1.8] opacity-70 mb-8 max-w-[500px]">
                Centralise contracts to perform deep AI extraction. ContractSense vectorizes complex supplier engagements, lifting every obligation, KPI, penalty clause, and commercial term into a structured graph.
              </p>
              <ul className="space-y-4">
                {["Semantically link related clauses", "Extract complex penalty formulas", "100% auditable citation links"].map((item, i) => (
                  <motion.li 
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    viewport={{ once: true }}
                    key={i} 
                    className="flex items-center gap-3 text-[15px] opacity-80"
                  >
                    <CheckCircle2 size={18} className="text-primary" />
                    {item}
                  </motion.li>
                ))}
              </ul>
            </div>

            <div className="order-1 lg:order-2 relative h-[400px] w-full flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent rounded-3xl" />
              <motion.div 
                initial={{ y: 50, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true }}
                className="w-[320px] bg-background border border-foreground/10 rounded-xl shadow-2xl p-6 relative z-10"
              >
                <div className="h-3 w-1/3 bg-foreground/20 rounded mb-6" />
                <div className="space-y-3 mb-6">
                  <div className="h-2 w-full bg-foreground/10 rounded" />
                  <div className="h-2 w-5/6 bg-foreground/10 rounded" />
                  <div className="h-2 w-full bg-foreground/10 rounded" />
                  <div className="h-2 w-4/6 bg-primary/30 rounded" /> 
                </div>
                <div className="space-y-3">
                  <div className="h-2 w-full bg-foreground/10 rounded" />
                  <div className="h-2 w-3/4 bg-foreground/10 rounded" />
                </div>

                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4, type: "spring" }}
                  viewport={{ once: true }}
                  className="absolute -right-16 top-24 bg-background border border-primary/30 shadow-xl rounded-lg p-3 w-[180px]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Network size={14} className="text-primary" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Obligation Mapped</span>
                  </div>
                  <p className="text-[12px] opacity-80 leading-tight">Liquidated Damages: Clause 7.4 active.</p>
                  <div className="mt-2 pt-2 border-t border-foreground/5 flex justify-between items-center">
                    <span className="text-[9px] opacity-50 uppercase">Confidence</span>
                    <span className="text-[10px] font-mono text-emerald-500">99.8%</span>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  whileInView={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.6, type: "spring" }}
                  viewport={{ once: true }}
                  className="absolute -left-12 bottom-12 bg-background border border-foreground/10 shadow-xl rounded-lg p-3 w-[160px]"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Database size={14} className="text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">KPI Extracted</span>
                  </div>
                  <p className="text-[12px] font-mono opacity-80">Threshold: &lt;15m</p>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================
          FEATURE 2: MONITOR 
          ========================================= */}
      <section className="py-24 md:py-40 bg-background border-b border-foreground/5 overflow-hidden relative">
        <div className="absolute top-0 left-0 w-[800px] h-[800px] bg-[radial-gradient(circle,hsl(var(--primary)/0.05)_0%,transparent_70%)] pointer-events-none" />
        
        <div className="max-w-[1240px] mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="order-2 lg:order-1 relative h-[500px] w-full flex flex-col justify-center gap-6 z-10">
              <div className="absolute left-8 md:left-12 top-[10%] bottom-[10%] w-px bg-foreground/10 -z-10">
                <motion.div 
                  className="w-full bg-gradient-to-b from-transparent via-primary to-transparent h-32"
                  animate={{ y: [0, 400] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                />
              </div>

              <motion.div 
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="bg-background border border-foreground/10 shadow-xl rounded-2xl p-5 ml-4 md:ml-8 flex items-center gap-5 w-[90%] md:w-[80%]"
              >
                <div className="bg-primary/10 text-primary p-3 rounded-xl shrink-0">
                  <Wifi size={24} />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[11px] font-bold uppercase tracking-widest opacity-50">Live Telemetry</p>
                    <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Connected
                    </span>
                  </div>
                  <div className="flex items-end gap-1 h-8 mt-2">
                    {[40, 65, 30, 80, 45, 90, 50, 70, 30, 60].map((height, i) => (
                      <motion.div 
                        key={i}
                        className="w-full bg-primary/20 rounded-t-sm"
                        animate={{ height: [`${height}%`, `${Math.max(20, height - 20)}%`, `${height}%`] }}
                        transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.1 }}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                viewport={{ once: true }}
                className="bg-foreground text-background shadow-2xl rounded-2xl p-6 w-[95%] md:w-[90%] relative overflow-hidden"
              >
                <div className="absolute -right-10 -top-10 opacity-5">
                  <Activity size={150} />
                </div>
                <div className="flex items-center gap-3 mb-6 relative z-10">
                  <div className="bg-primary w-2 h-2 rounded-full shadow-[0_0_10px_rgba(var(--primary))]" />
                  <p className="text-[13px] tracking-wider uppercase font-medium">Contract Engine Analysis</p>
                </div>
                
                <div className="grid grid-cols-2 gap-4 relative z-10">
                  <div>
                    <p className="text-[11px] opacity-60 uppercase mb-1">Active KPIs</p>
                    <p className="text-[24px] font-light">1,204</p>
                  </div>
                  <div>
                    <p className="text-[11px] opacity-60 uppercase mb-1">Risk Status</p>
                    <p className="text-[14px] font-mono text-emerald-400 mt-2">Nominal</p>
                  </div>
                </div>
              </motion.div>

              <motion.div 
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                viewport={{ once: true }}
                className="bg-background border border-foreground/10 shadow-xl rounded-2xl p-5 ml-4 md:ml-8 flex items-center gap-5 w-[90%] md:w-[80%]"
              >
                <div className="bg-muted text-foreground p-3 rounded-xl shrink-0">
                  <BarChart3 size={24} />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest opacity-50 mb-1">ERP / Finance Sync</p>
                  <p className="text-[14px] font-mono opacity-80">Last Sync: Just now</p>
                </div>
              </motion.div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-8">
                <Activity className="text-primary" size={32} />
              </div>
              <h2 className="text-[40px] md:text-[64px] font-light leading-[1.1] mb-6">
                Continuous <i className="text-primary">Monitoring.</i>
              </h2>
              <p className="text-[18px] leading-[1.8] opacity-70 mb-8 max-w-[500px]">
                Static contracts meet dynamic execution. Track performance in real-time against your extracted KPIs using high-throughput data feeds directly from your operations, finance, and IoT systems.
              </p>
              <div className="flex gap-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full border border-foreground/20 flex items-center justify-center text-foreground"><Cpu size={18}/></div>
                  <span className="text-[10px] uppercase tracking-wider opacity-60">IoT Ops</span>
                </div>
                <div className="w-8 border-t border-foreground/20 mt-6 border-dashed" />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-full border border-foreground/20 flex items-center justify-center text-foreground"><BarChart3 size={18}/></div>
                  <span className="text-[10px] uppercase tracking-wider opacity-60">Finance</span>
                </div>
                <div className="w-8 border-t border-foreground/20 mt-6 border-dashed" />
                <div className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 bg-primary text-background rounded-full flex items-center justify-center"><Activity size={18}/></div>
                  <span className="text-[10px] uppercase tracking-wider font-bold text-primary">Engine</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================
          FEATURE 3: ENFORCE
          ========================================= */}
      <section className="py-24 md:py-40 bg-background border-b border-foreground/5 overflow-hidden">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-8">
                <ShieldAlert className="text-primary" size={32} />
              </div>
              <h2 className="text-[40px] md:text-[64px] font-light leading-[1.1] mb-6">
                Automated <i className="text-primary">Enforcement.</i>
              </h2>
              <p className="text-[18px] leading-[1.8] opacity-70 mb-8 max-w-[500px]">
                Close the loop instantly. When real-time data violates a parameterized clause, ContractSense automates breach detection, calculates remediation logic, and generates formal supplier communications.
              </p>
            </div>

            <div className="relative w-full max-w-[450px] mx-auto">
              <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-gradient-to-b from-primary via-primary/50 to-emerald-500 z-0" />
              <div className="space-y-6 relative z-10">
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  className="bg-background border border-foreground/10 rounded-xl p-5 flex items-center gap-4 shadow-sm ml-0"
                >
                  <div className="w-12 h-12 bg-destructive/10 text-destructive rounded-full flex items-center justify-center shrink-0 border border-background shadow-sm">
                    <AlertTriangle size={20} />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold">1. Breach Detected</h4>
                    <p className="text-[12px] opacity-60 font-mono mt-1">Event: Delay &gt; 15m (Code 31)</p>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                  viewport={{ once: true }}
                  className="bg-background border border-foreground/10 rounded-xl p-5 flex items-center gap-4 shadow-sm ml-0"
                >
                  <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center shrink-0 border border-background shadow-sm">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold">2. Clause Mapped</h4>
                    <p className="text-[12px] opacity-60 font-mono mt-1">Cross-ref: Liquidated Damages v7.4</p>
                  </div>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 }}
                  viewport={{ once: true }}
                  className="bg-background border border-emerald-500/30 rounded-xl p-5 flex items-center gap-4 shadow-md ml-0"
                >
                  <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 border border-background shadow-sm">
                    <Zap size={20} />
                  </div>
                  <div>
                    <h4 className="text-[14px] font-bold text-emerald-600 dark:text-emerald-400">3. Action Executed</h4>
                    <p className="text-[12px] opacity-60 font-mono mt-1">Issued claim: $6,500 recovery</p>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </section>

            {/* =========================================
          SECTION 1: THE DRAIN (IMPROVED)
          ========================================= */}
      <section className="py-24 md:py-32 border-b border-foreground/10 bg-background relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,hsl(var(--primary)/0.05),transparent_50%)] pointer-events-none" />
        
        <div className="max-w-[1240px] mx-auto px-6 md:px-12">
          
          <div className="text-center mb-20">
            <span className="text-[12px] tracking-[0.3em] uppercase text-primary font-bold mb-6 block">The Baseline</span>
            <h2 className="text-[40px] md:text-[64px] font-light leading-[1.1] max-w-[800px] mx-auto">
              The true cost of unmonitored supplier performance.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="bg-muted/30 border border-foreground/10 p-12 md:p-16 rounded-2xl flex flex-col items-center text-center shadow-sm"
            >
              <span className="text-[14px] tracking-[0.2em] uppercase opacity-50 font-bold mb-6 block">Value Leakage</span>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-[100px] md:text-[140px] leading-[0.8] font-light tracking-tighter text-foreground">
                  11<span className="text-primary">%</span>
                </span>
              </div>
              <p className="text-[16px] md:text-[20px] opacity-70 leading-tight max-w-[300px]">
                of total contract value leaks post-signature.
              </p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              viewport={{ once: true }}
              className="bg-foreground text-background p-12 md:p-16 rounded-2xl flex flex-col items-center text-center shadow-xl relative overflow-hidden"
            >
              <div className="absolute -right-20 -bottom-20 w-64 h-64 border-[40px] border-background/5 rounded-full pointer-events-none" />
              <span className="text-[14px] tracking-[0.2em] uppercase opacity-50 font-bold mb-6 block">Detection Gap</span>
              <div className="flex items-baseline gap-2 mb-6 relative z-10">
                <span className="text-[100px] md:text-[140px] leading-[0.8] font-light tracking-tighter">
                  &lt;15<span className="text-primary">%</span>
                </span>
              </div>
              <p className="text-[16px] md:text-[20px] opacity-70 leading-tight max-w-[300px] relative z-10">
                of operational failures are actually tracked as breaches.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* =========================================
          SECTION 4: THE SCENARIO (BEFORE & AFTER)
          ========================================= */}
      <section className="py-32 bg-background">
        <div className="max-w-[1240px] mx-auto px-6 md:px-12">
          
          <div className="mb-20 text-center">
            <span className="text-[12px] tracking-[0.2em] font-bold uppercase text-primary mb-4 block">The Impact</span>
            <h2 className="text-[40px] md:text-[64px] font-light leading-[1] max-w-[800px] mx-auto">
              Transforming a 45-minute delay into <i className="text-primary">automated recovery.</i>
            </h2>
            <p className="text-[16px] md:text-[18px] opacity-60 mt-6 max-w-[600px] mx-auto">
              Scenario: Flight LH450. A catering truck arrives 20 minutes late, causing a 35-minute departure delay.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8 max-w-[1100px] mx-auto">
            
            {/* BEFORE: The Manual Drain */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="border border-destructive/20 bg-destructive/5 rounded-3xl p-8 md:p-12 flex flex-col relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-destructive/10 rounded-full blur-3xl -z-10" />
              
              <div className="flex items-center gap-3 text-destructive mb-10">
                <XCircle size={28} />
                <h3 className="text-[14px] tracking-[0.2em] font-bold uppercase">Before: The Old Way</h3>
              </div>

              <div className="space-y-8 flex-1">
                <div className="flex gap-4 items-start opacity-70">
                  <Clock className="shrink-0 mt-1" size={20} />
                  <div>
                    <h4 className="font-bold text-[16px]">Manual Tracking</h4>
                    <p className="text-[14px] mt-1">Ground crews miss the log entry in the chaos of a delayed departure.</p>
                  </div>
                </div>
                
                <div className="flex gap-4 items-start opacity-70">
                  <AlertTriangle className="shrink-0 mt-1" size={20} />
                  <div>
                    <h4 className="font-bold text-[16px]">Lost in the Noise</h4>
                    <p className="text-[14px] mt-1">Procurement takes 60+ days to audit the flight logs against catering contracts.</p>
                  </div>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-destructive/20">
                <p className="text-[12px] uppercase tracking-widest text-destructive mb-2 font-bold">Total Result</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[40px] md:text-[56px] font-light leading-none text-destructive">-$12,000</p>
                </div>
                <p className="text-[14px] opacity-70 mt-2">Zero recovery. Claim window expired.</p>
              </div>
            </motion.div>

            {/* AFTER: ContractSense */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              viewport={{ once: true }}
              className="border border-emerald-500/20 bg-emerald-500/5 rounded-3xl p-8 md:p-12 flex flex-col relative overflow-hidden dark:bg-emerald-500/10 shadow-lg shadow-emerald-500/5"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -z-10" />

              <div className="flex items-center gap-3 text-emerald-600 dark:text-emerald-400 mb-10">
                <CheckCircle2 size={28} />
                <h3 className="text-[14px] tracking-[0.2em] font-bold uppercase">After: ContractSense</h3>
              </div>

              <div className="space-y-6 flex-1 relative before:absolute before:inset-0 before:ml-2.5 before:-translate-x-px before:h-full before:w-0.5 before:bg-emerald-500/20">
                
                <div className="relative flex gap-6 items-start">
                  <div className="w-5 h-5 rounded-full border-4 border-background bg-emerald-500 shrink-0 mt-0.5 z-10" />
                  <div>
                    <h4 className="font-bold text-[15px]">1. Instant Detection</h4>
                    <p className="text-[13px] opacity-70 mt-1">Flags "Code 31" delay directly from API telemetry.</p>
                  </div>
                </div>
                
                <div className="relative flex gap-6 items-start">
                  <div className="w-5 h-5 rounded-full border-4 border-background bg-emerald-500 shrink-0 mt-0.5 z-10" />
                  <div>
                    <h4 className="font-bold text-[15px]">2. AI Validation</h4>
                    <p className="text-[13px] opacity-70 mt-1">Cross-references Clause 7.4. Confirms 15-min grace period exceeded.</p>
                  </div>
                </div>

                <div className="relative flex gap-6 items-start">
                  <div className="w-5 h-5 rounded-full border-4 border-background bg-emerald-500 shrink-0 mt-0.5 z-10" />
                  <div>
                    <h4 className="font-bold text-[15px]">3. Automated Claim</h4>
                    <p className="text-[13px] opacity-70 mt-1">Supplier notified automatically within 2 hours with full audit trail.</p>
                  </div>
                </div>
              </div>

              <div className="mt-12 pt-8 border-t border-emerald-500/20">
                <p className="text-[12px] uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-2 font-bold">Recovered Instantly</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-[40px] md:text-[56px] font-light leading-none text-emerald-600 dark:text-emerald-400">+$6,500</p>
                </div>
                <p className="text-[14px] opacity-70 mt-2">$4,500 credit + $2,000 penalty secured.</p>
              </div>
            </motion.div>

          </div>
        </div>
      </section>

    </div>
  );
}
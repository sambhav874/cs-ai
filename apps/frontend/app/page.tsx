"use client";

import { useScroll, useSpring, AnimatePresence, motion } from "framer-motion";
import { Instrument_Serif, DM_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { ArrowRight, Play, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import RequestDemoModal from "@/components/modals/RequestDemoModal";
import AssessmentCTA from "@/components/AssessmentCTA";
import { AnalyzerPlayground } from "@/components/AnalyzerPlayground";
import { Pillars, ProcessSteps, Connectivity, Suite, Compliance, Questionnaire } from "@/components/FeatureGrids";

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-cormorant",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-plus-jakarta",
});

export default function Home() {
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);
  const analyzerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    const reveals = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); }
      });
    }, { threshold: 0.15 });
    reveals.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [isClient]);

  if (!isClient) return null;

  return (
    <>
      <div className={cn("bg-background text-foreground selection:bg-primary selection:text-primary-foreground min-h-screen relative font-sans", dmMono.variable, instrument.variable, plusJakartaSans.variable)}>
        {/* Progress Bar */}
        <motion.div
          className="fixed top-0 left-0 right-0 h-[2px] bg-primary z-[200] origin-left"
          style={{ scaleX }}
        />

        {/* Nav */}
        <nav className="fixed top-0 left-0 right-0 z-[100] px-6 py-6 md:px-12 md:py-8 flex justify-between items-center transition-all duration-500 bg-background/10 backdrop-blur-md border-b border-foreground/5">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Image src="/logo.png" alt="ContractSense Logo" width={32} height={32} className="object-contain" />
              <span className="font-extrabold text-sm tracking-[0.15em] uppercase">ContractSense<span className="text-primary">.ai</span></span>
            </Link>
            <div className="hidden sm:block w-[1px] h-4 bg-foreground/10" />
            <Link
              href="https://ninthquadrant.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 group transition-opacity opacity-40 hover:opacity-100"
            >
              <span className="text-[9px] tracking-[0.2em] uppercase">by Ninth Quadrant</span>
              <ArrowRight size={10} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ul className="hidden lg:flex gap-9 list-none">
            {[
              { name: "Interactive", id: "#interactive" },
              { name: "Pillars", id: "#pillars" },
              { name: "Demo", id: "#demo" },
              { name: "Suite", id: "#suite" },
              { name: "Compliance", id: "#compliance" }
            ].map(item => (
              <li key={item.name}>
                <Link
                  href={item.id}
                  className="text-[10px] tracking-[0.25em] font-bold uppercase hover:text-primary transition-colors"
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 text-foreground/60 hover:text-foreground transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              onClick={() => setIsContactModalOpen(true)}
              className="hidden sm:inline-flex bg-foreground text-background px-6 py-3 text-[9px] font-bold tracking-[0.2em] uppercase hover:bg-primary transition-all"
            >
              Request Demo →
            </button>
          </div>
        </nav>

        {/* Mobile Menu Overlay */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, x: "100%" }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-0 z-[90] bg-background lg:hidden flex flex-col pt-32 px-12"
            >
              <ul className="flex flex-col gap-10">
                {[
                  { name: "Interactive", id: "#interactive" },
                  { name: "Pillars", id: "#pillars" },
                  { name: "Demo", id: "#demo" },
                  { name: "Suite", id: "#suite" },
                  { name: "Compliance", id: "#compliance" }
                ].map((item, i) => (
                  <motion.li
                    key={item.name}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 * i }}
                  >
                    <Link
                      href={item.id}
                      className="text-2xl italic flex items-center justify-between group"
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <span>{item.name}</span>
                      <ArrowRight size={20} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  </motion.li>
                ))}
              </ul>

              <div className="mt-auto mb-12">
                <button
                  onClick={() => {
                    setIsContactModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="w-full bg-foreground text-background py-6 text-[11px] font-bold tracking-[0.2em] uppercase"
                >
                  Request Demo
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hero */}
        <section className="min-h-screen pt-20 relative overflow-hidden flex flex-col justify-center" id="home">
          <div className="absolute top-[-200px] right-[-200px] w-[800px] h-[800px] bg-[radial-gradient(circle,hsl(var(--primary))_0%,transparent_70%)] opacity-10 pointer-events-none" />

          <div className="flex flex-col items-center justify-center text-center max-w-[1000px] mx-auto h-full px-4">
            <div className="reveal flex flex-col items-center">
              <h1 className="text-[clamp(48px,8vw,140px)] font-light leading-[0.9] tracking-[-0.04em] mb-12">
                <i className="text-primary">Contract</i> Intelligence
              </h1>
              <p className="text-[17px] md:text-[19px] leading-[1.8] opacity-65 max-w-[700px] mb-14 tracking-[0.02em] italic">
                Precision-engineered contract intelligence for high-stakes finance. Surface key obligations and automate compliance with verifiable AI.
              </p>
              <div className="flex flex-wrap justify-center gap-6 items-center">
                <button
                  onClick={() => demoRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-foreground text-background px-12 py-5 text-[11px] tracking-[0.12em] uppercase hover:bg-primary transition-colors shadow-xl"
                >
                  Watch Demo
                </button>
                <button
                  onClick={() => analyzerRef.current?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-background px-12 py-5 text-[11px] tracking-[0.12em] uppercase border border-foreground/10 hover:border-primary hover:text-primary transition-all shadow-sm"
                >
                  Interactive Analysis
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Ticker */}
        <div className="bg-foreground border-y border-background/10 py-3.5 overflow-hidden">
          <div className="flex animate-ticker whitespace-nowrap">
            {[1, 2].map(i => (
              <div key={i} className="flex">
                <span className="text-[10px] tracking-[0.15em] uppercase text-background/40 px-10 border-r border-background/10 shrink-0">
                  ContractSense AI <span className="text-primary">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-background/40 px-10 border-r border-background/10 shrink-0">
                  Risk Discovery <span className="text-primary">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-background/40 px-10 border-r border-background/10 shrink-0">
                  Compliance Automation <span className="text-primary">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-background/40 px-10 border-r border-background/10 shrink-0">
                  Strategy Ledger <span className="text-primary">→</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Contract Analyzer Playground */}
        <div ref={analyzerRef}>
          <AnalyzerPlayground />
        </div>

        {/* Pillars */}
        <Pillars />

        {/* Demo Section */}
        <section ref={demoRef} id="demo" className="py-24 md:py-40 bg-background">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12 text-center">
            <span className="text-[10px] tracking-[0.3em] uppercase text-primary mb-8 block reveal">In Action</span>
            <h2 className="text-[48px] md:text-[80px] font-light leading-none mb-16 reveal reveal-delay-1">
              How <i className="text-primary">ContractSense.ai</i> Helps
            </h2>

            <div className="relative aspect-video max-w-[1000px] mx-auto border border-foreground/10 bg-muted shadow-2xl reveal reveal-delay-2 group overflow-hidden">
              {!isVideoPlaying ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/40 backdrop-blur-sm z-10 transition-opacity group-hover:bg-background/20">
                  <button
                    onClick={() => setIsVideoPlaying(true)}
                    className="w-20 h-20 rounded-full bg-foreground text-background flex items-center justify-center hover:scale-110 transition-transform mb-6"
                  >
                    <Play fill="currentColor" size={24} />
                  </button>
                  <p className="text-[11px] tracking-[0.2em] uppercase opacity-40">Watch Case Study</p>
                </div>
              ) : (
                <video
                  src="/assets/demo.mp4"
                  autoPlay
                  controls
                  className="w-full h-full object-cover"
                  onEnded={() => setIsVideoPlaying(false)}
                />
              )}
              <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          </div>
        </section>

        {/* Process Steps */}
        <ProcessSteps />

        {/* Connectivity */}
        <Connectivity />

        {/* Assessment CTA */}
        <AssessmentCTA />

        {/* The Suite */}
        <Suite />

        {/* Compliance */}
        <Compliance />

        {/* Questionnaire */}
        <Questionnaire />

        {/* Join / CTA */}
        <section className="py-32 md:py-56 bg-background overflow-hidden relative">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12 flex flex-col items-center text-center reveal">
            <h2 className="text-[56px] md:text-[96px] font-light leading-[0.9] tracking-tighter mb-16">
              Enhance Your <i className="text-primary">Workflow</i>
            </h2>
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <button
                onClick={() => setIsContactModalOpen(true)}
                className="bg-foreground text-background px-12 py-5 text-[11px] tracking-[0.15em] uppercase hover:bg-primary transition-colors"
              >
                Get Started →
              </button>
              <Link href="#" className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground hover:text-foreground transition-colors underline underline-offset-8">Explore ContractSense</Link>
            </div>
          </div>
        </section>

      </div>

      <RequestDemoModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />
    </>
  );
}

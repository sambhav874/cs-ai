"use client";

import { motion, useScroll, useSpring, AnimatePresence } from "framer-motion";
import { Instrument_Serif, DM_Mono, Plus_Jakarta_Sans } from "next/font/google";
import Image from "next/image";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Play,
  CheckCircle,
  MapPin,
  MessageSquare,
  Brain,
  User,
  Users,
  FolderArchive,
  BarChart,
  Shield,
  Lock,
  Scale,
  Check,
  Star,
  ChevronRight,
  ChevronLeft,
  FileText,
  Sparkles,
  FolderOpen,
  Command,
  Zap,
  Layers,
  Award,
  X,
  Mail,
  Phone,
  Building,
  BarChart3,
  Clock,
  DollarSign,
  Globe,
  Target,
  TrendingUp,
  Terminal,
  Menu
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useMemo, memo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import RequestDemoModal from "@/components/modals/RequestDemoModal";
import AssessmentCTA from "@/components/AssessmentCTA";


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
  variable: "--font-cormorant",
});

// ─── Hero Animation — React Three Fiber + GLSL ───────────────────────────────
// Mirrors the architecture of the reference DistortedText component:
// a vertex-displaced plane with mouse-reactive ripples + FBM noise,
// and a fragment shader that draws the fluid blobs + wave grid.
// Colour palette: ContractSense blues (#0078d4 / #50b4ff) on transparent bg.

const HERO_VERT = `
  precision highp float;
  varying vec2  vUv;
  varying float vZ;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uReveal;

  void main(){
    vUv = uv;
    vec2 m = uMouse * 0.5 + 0.5;
    float d = distance(uv, m);
    
    // Subtle geometric displacement
    float wave = sin(uv.x * 2.0 + uTime * 0.4) * cos(uv.y * 2.0 + uTime * 0.3) * 0.12;
    float mouseEff = exp(-d * 4.0) * 0.25;
    float z = (wave + mouseEff) * uReveal;
    vZ = z;

    vec3 pos = position;
    pos.z += z * 1.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const HERO_FRAG = `
  precision highp float;
  varying vec2  vUv;
  varying float vZ;
  uniform float uTime;
  uniform vec2  uMouse;
  uniform float uReveal;

  void main(){
    vec2 m = uMouse * 0.5 + 0.5;
    float t = uTime * 0.45;

    // 1. Structural Grid (Data Field)
    vec2 gridScale = vec2(32.0, 48.0);
    vec2 g = fract(vUv * gridScale);
    vec2 id = floor(vUv * gridScale);
    
    // Random prop for "data density"
    float rand = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
    
    // 2. Data Blocks (Small extraction markers)
    float blockW = 0.7;
    float blockH = 0.2 + rand * 0.5;
    float block = step(0.5 - blockW/2.0, g.x) * step(g.x, 0.5 + blockW/2.0) *
                  step(0.5 - blockH/2.0, g.y) * step(g.y, 0.5 + blockH/2.0);
    
    // 3. Scanning Pulse (Vertical sweep)
    float scanPos = fract(t * 0.12);
    float scanLine = smoothstep(scanPos - 0.08, scanPos, vUv.y) * smoothstep(scanPos + 0.08, scanPos, vUv.y);
    
    // 4. Color Palette (ContractSense Blue)
    vec3 blue = vec3(0.00,0.47,0.83);      // #0078d4
    vec3 lightBlue = vec3(0.31,0.71,1.00); // #50b4ff
    
    // Lighting & Composition
    vec3 col = blue * block * 0.08;        // Latent data
    col += lightBlue * block * scanLine * 0.5; // Extraction pulse
    
    // Mouse proximity highlight
    float d = distance(vUv, m);
    col += lightBlue * block * exp(-d * 6.0) * 0.35 * uReveal;
    
    // Scanner aura trail
    col += lightBlue * scanLine * 0.025;

    // Alpha for transparency layer
    float alpha = (block * 0.15 + scanLine * 0.05) * uReveal;
    
    // Distort coloring via vZ
    col *= (1.0 + vZ * 1.8);

    gl_FragColor = vec4(col, alpha * 0.7);
  }
`;

// Inner R3F scene — same pattern as DistortedTextInner in the reference
function HeroScene() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();
  const [reveal, setReveal] = useState(0);
  const smoothMouse = useRef(new THREE.Vector2(0, 0));

  // Reveal animation on mount
  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    const delay = 300, duration = 2000;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const raw = Math.max(0, Math.min(1, (ts - start - delay) / duration));
      // ease-in-out quad
      const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
      setReveal(eased);
      if (raw < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(0, 0) },
    uReveal: { value: 0 },
  }), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = state.clock.getElapsedTime();
    mat.uniforms.uReveal.value = reveal;
    // smooth mouse lag — same technique as reference
    smoothMouse.current.x += (state.mouse.x - smoothMouse.current.x) * 0.035;
    smoothMouse.current.y += (state.mouse.y - smoothMouse.current.y) * 0.035;
    mat.uniforms.uMouse.value.copy(smoothMouse.current);
  });

  return (
    <mesh ref={meshRef}>
      {/* High-res plane so vertex displacement looks smooth */}
      <planeGeometry args={[viewport.width, viewport.height, 160, 80]} />
      <shaderMaterial
        vertexShader={HERO_VERT}
        fragmentShader={HERO_FRAG}
        uniforms={uniforms}
        transparent={true}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

// Public wrapper — stable module-level component, no re-mount on parent render
// ─── Hero Animation — Contract Document Visualization ────────────────────────

function HeroAnimation() {
  const [activeClause, setActiveClause] = useState<string | null>(null);
  const [activeCriterion, setActiveCriterion] = useState("IFRS 15");
  const [mounted, setMounted] = useState(false);
  const docScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const contractData = [
    {
      category: "IFRS 15",
      question: "What is the revenue recognition method?",
      answer: "Revenue recognized over time using the cost-to-cost input method. Progress measured by costs incurred vs. total estimated costs.",
      confidence: "98.2%",
      refId: "9.2",
      tags: ["IFRS 15", "Revenue"],
    },
    {
      category: "Payment Terms",
      question: "What are the advance payment requirements?",
      answer: "Milestone-based payments with a 20% Advance Payment (USD $150M) due upon the Effective Date to fund initial mobilization.",
      confidence: "96.1%",
      refId: "7.3",
      tags: ["Payment", "Obligation"],
    },
    {
      category: "Performance Obligations",
      question: "Are obligations distinct or integrated?",
      answer: "Single integrated performance obligation — design, procurement, and construction phases are highly interdependent.",
      confidence: "99.0%",
      refId: "3.3.2",
      tags: ["IFRS 15", "Scope"],
    },
  ];

  const clauses: Record<string, { section: string; text: React.ReactNode }> = {
    "9.2": {
      section: "Article 9: Financial Provisions",
      text: (
        <>
          <span id="ref-9.2" className="block transition-all duration-700 rounded-sm px-1 -mx-1"
            style={{ background: activeClause === "9.2" ? "rgba(255,220,50,0.45)" : "transparent" }}>
            9.2. Measurement of Progress. Given that control transfers over time, revenue shall be recognized over the construction period relative to the progress made towards satisfaction of the Performance Obligation. The Contractor shall utilize the <strong>cost-to-cost input method</strong> to measure progress.
          </span>
        </>
      ),
    },
    "7.3": {
      section: "Article 7: Liquidated Damages",
      text: (
        <>
          <span id="ref-7.3" className="block transition-all duration-700 rounded-sm px-1 -mx-1"
            style={{ background: activeClause === "7.3" ? "rgba(255,220,50,0.45)" : "transparent" }}>
            7.3. Advance Payment and Mobilization. An Advance Payment representing <strong>twenty percent (20%) of the total Contract Price</strong> (equivalent to USD $150,000,000) shall be payable upon the Effective Date to fund initial mobilization activities.
          </span>
        </>
      ),
    },
    "3.3.2": {
      section: "Article 3: Scope of Services",
      text: (
        <>
          <span id="ref-3.3.2" className="block transition-all duration-700 rounded-sm px-1 -mx-1"
            style={{ background: activeClause === "3.3.2" ? "rgba(255,220,50,0.45)" : "transparent" }}>
            3.3.2. The individual goods and services are <strong>highly interdependent</strong> and represent a complex integration service. As such, the Parties agree that this Agreement comprises a <strong>single, integrated Performance Obligation</strong> for financial reporting purposes.
          </span>
        </>
      ),
    },
  };

  const activeData = contractData.find(d => d.category === activeCriterion)!;
  const activeClauseData = clauses[activeData.refId];

  const handleViewReference = (refId: string) => {
    setActiveClause(refId);
    // Scroll the clause into view inside the doc panel
    setTimeout(() => {
      const el = document.getElementById(`ref-${refId}`);
      if (el && docScrollRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  };

  const tagColors: Record<string, string> = {
    "IFRS 15": "#0078d4",
    Revenue: "#0065b8",
    Payment: "#ba7517",
    Obligation: "#8a5a00",
    Scope: "#1a6b3e",
  };

  return (
    <div id="interactive" className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden" style={{ fontFamily: "InterVar, sans-serif" }}>
      {/* ── WebGL Canvas Background ── */}
      <div className="absolute inset-0 z-0 opacity-30">
        {mounted && (
          <Canvas key="hero-canvas-stable" camera={{ position: [0, 0, 5], fov: 45 }} dpr={[1, 2]}>
            <HeroScene />
          </Canvas>
        )}
      </div>

      <style>{`
        @keyframes cs-scan  { 0%{top:0%;opacity:.7} 100%{top:100%;opacity:0} }
        @keyframes cs-fade  { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
        @keyframes cs-pulse { 0%,100%{opacity:.4} 50%{opacity:1} }
        .cs-scanner { animation: cs-scan 3s linear infinite; }
        .cs-fade    { animation: cs-fade .5s ease both; }
        .cs-pulse   { animation: cs-pulse 2s ease-in-out infinite; }
      `}</style>

      {/* ══════════════════════════════════════
          RIGHT — Analysis / Questionnaire
      ══════════════════════════════════════ */}
      <div className="flex flex-col max-w-[600px] w-full overflow-hidden">

        {/* Category tabs */}
        <div
          className="flex gap-0 flex-shrink-0 mb-5"
          style={{ borderBottom: "0.5px solid rgba(10,10,15,0.1)" }}
        >
          {contractData.map((d) => (
            <button
              key={d.category}
              onClick={() => {
                setActiveCriterion(d.category);
                setActiveClause(null);
              }}
              style={{
                fontSize: "8.5px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                padding: "0 12px 10px",
                borderBottom: activeCriterion === d.category
                  ? "1.5px solid #0078d4"
                  : "1.5px solid transparent",
                color: activeCriterion === d.category ? "#0078d4" : "rgba(10,10,15,0.3)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s ease",
                whiteSpace: "nowrap",
              }}
            >
              {d.category}
            </button>
          ))}
        </div>

        {/* Q&A card */}
        <div
          key={activeCriterion}
          className="cs-fade flex-1 flex flex-col overflow-hidden"
          style={{
            background: "white",
            border: "0.5px solid rgba(10,10,15,0.1)",
            borderRadius: "6px",
            padding: "20px",
          }}
        >
          {/* AI Extraction header */}
          <div className="flex items-center justify-between flex-shrink-0 mb-4">
            <div className="flex items-center gap-2">
              <span style={{ fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#0078d4", fontWeight: 700 }}>
                AI Extraction
              </span>
              <span
                style={{
                  fontSize: "8px",
                  padding: "2px 6px",
                  background: "rgba(30,130,76,0.08)",
                  color: "#1a6b3e",
                  border: "0.5px solid rgba(30,130,76,0.2)",
                  borderRadius: "3px",
                  letterSpacing: "0.06em",
                }}
              >
                {activeData.confidence} confidence
              </span>
            </div>

            {/* View Reference button */}
            <button
              onClick={() => handleViewReference(activeData.refId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                fontSize: "8px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: activeClause === activeData.refId ? "#fff" : "#0078d4",
                background: activeClause === activeData.refId ? "#0078d4" : "rgba(0,120,212,0.07)",
                border: "0.5px solid rgba(0,120,212,0.3)",
                borderRadius: "3px",
                padding: "4px 10px",
                cursor: "pointer",
                transition: "all 0.25s ease",
              }}
            >
              {/* Play icon */}
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <path d="M2 1l5 3-5 3V1z" />
              </svg>
              View Reference §{activeData.refId}
            </button>
          </div>

          {/* Divider */}
          <div style={{ height: "0.5px", background: "rgba(10,10,15,0.07)", marginBottom: "16px", flexShrink: 0 }} />

          {/* Question */}
          <div
            style={{
              fontSize: "8px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(10,10,15,0.35)",
              marginBottom: "8px",
              flexShrink: 0,
            }}
          >
            Question
          </div>
          <p
            style={{
              fontSize: "13px",
              lineHeight: 1.6,
              color: "rgba(10,10,15,0.85)",
              fontFamily: "InterVar, sans-serif",
              fontStyle: "italic",
              marginBottom: "16px",
              flexShrink: 0,
            }}
          >
            {activeData.question}
          </p>

          {/* Answer */}
          <div
            style={{
              fontSize: "8px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(10,10,15,0.35)",
              marginBottom: "8px",
              flexShrink: 0,
            }}
          >
            AI Answer
          </div>
          <p
            style={{
              fontSize: "11.5px",
              lineHeight: 1.8,
              color: "rgba(10,10,15,0.65)",
              marginBottom: "16px",
              flexShrink: 0,
            }}
          >
            {activeData.answer}
          </p>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5 flex-shrink-0 mb-5">
            {activeData.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: "8px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  padding: "2px 8px",
                  borderRadius: "3px",
                  color: tagColors[tag] ?? "#0078d4",
                  background: `${tagColors[tag] ?? "#0078d4"}15`,
                  border: `0.5px solid ${tagColors[tag] ?? "#0078d4"}35`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Divider */}
          <div style={{ height: "0.5px", background: "rgba(10,10,15,0.07)", marginBottom: "14px", flexShrink: 0 }} />

          {/* Citation block */}
          <div
            style={{
              fontSize: "8px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(10,10,15,0.35)",
              marginBottom: "8px",
              flexShrink: 0,
            }}
          >
            Source Clause §{activeData.refId}
          </div>
          <div
            style={{
              flex: 1,
              background: "#f9f8f4",
              border: "0.5px solid rgba(10,10,15,0.08)",
              borderLeft: "2px solid #0078d4",
              borderRadius: "0 4px 4px 0",
              padding: "12px 14px",
              fontSize: "10px",
              lineHeight: 1.85,
              color: "rgba(10,10,15,0.6)",
              fontFamily: "Georgia, serif",
              overflow: "hidden",
            }}
          >
            {activeClauseData.text}
          </div>

          {/* Confidence bar */}
          <div style={{ marginTop: "14px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
              <span style={{ fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(10,10,15,0.3)" }}>
                Extraction confidence
              </span>
              <span style={{ fontSize: "8px", color: "#0078d4", fontWeight: 500 }}>{activeData.confidence}</span>
            </div>
            <div style={{ height: "2px", background: "rgba(10,10,15,0.07)", borderRadius: "2px", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: activeData.confidence,
                  background: "#0078d4",
                  borderRadius: "2px",
                  transition: "width 0.8s ease",
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


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

  const [currentStep, setCurrentStep] = useState(1);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const demoRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const analyzerRef = useRef<HTMLDivElement>(null);

  const [activeCriterion, setActiveCriterion] = useState("IFRS 15");
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const ringPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setIsClient(true);
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    if (!isClient) return;
    const animRing = () => {
      ringPos.current.x += (mouseRef.current.x - ringPos.current.x) * 0.12;
      ringPos.current.y += (mouseRef.current.y - ringPos.current.y) * 0.12;

      if (ringRef.current) {
        ringRef.current.style.left = `${ringPos.current.x}px`;
        ringRef.current.style.top = `${ringPos.current.y}px`;
      }
      if (cursorRef.current) {
        cursorRef.current.style.left = `${mouseRef.current.x}px`;
        cursorRef.current.style.top = `${mouseRef.current.y}px`;
      }
      requestAnimationFrame(animRing);
    };
    const animationFrame = requestAnimationFrame(animRing);
    return () => cancelAnimationFrame(animationFrame);
  }, [isClient]);

  useEffect(() => {
    const reveals = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); }
      });
    }, { threshold: 0.15 });
    reveals.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [isClient]);

  const handleMouseEnter = () => {
    if (cursorRef.current && ringRef.current) {
      cursorRef.current.style.width = '20px';
      cursorRef.current.style.height = '20px';
      ringRef.current.style.width = '60px';
      ringRef.current.style.height = '60px';
    }
  };

  const handleMouseLeave = () => {
    if (cursorRef.current && ringRef.current) {
      cursorRef.current.style.width = '12px';
      cursorRef.current.style.height = '12px';
      ringRef.current.style.width = '40px';
      ringRef.current.style.height = '40px';
    }
  };

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

  if (!isClient) return null;

  return (
    <>
      <div className={cn("bg-[#f5f3ee] text-[#0a0a0f] selection:bg-[#0078d4] selection:text-white min-h-screen relative", dmMono.variable, instrument.variable, plusJakartaSans.variable)} style={{ fontFamily: "InterVar, sans-serif" }}>
        {/* Progress Bar */}
        <motion.div
          className="fixed top-0 left-0 right-0 h-[2px] bg-[#0078d4] z-[200] origin-left"
          style={{ scaleX }}
        />

        {/* Custom Cursor */}
        <div ref={cursorRef} className="custom-cursor pointer-events-none hidden md:block" />
        <div ref={ringRef} className="custom-cursor-ring pointer-events-none hidden md:block" />

        {/* Nav */}
        <nav className="fixed top-0 left-0 right-0 z-[100] px-6 py-6 md:px-12 md:py-8 flex justify-between items-center transition-all duration-500 bg-white/10 backdrop-blur-md border-b border-black/5">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
              <Image src="/logo.png" alt="ContractSense Logo" width={32} height={32} className="object-contain" />
              <span className=" font-extrabold text-sm tracking-[0.15em] uppercase">ContractSense<span className="text-[#0078d4]">.ai</span></span>
            </Link>
            <div className="hidden sm:block w-[1px] h-4 bg-[rgba(10,10,15,0.1)]" />
            <Link
              href="https://ninthquadrant.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-2 group transition-opacity opacity-40 hover:opacity-100"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
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
                  className="text-[10px] tracking-[0.25em]  font-bold uppercase hover:text-[#0078d4] transition-colors"
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 text-black/60 hover:text-black transition-colors"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <button
              onClick={() => setIsContactModalOpen(true)}
              className="hidden sm:inline-flex bg-[#0a0a0f] text-[#f5f3ee] px-6 py-3 text-[9px]  font-bold tracking-[0.2em] uppercase hover:bg-[#0078d4] transition-all"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
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
              className="fixed inset-0 z-[90] bg-[#fcfbf9] lg:hidden flex flex-col pt-32 px-12"
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
                      className="text-2xl  italic flex items-center justify-between group"
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
                  className="w-full bg-[#0a0a0f] text-[#f5f3ee] py-6 text-[11px]  font-bold tracking-[0.2em] uppercase"
                >
                  Request Demo
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Hero */}
        <section className="min-h-screen pt-20 relative overflow-hidden flex flex-col justify-center" id="home">
          <div className="absolute top-[-200px] right-[-200px] w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(0,120,212,0.06)_0%,transparent_70%)] pointer-events-none" />

            <div className="flex flex-col items-center justify-center text-center max-w-[1000px] mx-auto h-full px-4">
              <div className="reveal flex flex-col items-center">
                <h1 className="text-[clamp(48px,8vw,140px)] font-light leading-[0.9] tracking-[-0.04em] mb-12">
                  <i className="text-[#0078d4]">Contract</i> Intelligence
                </h1>
                <p className="text-[17px] md:text-[19px] leading-[1.8] opacity-65 max-w-[700px] mb-14 tracking-[0.02em] italic">
                  Precision-engineered contract intelligence for high-stakes finance. Surface key obligations and automate compliance with verifiable AI.
                </p>
                <div className="flex flex-wrap justify-center gap-6 items-center">
                  <button
                    onClick={() => demoRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="bg-[#0a0a0f] text-[#f5f3ee] px-12 py-5 text-[11px] tracking-[0.12em] uppercase hover:bg-[#0078d4] transition-colors shadow-xl"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    Watch Demo
                  </button>
                  <button
                    onClick={() => analyzerRef.current?.scrollIntoView({ behavior: 'smooth' })}
                    className="bg-white px-12 py-5 text-[11px] tracking-[0.12em] uppercase border border-[rgba(10,10,15,0.12)] hover:border-[#0078d4] hover:text-[#0078d4] transition-all shadow-sm"
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    Interactive Analysis
                  </button>
                </div>
              </div>
            </div>
        </section>

        {/* Ticker */}
        <div className="bg-[#0a0a0f] border-y border-[rgba(10,10,15,0.12)] py-3.5 overflow-hidden">
          <div className="flex animate-ticker whitespace-nowrap">
            {[1, 2].map(i => (
              <div key={i} className="flex">
                <span className="text-[10px] tracking-[0.15em] uppercase text-white/40 px-10 border-r border-white/10 shrink-0">
                  ContractSense AI <span className="text-[#0078d4]">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-white/40 px-10 border-r border-white/10 shrink-0">
                  Risk Discovery <span className="text-[#0078d4]">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-white/40 px-10 border-r border-white/10 shrink-0">
                  Compliance Automation <span className="text-[#0078d4]">→</span>
                </span>
                <span className="text-[10px] tracking-[0.15em] uppercase text-white/40 px-10 border-r border-white/10 shrink-0">
                  Strategy Ledger <span className="text-[#0078d4]">→</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Contract Analyzer Playground */}
        <section className="py-24 md:py-48 bg-white border-y border-[rgba(10,10,15,0.08)]" ref={analyzerRef} id="interactive">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="flex flex-col md:flex-row justify-between items-end mb-24 gap-8 reveal">
              <div className="max-w-[600px]">
                <span className=" text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block">Interactive Playground</span>
                <h2 className=" text-[48px] md:text-[80px] font-light leading-[0.9] tracking-tighter">
                  The <i className="text-[#0078d4]">Analyzer</i>
                </h2>
              </div>
              <p className="text-[13px] opacity-40 uppercase tracking-[0.2em] max-w-[300px] leading-relaxed">
                Click a citation in the analysis to reveal its ground truth in the document.
              </p>
            </div>

            <div className="relative z-10 flex-1 grid grid-cols-1 lg:grid-cols-2 gap-8 p-6 lg:p-12 overflow-y-auto lg:overflow-visible">
              {/* Document Section */}
              <div className={cn(
                "bg-white/95 backdrop-blur-sm shadow-2xl p-6 lg:p-12 flex flex-col border border-[rgba(10,10,15,0.08)]",
                "h-[400px] lg:h-auto"
              )}>
                <div className="flex justify-between items-center mb-6 px-2">
                  <div className="flex gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-400/20" />
                    <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/20" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-400/20" />
                  </div>
                  <span className="text-[9px] font-dm-mono opacity-30 uppercase tracking-[0.2em]">Infrastructure_Agreement_v4.pdf</span>
                  <span className="text-[9px] font-dm-mono opacity-30 uppercase">Page 1 of 5</span>
                </div>

                <div className="flex-1 bg-[#f5f3ee] border border-[rgba(10,10,15,0.1)] shadow-2xl overflow-hidden relative group">
                  <div className="absolute inset-0 overflow-y-auto scrollbar-hide py-16 px-12 md:px-20 space-y-24 scroll-smooth" ref={pdfContainerRef}>
                    {/* Page 1 */}
                    <div id="page-1" className="relative pb-24 border-b border-[rgba(10,10,15,0.05)]">
                      <span className="absolute -left-8 top-0 text-[10px] font-dm-mono opacity-20">01</span>
                      <h4 className=" font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-black pb-4">Article 9: Financial Provisions</h4>
                      <p className=" text-[15px] leading-[1.8] text-black/80 space-y-6">
                        <span className={cn("inline transition-all duration-700", selectedCitation === "9.2" ? "bg-yellow-200/80 text-black px-1 -mx-1" : "")}>
                          9.2. Measurement of Progress. Given that control transfers over time, revenue shall be recognized over the construction period relative to the progress made towards satisfaction of the Performance Obligation. The Contractor shall utilize the cost-to-cost input method to measure progress.
                        </span>
                        <br /><br />
                        9.3. Billing and Payment. Invoices shall be submitted monthly based on progress certificates approved by the Owner's Representative. Payments shall be remitted within thirty (30) days of receipt of a valid and undisputed invoice.
                        <br /><br />
                        9.4. Milestone Schedule. The following billing milestones are established for the initial phase: (a) Effective Date - 20%; (b) Detailed Design Approval - 10%; (c) Procurement Completion - 15%;.
                      </p>
                    </div>

                    {/* Page 2 */}
                    <div id="page-2" className="relative py-24 border-b border-[rgba(10,10,15,0.05)]">
                      <span className="absolute -left-8 top-24 text-[10px] font-dm-mono opacity-20">02</span>
                      <h4 className=" font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-black pb-4">Article 3: Scope of Services</h4>
                      <p className=" text-[15px] leading-[1.8] text-black/80">
                        3.3. Performance Obligations. The Services shall be performed as a unified sequence of engineering and construction activities.
                        <br /><br />
                        <span className={cn("inline transition-all duration-700", selectedCitation === "3.3.2" ? "bg-yellow-200/80 text-black px-1 -mx-1" : "")}>
                          3.3.2. The individual goods and services are highly interdependent and represent a complex integration service. As such, the Parties agree that this Agreement comprises a single, integrated Performance Obligation for financial reporting purposes.
                        </span>
                        <br /><br />
                        3.4. Exclusions. The following activities are excluded from the Scope of Services...
                      </p>
                    </div>

                    {/* Page 3 */}
                    <div id="page-3" className="relative py-24 border-b border-[rgba(10,10,15,0.05)]">
                      <span className="absolute -left-8 top-24 text-[10px] font-dm-mono opacity-20">03</span>
                      <h4 className=" font-bold text-[14px] uppercase tracking-widest mb-12 border-b border-black pb-4">Article 7: Liquidated Damages</h4>
                      <p className=" text-[15px] leading-[1.8] text-black/80">
                        7.1. Delay in Completion. If the Contractor fails to achieve Substantial Completion by the Milestone Date...
                        <br /><br />
                        7.2. Limitation of Liability. The total aggregate liability for liquidated damages shall not exceed ten percent (10%) of the Contract Price.
                        <br /><br />
                        <span className={cn("inline transition-all duration-700", selectedCitation === "7.3" ? "bg-yellow-200/80 text-black px-1 -mx-1" : "")}>
                          7.3. Advance Payment and Mobilization. An Advance Payment representing twenty percent (20%) of the total Contract Price (equivalent to USD $150,000,000) shall be payable upon the Effective Date to fund initial mobilization.
                        </span>
                      </p>
                    </div>

                    {/* Faded pages for stack effect */}
                    <div className="h-64 opacity-10 flex flex-col justify-center items-center gap-4">
                      <div className="w-full h-1 bg-black/20" />
                      <div className="w-3/4 h-1 bg-black/20" />
                      <span className="text-[10px] font-dm-mono uppercase">Page 4 & 5 (End of Document)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Analysis View - AI Inspector */}
              <div className="reveal reveal-delay-2 flex flex-col gap-10">
                <div className="flex gap-4 border-b border-[rgba(10,10,15,0.08)] pb-8">
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
                        activeCriterion === cat ? "text-[#0078d4] border-b-2 border-[#0078d4]" : "opacity-30 hover:opacity-100"
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
                          <span className="text-[10px] tracking-[0.2em] uppercase font-bold text-[#0078d4]">AI Extraction</span>
                          <span className="text-[9px] font-dm-mono px-2 py-0.5 bg-green-500/10 text-green-600 rounded-sm">98.2% Confidence</span>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedCitation(data.refId);
                            const el = document.getElementById(`page-${data.page}`);
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                          className="flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase text-[#0078d4] hover:underline"
                        >
                          <Play size={10} fill="currentColor" /> View Reference
                        </button>
                      </div>
                      <h3 className=" text-[32px] leading-tight">{data.question}</h3>
                      <p className="text-[14px] leading-relaxed opacity-60 italic">{data.answer}</p>
                    </div>

                    <div className="p-8 bg-white border border-[rgba(10,10,15,0.05)] shadow-sm">
                      <div className="flex items-center gap-3 mb-6">
                        <Brain size={16} className="text-[#0078d4]" />
                        <span className="text-[10px] tracking-[0.2em] uppercase font-bold">Analysis Context</span>
                      </div>
                      <p className="text-[13px] opacity-60 leading-relaxed mb-6">"{data.reason}"</p>
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2 text-[9px] font-dm-mono opacity-40 uppercase">
                          <Terminal size={12} /> Standards Log: 4.2.1
                        </div>
                        <div className="flex items-center gap-2 text-[9px] font-dm-mono opacity-40 uppercase">
                          <Layers size={12} /> Model: CS-REASONER-V2
                        </div>
                      </div>
                    </div>

                    <div className="p-8 bg-[#0a0a0f] text-white rounded-sm group relative overflow-hidden">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-[#0078d4]/20 blur-3xl group-hover:bg-[#0078d4]/40 transition-colors" />
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center">
                          <Shield size={14} className="text-[#0078d4]" />
                        </div>
                        <span className="text-[10px] tracking-[0.2em] uppercase text-white/40">Verifiable Extraction</span>
                      </div>
                      <p className="text-[12px] opacity-60 italic leading-relaxed">
                        Citied directly from <span className="text-[#50b4ff] underline underline-offset-4 cursor-pointer" onClick={() => {
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


        {/* Pillars */}
        <section id="pillars" className="py-24 md:py-40 border-b border-[rgba(10,10,15,0.08)] bg-white/40">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-24">
              {[
                { num: "01", title: "Human-Centricity", desc: "Technology should amplify, not replace, the human spark.", tag: "Augmented Intelligence" },
                { num: "02", title: "Radical Transparency", desc: "Risk should be surfaced, explained, and understood by all.", tag: "Explainability" },
                { num: "03", title: "Scalable Precision", desc: "Complexity is a challenge to be mastered, not an excuse for error.", tag: "Precision Engineering" }
              ].map((pillar, i) => (
                <div key={pillar.num} className={cn("reveal", i === 1 && "reveal-delay-1", i === 2 && "reveal-delay-2")}>
                  <h3 className=" font-semibold text-[10px] tracking-[0.2em] uppercase mb-8 text-[#0078d4]">Principle {pillar.num}</h3>
                  <p className=" text-[28px] md:text-[34px] leading-[1.2] mb-10 font-light italic">"{pillar.desc}"</p>
                  <div className="flex items-center gap-3">
                    <span className="w-4 h-[1px] bg-[#0a0a0f]/20" />
                    <p className="text-[10px] opacity-50 uppercase tracking-[0.1em] font-medium">{pillar.tag}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>


        {/* Demo Section */}
        <section ref={demoRef} id="demo" className="py-24 md:py-40 bg-white">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12 text-center">
            <span className=" text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block reveal">In Action</span>
            <h2 className=" text-[48px] md:text-[80px] font-light leading-none mb-16 reveal reveal-delay-1">
              How <i className="text-[#0078d4]">ContractSense.ai</i> Helps
            </h2>

            <div className="relative aspect-video max-w-[1000px] mx-auto border border-[rgba(10,10,15,0.08)] bg-[#f5f3ee] shadow-2xl reveal reveal-delay-2 group overflow-hidden">
              {!isVideoPlaying ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-sm z-10 transition-opacity group-hover:bg-white/20">
                  <button
                    onClick={() => setIsVideoPlaying(true)}
                    className="w-20 h-20 rounded-full bg-[#0a0a0f] text-white flex items-center justify-center hover:scale-110 transition-transform mb-6"
                  >
                    <Play fill="white" size={24} />
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
              <div className="absolute inset-0 bg-[#0078d4]/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </div>
          </div>
        </section>

        {/* How it Works / Steps */}
        <section ref={stepsRef} className="py-24 md:py-40 bg-[#f5f3ee]">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-16 items-start">
              <div className="md:col-span-4 reveal">
                <span className=" text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block">The Process</span>
                <h2 className=" text-[40px] md:text-[52px] font-light leading-tight mb-8">
                  Three Steps to <br />
                  <i className="text-[#0078d4]">Contract Intelligence</i>
                </h2>
                <div className="w-12 h-[1px] bg-[#0a0a0f]/20 mb-8" />
                <p className="text-[12px] opacity-50 leading-relaxed max-w-[300px]">
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
                      "w-10 h-10 rounded-full border border-[rgba(10,10,15,0.1)] flex items-center justify-center text-[11px] font-mono mb-8 transition-colors duration-500",
                      currentStep === step.id ? "bg-[#0a0a0f] text-[#f5f3ee]" : "text-[#0a0a0f]/30"
                    )}>
                      0{step.id}
                    </div>
                    <h3 className=" font-semibold text-[11px] tracking-[0.1em] uppercase mb-4">{step.title}</h3>
                    <p className="text-[12px] opacity-40 leading-relaxed">{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Data Connectivity & Tracking */}
        <section className="py-24 md:py-40 bg-white border-y border-[rgba(10,10,15,0.08)]">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center">
              <div className="reveal">
                <span className=" text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block">Connectivity</span>
                <h2 className=" text-[48px] md:text-[64px] font-light leading-none mb-12">
                  Unified <i className="text-[#0078d4]">Data</i> Streams
                </h2>
                <p className="text-[13px] leading-[1.8] opacity-60 mb-12 max-w-[480px]">
                  ContractSense.ai doesn't live in a vacuum. We ingest directly from your ERPs, data streams, and active file stores to track contract performance in real-time.
                </p>
                <div className="space-y-8">
                  {[
                    { title: "ERP & API Ingest", desc: "Seamless sync with Oracle, SAP, and custom REST APIs for high-volume ingestion.", icon: Globe },
                    { title: "Invoice & File Streams", desc: "Automated analysis of incoming invoices, remittance, and legal file ingests.", icon: Mail },
                    { title: "Omni-Source Tracking", desc: "Monitor milestones and obligations across disparate data sources in real-time.", icon: BarChart3 }
                  ].map((item, i) => (
                    <div key={item.title} className="flex gap-6 items-start">
                      <div className="w-10 h-10 rounded-full bg-[#f5f3ee] flex items-center justify-center shrink-0">
                        <item.icon size={16} className="text-[#0078d4]" />
                      </div>
                      <div>
                        <h4 className=" font-bold text-[11px] tracking-[0.1em] uppercase mb-2">{item.title}</h4>
                        <p className="text-[12px] opacity-40 max-w-[320px]">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative reveal reveal-delay-2">
                <div className="bg-[#0a0a0f] p-8 md:p-12 rounded-sm shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(0,120,212,0.2)_0%,transparent_70%)]" />
                  <div className="flex justify-between items-center mb-12">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-[10px] tracking-[0.2em] uppercase text-white/50">Live Stream: ERP_CONNECT_V4</span>
                    </div>
                    <span className="text-[9px] font-dm-mono text-white/20">00:42:12</span>
                  </div>
                  <div className="space-y-6">
                    {[
                      { label: "Contract Value", val: "$750,000,000", textColor: "text-white" },
                      { label: "Milestones Reached", val: "14 / 22", textColor: "text-[#50b4ff]" },
                      { label: "Pending Obligations", val: "03 Critical", textColor: "text-white" }
                    ].map((stat, i) => (
                      <div key={stat.label} className="border-b border-white/10 pb-6">
                        <span className="text-[9px] tracking-[0.1em] uppercase text-white/50 block mb-2">{stat.label}</span>
                        <span className={cn(
                          "text-[28px] font-dm-mono font-bold",
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
                    <div key={i} className="w-1 h-1 bg-[#0a0a0f] rounded-full" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Assessment CTA */}
        <AssessmentCTA />

        {/* The Suite */}
        <section id="suite" className="py-24 md:py-40 bg-white">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="flex flex-col md:flex-row justify-between items-end mb-20 gap-8 reveal">
              <h2 className=" text-[48px] md:text-[64px] font-light leading-none tracking-tight">
                The <i className="text-[#0078d4]">Suite</i>
              </h2>
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-40 max-w-[300px] leading-relaxed">
                Specialized intelligence for high-velocity enterprise capital.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[rgba(10,10,15,0.08)] border border-[rgba(10,10,15,0.08)]">
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
                <div key={product.num} className="bg-[#f5f3ee] p-12 group hover:bg-white transition-colors duration-500 reveal">
                  <div className="flex justify-between items-start mb-12">
                    <span className="font-dm-mono text-[10px] tracking-[0.2em] opacity-30">{product.num}</span>
                    <span className="text-[9px] tracking-[0.15em] uppercase px-3 py-1 border border-[rgba(10,10,15,0.1)] rounded-full opacity-60">{product.tag}</span>
                  </div>
                  <h3 className=" text-[32px] mb-6 group-hover:text-[#0078d4] transition-colors">{product.title}</h3>
                  <p className="text-[12px] leading-[1.8] opacity-60">{product.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Reporting & Audit Trails */}
        <section id="compliance" className="py-24 md:py-48 bg-[#0a0a0f] text-[#f5f3ee] overflow-hidden relative">
          <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(0,120,212,0.1)_0%,transparent_70%)] opacity-30 pointer-events-none" />

          <div className="max-w-[1240px] mx-auto px-6 md:px-12 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-24 items-center mb-32">
              <div className="reveal">
                <span className=" text-[10px] tracking-[0.3em] uppercase text-[#50b4ff] mb-8 block">Reporting & Audits</span>
                <h2 className=" text-[48px] md:text-[80px] font-light leading-[0.9] tracking-tighter mb-12">
                  Verifiable <i className="text-[#50b4ff]">Compliance</i>
                </h2>
                <div className="space-y-12">
                  <div>
                    <h4 className=" font-bold text-[13px] tracking-[0.1em] uppercase mb-4 text-[#50b4ff]">Standard-Specific Reporting</h4>
                    <p className="text-[13px] opacity-60 leading-relaxed max-w-[440px]">
                      Generate instantaneous IFRS 15 5-step reports, SOX benchmarks, and multi-contract aggregate risk profiles in a single click.
                    </p>
                  </div>
                  <div>
                    <h4 className=" font-bold text-[13px] tracking-[0.1em] uppercase mb-4 text-[#50b4ff]">Org-Wide Audit Logs</h4>
                    <p className="text-[13px] opacity-60 leading-relaxed max-w-[440px]">
                      Complete transparency into who accessed, reviewed, or approved every contract. Track report generation and system processing timestamps globally.
                    </p>
                  </div>
                </div>
              </div>

              <div className="reveal reveal-delay-2 p-8 bg-white/5 border border-white/10 rounded-sm backdrop-blur-sm shadow-2xl">
                <div className="flex justify-between items-center mb-10 border-b border-white/10 pb-6">
                  <div className="flex items-center gap-3">
                    <Shield size={18} className="text-[#50b4ff]" />
                    <span className="text-[10px] tracking-[0.2em] uppercase font-bold">Audit Certificate V4</span>
                  </div>
                  <span className="text-[9px] font-dm-mono opacity-40">HASH: 0x82f...a1c</span>
                </div>
                <div className="space-y-6 mb-10 text-[11px] font-dm-mono">
                  <div className="flex justify-between py-3 border-b border-white/5">
                    <span className="opacity-40 uppercase">Processor Status</span>
                    <span className="text-[#50b4ff]">Active (Multiple Orgs)</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-white/5">
                    <span className="opacity-40 uppercase">Approval Chain</span>
                    <span className="text-green-400">Verified by CFO_User_01</span>
                  </div>
                  <div className="flex justify-between py-3 border-b border-white/5">
                    <span className="opacity-40 uppercase">IFRS 15 5-Step Report</span>
                    <span className="text-[#50b4ff]">Generated</span>
                  </div>
                </div>
                <button className="w-full py-4 bg-[#50b4ff] text-[#0a0a0f] text-[10px] font-bold tracking-[0.2em] uppercase hover:bg-white transition-colors">
                  Generate Full Audit Report
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Questionnaire Section */}
        <section className="py-24 md:py-40 bg-white border-b border-[rgba(10,10,15,0.08)]">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12">
            <div className="text-center mb-24 reveal">
              <span className=" text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block">Inquiry Assistance</span>
              <h2 className=" text-[48px] md:text-[64px] font-light leading-none mb-8">
                The <i className="text-[#0078d4]">Suggestion</i> Engine
              </h2>
              <p className="text-[13px] opacity-40 uppercase tracking-[0.2em] max-w-[500px] mx-auto">
                Automatic inquiry generation based on contract type and regulatory context.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 reveal reveal-delay-1">
              {[
                { title: "Question Generation", desc: "Whenever a question is created, the AI provides well-prompted suggestions for mapping and extraction." },
                { title: "Dynamic Logic", desc: "Suggestions evolve in real-time as the engine learns the specific nuances of your organizational legal standards." },
                { title: "Refined Q&A", desc: "Automatically generate high-precision inquiries tailored to the specific contract context." }
              ].map((item, i) => (
                <div key={item.title} className="p-10 border border-[rgba(10,10,15,0.05)] bg-[#f5f3ee] hover:bg-white transition-all group">
                  <div className="w-8 h-8 rounded-full border border-[#0078d4]/20 flex items-center justify-center mb-8 group-hover:bg-[#0078d4] transition-colors">
                    <Sparkles size={14} className="text-[#0078d4] group-hover:text-white" />
                  </div>
                  <h4 className=" font-bold text-[11px] tracking-[0.1em] uppercase mb-6 leading-tight">{item.title}</h4>
                  <p className="text-[12px] opacity-50 leading-relaxed mb-8">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Join / CTA */}
        <section className="py-32 md:py-56 bg-white overflow-hidden relative">
          <div className="max-w-[1240px] mx-auto px-6 md:px-12 flex flex-col items-center text-center reveal">
            <h2 className=" text-[56px] md:text-[96px] font-light leading-[0.9] tracking-tighter mb-16">
              Enhance Your <i className="text-[#0078d4]">Workflow</i>
            </h2>
            <div className="flex flex-col md:flex-row gap-8 items-center">
              <button
                onClick={() => setIsContactModalOpen(true)}
                className="bg-[#0a0a0f] text-[#f5f3ee] px-12 py-5 text-[11px] tracking-[0.15em] uppercase hover:bg-[#0078d4] transition-colors"
                onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
              >
                Get Started →
              </button>
              <Link href="#" className="text-[11px] tracking-[0.12em] uppercase opacity-40 hover:opacity-100 transition-opacity underline underline-offset-8">Explore ContractSense</Link>
            </div>
          </div>
        </section>

        {/* Footer */}
      </div>

      <RequestDemoModal
        isOpen={isContactModalOpen}
        onClose={() => setIsContactModalOpen(false)}
      />
    </>
  );
}

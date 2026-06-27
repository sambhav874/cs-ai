"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Play } from "lucide-react";
import { cn } from "@/lib/utils";

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

    vec2 gridScale = vec2(32.0, 48.0);
    vec2 g = fract(vUv * gridScale);
    vec2 id = floor(vUv * gridScale);
    
    float rand = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
    
    float blockW = 0.7;
    float blockH = 0.2 + rand * 0.5;
    float block = step(0.5 - blockW/2.0, g.x) * step(g.x, 0.5 + blockW/2.0) *
                  step(0.5 - blockH/2.0, g.y) * step(g.y, 0.5 + blockH/2.0);
    
    float scanPos = fract(t * 0.12);
    float scanLine = smoothstep(scanPos - 0.08, scanPos, vUv.y) * smoothstep(scanPos + 0.08, scanPos, vUv.y);
    
    vec3 blue = vec3(0.00,0.47,0.83);      
    vec3 lightBlue = vec3(0.31,0.71,1.00); 
    
    vec3 col = blue * block * 0.08;        
    col += lightBlue * block * scanLine * 0.5; 
    
    float d = distance(vUv, m);
    col += lightBlue * block * exp(-d * 6.0) * 0.35 * uReveal;
    
    col += lightBlue * scanLine * 0.025;

    float alpha = (block * 0.15 + scanLine * 0.05) * uReveal;
    
    col *= (1.0 + vZ * 1.8);

    gl_FragColor = vec4(col, alpha * 0.7);
  }
`;

function HeroScene() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { viewport } = useThree();
  const [reveal, setReveal] = useState(0);
  const smoothMouse = useRef(new THREE.Vector2(0, 0));

  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    const delay = 300, duration = 2000;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const raw = Math.max(0, Math.min(1, (ts - start - delay) / duration));
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
    smoothMouse.current.x += (state.mouse.x - smoothMouse.current.x) * 0.035;
    smoothMouse.current.y += (state.mouse.y - smoothMouse.current.y) * 0.035;
    mat.uniforms.uMouse.value.copy(smoothMouse.current);
  });

  return (
    <mesh ref={meshRef}>
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

export function HeroAnimation() {
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
          <span id="ref-9.2" className={cn("block transition-all duration-700 rounded-sm px-1 -mx-1", activeClause === "9.2" ? "bg-yellow-400/45" : "bg-transparent")}>
            9.2. Measurement of Progress. Given that control transfers over time, revenue shall be recognized over the construction period relative to the progress made towards satisfaction of the Performance Obligation. The Contractor shall utilize the <strong>cost-to-cost input method</strong> to measure progress.
          </span>
        </>
      ),
    },
    "7.3": {
      section: "Article 7: Liquidated Damages",
      text: (
        <>
          <span id="ref-7.3" className={cn("block transition-all duration-700 rounded-sm px-1 -mx-1", activeClause === "7.3" ? "bg-yellow-400/45" : "bg-transparent")}>
            7.3. Advance Payment and Mobilization. An Advance Payment representing <strong>twenty percent (20%) of the total Contract Price</strong> (equivalent to USD $150,000,000) shall be payable upon the Effective Date to fund initial mobilization activities.
          </span>
        </>
      ),
    },
    "3.3.2": {
      section: "Article 3: Scope of Services",
      text: (
        <>
          <span id="ref-3.3.2" className={cn("block transition-all duration-700 rounded-sm px-1 -mx-1", activeClause === "3.3.2" ? "bg-yellow-400/45" : "bg-transparent")}>
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
    setTimeout(() => {
      const el = document.getElementById(`ref-${refId}`);
      if (el && docScrollRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  };

  return (
    <div id="interactive" className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden font-sans">
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

      <div className="flex flex-col max-w-[600px] w-full overflow-hidden">
        <div className="flex gap-0 flex-shrink-0 mb-5 border-b border-foreground/10">
          {contractData.map((d) => (
            <button
              key={d.category}
              onClick={() => {
                setActiveCriterion(d.category);
                setActiveClause(null);
              }}
              className={cn(
                "text-[8.5px] tracking-[0.14em] uppercase px-3 pb-2.5 transition-all whitespace-nowrap",
                activeCriterion === d.category
                  ? "border-b-[1.5px] border-primary text-primary"
                  : "border-b-[1.5px] border-transparent text-foreground/30 hover:text-foreground/50"
              )}
            >
              {d.category}
            </button>
          ))}
        </div>

        <div
          key={activeCriterion}
          className="cs-fade flex-1 flex flex-col overflow-hidden bg-background border border-foreground/10 rounded-md p-5"
        >
          <div className="flex items-center justify-between flex-shrink-0 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-[8px] tracking-[0.18em] uppercase text-primary font-bold">
                AI Extraction
              </span>
              <span className="text-[8px] px-1.5 py-0.5 bg-green-500/10 text-green-700 border border-green-500/20 rounded-sm tracking-[0.06em]">
                {activeData.confidence} confidence
              </span>
            </div>

            <button
              onClick={() => handleViewReference(activeData.refId)}
              className={cn(
                "flex items-center gap-1.5 text-[8px] tracking-[0.1em] uppercase rounded-sm px-2.5 py-1 transition-all border",
                activeClause === activeData.refId 
                  ? "text-primary-foreground bg-primary border-primary" 
                  : "text-primary bg-primary/5 border-primary/30 hover:bg-primary/10"
              )}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                <path d="M2 1l5 3-5 3V1z" />
              </svg>
              View Reference §{activeData.refId}
            </button>
          </div>

          <div className="h-[0.5px] bg-foreground/5 mb-4 flex-shrink-0" />

          <div className="text-[8px] tracking-[0.14em] uppercase text-muted-foreground mb-2 flex-shrink-0">
            Question
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/85 font-sans italic mb-4 flex-shrink-0">
            {activeData.question}
          </p>

          <div className="text-[8px] tracking-[0.14em] uppercase text-muted-foreground mb-2 flex-shrink-0">
            AI Answer
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted-foreground mb-4 flex-shrink-0">
            {activeData.answer}
          </p>

          <div className="flex flex-wrap gap-1.5 flex-shrink-0 mb-5">
            {activeData.tags.map((tag) => (
              <span
                key={tag}
                className="text-[8px] tracking-[0.08em] uppercase px-2 py-0.5 rounded-sm text-primary bg-primary/10 border border-primary/30"
              >
                {tag}
              </span>
            ))}
          </div>

          <div className="h-[0.5px] bg-foreground/5 mb-3.5 flex-shrink-0" />

          <div className="text-[8px] tracking-[0.14em] uppercase text-muted-foreground mb-2 flex-shrink-0">
            Source Clause §{activeData.refId}
          </div>
          <div className="flex-1 bg-muted/30 border border-foreground/10 border-l-2 border-l-primary rounded-r-md p-3.5 text-[10px] leading-relaxed text-muted-foreground font-serif overflow-hidden">
            {activeClauseData.text}
          </div>

          <div className="mt-3.5 flex-shrink-0">
            <div className="flex justify-between mb-1">
              <span className="text-[8px] tracking-[0.1em] uppercase text-muted-foreground">
                Extraction confidence
              </span>
              <span className="text-[8px] text-primary font-medium">{activeData.confidence}</span>
            </div>
            <div className="h-0.5 bg-foreground/5 rounded-sm overflow-hidden">
              <div
                className="h-full bg-primary rounded-sm transition-all duration-700 ease-in-out"
                style={{ width: activeData.confidence }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// components/AssessmentCTA.tsx
"use client";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";
import Image from "next/image";
import { cn } from "@/lib/utils";

const AssessmentCTA = () => {
  return (
    <section className="bg-[#f5f3ee] py-24 md:py-40 border-y border-[rgba(10,10,15,0.08)] overflow-hidden">
      <div className="max-w-[1240px] mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 items-center gap-16 md:gap-24">

        {/* Left: Text & Button */}
        <div className="reveal order-2 lg:order-1">
          <span className="font-syne text-[10px] tracking-[0.3em] uppercase text-[#0078d4] mb-8 block">Interactive Assessment</span>
          <h2 className="font-cormorant text-[48px] md:text-[64px] font-light leading-[1.1] tracking-tight mb-8">
            Are you <i className="text-[#0078d4]">AI Ready</i> for Risk Management?
          </h2>
          <p className="text-[13px] leading-[1.8] opacity-60 mb-12 max-w-[480px]">
            Surfaces hidden liabilities, evaluates standard-specific exposures, and benchmarks your contract intelligence against global best practices. Take our 2-minute diagnostic.
          </p>

          <motion.div
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-block"
          >
            <Link
              href="/assessment"
              className="bg-[#0a0a0f] text-[#f5f3ee] px-10 py-4.5 text-[11px] tracking-[0.12em] uppercase hover:bg-[#0078d4] transition-colors flex items-center gap-3 group"
            >
              <span>Start Assessment</span>
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </motion.div>
        </div>

        {/* Right: Illustration */}
        <div className="reveal reveal-delay-2 order-1 lg:order-2">
          <div className="relative group">
            <div className="absolute inset-0 bg-[#0078d4]/5 blur-3xl rounded-full scale-110 group-hover:bg-[#0078d4]/10 transition-colors duration-700" />
            <div className="relative border border-[rgba(10,10,15,0.08)] bg-white p-2 shadow-2xl overflow-hidden">
              <Image
                src="/assessmentcta.png"
                alt="AI Risk and Compliance Illustration"
                width={800}
                height={600}
                className="w-full h-auto object-cover grayscale-[0.5] group-hover:grayscale-0 transition-all duration-700"
              />
            </div>
            {/* Decorative Element */}
            <div className="absolute -top-6 -right-6 w-24 h-24 grid grid-cols-4 gap-2 opacity-10">
              {Array.from({ length: 16 }).map((_, i) => (
                <div key={i} className="w-1 h-1 bg-[#0a0a0f] rounded-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default AssessmentCTA;

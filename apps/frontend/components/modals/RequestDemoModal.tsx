"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Check, Calendar, Clock, User, Building2, ChevronRight, ChevronLeft, Loader2, Phone, MessageSquare, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

interface RequestDemoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEMO_TIME_SLOTS = [
  { time: "10:00", label: "10:00 AM" },
  { time: "13:00", label: "1:00 PM" },
  { time: "15:00", label: "3:00 PM" },
  { time: "17:00", label: "5:00 PM" }
];

export default function RequestDemoModal({ isOpen, onClose }: RequestDemoModalProps) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    phone: '',
    message: '',
    demo_date: null as Date | null,
    demo_time: ''
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  const getTomorrow = () => {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(0, 0, 0, 0);
    return t;
  };

  const getMaxDate = () => {
    const m = new Date();
    m.setDate(m.getDate() + 30);
    m.setHours(23, 59, 59, 999);
    return m;
  };

  const nextStep = () => {
    setDirection(1);
    setStep(s => s + 1);
  };

  const prevStep = () => {
    setDirection(-1);
    setStep(s => s - 1);
  };

  // Validation: Name, Email, and Company are mandatory
  const isStep1Valid = formData.name.trim() !== '' &&
    formData.email.trim() !== '' &&
    formData.company.trim() !== '';

  const variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 300 : -300,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 300 : -300,
      opacity: 0
    })
  };

  const formatDateForAPI = (date: Date | null) => {
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_EXTRACTOR_API_URL;
      if (!baseUrl) throw new Error('Missing NEXT_PUBLIC_EXTRACTOR_API_URL');

      if (!formData.demo_date || !formData.demo_time) {
        alert('Please select a date and time for the demo.');
        setIsSubmitting(false);
        return;
      }

      const payload = {
        name: formData.name,
        email: formData.email,
        company: formData.company,
        phone: formData.phone,
        message: formData.message,
        demo_date: formatDateForAPI(formData.demo_date),
        demo_time: formData.demo_time,
      };

      const res = await fetch(`${baseUrl}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Request failed with ${res.status}`);

      setShowSuccess(true);
    } catch (error) {
      console.error('Failed to submit booking:', error);
      alert('Sorry, we could not schedule your demo. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!mounted) return null;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-4xl h-[600px] flex flex-col overflow-hidden relative"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header & Progress Line */}
            <div className="border-b border-slate-100 p-6 flex items-center justify-between bg-white">
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {step > 1 ? <Check className="h-4 w-4" /> : "1"}
                  </div>
                  <span className={`text-sm font-semibold ${step === 1 ? 'text-slate-900' : 'text-slate-400'}`}>Contact Info</span>
                </div>
                <div className="w-12 h-[2px] bg-slate-100" />
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    {showSuccess ? <Check className="h-4 w-4" /> : "2"}
                  </div>
                  <span className={`text-sm font-semibold ${step === 2 ? 'text-slate-900' : 'text-slate-400'}`}>Schedule Demo</span>
                </div>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 relative overflow-hidden bg-white">
              <AnimatePresence initial={false} custom={direction} mode="wait">
                {!showSuccess ? (
                  step === 1 ? (
                    <motion.div
                      key="step1"
                      custom={direction}
                      variants={variants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="absolute inset-0 p-10 flex flex-col justify-center"
                    >
                      <div className="mb-8">
                        <h2 className="text-2xl font-bold text-slate-900">Let's get to know you</h2>
                        <p className="text-slate-500 mt-1">Please provide your details to schedule a personalized session.</p>
                      </div>

                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Full Name *</label>
                          <div className="relative">
                            <User className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-600 outline-none text-sm transition-all"
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                              placeholder="Alan Turing"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Work Email *</label>
                          <div className="relative">
                            <Mail className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              type="email"
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-600 outline-none text-sm transition-all"
                              value={formData.email}
                              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                              placeholder="alan.turing@contractsenseai.com"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Company *</label>
                          <div className="relative">
                            <Building2 className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-600 outline-none text-sm transition-all"
                              value={formData.company}
                              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                              placeholder="Your Compnay"
                            />
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Phone Number</label>
                          <div className="relative">
                            <Phone className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <input
                              type="tel"
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-600 outline-none text-sm transition-all"
                              value={formData.phone}
                              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                              placeholder="+44 (0) 7911 123456"
                            />
                          </div>
                        </div>
                        <div className="col-span-2 space-y-1.5">
                          <label className="text-[12px] font-bold text-slate-500 uppercase tracking-wider">Message</label>
                          <div className="relative">
                            <MessageSquare className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <textarea
                              rows={3}
                              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-1 focus:ring-blue-600 outline-none text-sm transition-all resize-none"
                              value={formData.message}
                              onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                              placeholder="Tell us about your specific goals and needs..."
                            />
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="step2"
                      custom={direction}
                      variants={variants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="absolute inset-0 p-10"
                    >
                      <div className="grid grid-cols-5 gap-10 h-full">
                        <div className="col-span-3">
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-blue-600" /> 1. Pick a Date
                          </h3>
                          <div className="modern-calendar-container">
                            <DatePicker
                              selected={formData.demo_date}
                              onChange={(date) => setFormData({ ...formData, demo_date: date })}
                              inline
                              minDate={getTomorrow()}
                              maxDate={getMaxDate()}
                              filterDate={(date) => date.getDay() !== 0 && date.getDay() !== 6}
                            />
                          </div>
                          <p className="text-xs text-gray-500 mt-2">Bookings available from tomorrow for the next 30 days.</p>
                        </div>
                        <div className="col-span-2 border-l border-slate-100 pl-10">
                          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-600" /> 2. Pick a Time
                          </h3>
                          <p className="text-xs text-gray-500 mb-4">All times shown in UK timezone (GMT/BST).</p>
                          {formData.demo_date ? (
                            <div className="grid grid-cols-1 gap-3 overflow-y-auto max-h-[300px] pr-2">
                              {DEMO_TIME_SLOTS.map((slot) => (
                                <button
                                  key={slot.time}
                                  onClick={() => setFormData({ ...formData, demo_time: slot.time })}
                                  className={`w-full py-3.5 px-4 rounded-lg border text-sm font-semibold transition-all ${formData.demo_time === slot.time
                                      ? 'bg-blue-600 border-blue-600 text-white shadow-md'
                                      : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50/30'
                                    }`}
                                >
                                  {slot.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="h-40 flex flex-col items-center justify-center text-slate-400 space-y-2 border-2 border-dashed border-slate-100 rounded-xl">
                              <Calendar className="h-6 w-6 opacity-20" />
                              <span className="text-[13px]">Select a date first</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )
                ) : (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="absolute inset-0 flex flex-col items-center justify-center p-12 text-center"
                  >
                    <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-6">
                      <Check className="h-10 w-10" />
                    </div>
                    <h2 className="text-3xl font-bold text-slate-900 mb-3">Booking Confirmed</h2>
                    <p className="text-slate-500 max-w-sm mb-10 leading-relaxed">
                      Thank you, {formData.name}. We've sent an invitation for your demo at <span className="text-slate-900 font-semibold">{formData.demo_time}</span> on our selected date.
                    </p>
                    <Button onClick={onClose} className="px-10 h-12 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-all font-semibold">
                      Back to Home
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Sticky Footer */}
            {!showSuccess && (
              <div className="border-t border-slate-100 p-6 flex justify-between bg-slate-50/50">
                <Button
                  variant="ghost"
                  onClick={step === 1 ? onClose : prevStep}
                  className="text-slate-500 font-semibold hover:bg-slate-200/50"
                >
                  {step === 1 ? 'Cancel' : <><ChevronLeft className="h-4 w-4 mr-2" /> Previous</>}
                </Button>

                {step === 1 ? (
                  <Button
                    disabled={!isStep1Valid}
                    onClick={nextStep}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 h-11 rounded-lg shadow-sm"
                  >
                    Next Step <ChevronRight className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <Button
                    disabled={!formData.demo_date || !formData.demo_time || isSubmitting}
                    onClick={handleSubmit}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 h-11 rounded-lg shadow-sm min-w-[160px]"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Complete Booking'}
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}

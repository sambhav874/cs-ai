'use client'
import React from 'react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Facebook, Twitter, Instagram, Linkedin, Send } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="relative bg-gray-900 text-white md:ml-64">
      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-900/50 to-gray-900" />

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Column 1: Brand Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <img
                src="https://picsum.photos/id/313/200/200"
                alt="Logo"
                className="h-8 w-8 rounded-full shadow"
              />
              <h2 className="text-2xl font-bold text-[#5666f5]">ContractSense</h2>
            </div>
            <p className="text-gray-400 leading-relaxed">
              Transforming contract analysis with modern AI technology.
              Simplify your workflow and gain deeper insights.
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#5666f5]">
              Quick Links
            </h3>
            <ul className="grid grid-cols-2 gap-2">
              <li>
                <a href="/dashboard" className="text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                  Dashboard
                </a>
              </li>
              <li>
                <a href="/get-started" className="text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                  Get Started
                </a>
              </li>
              <li>
                <a href="/about" className="text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                  About Us
                </a>
              </li>
              <li>
                <a href="/contact-sales" className="text-gray-400 hover:text-white transition-colors flex items-center gap-2">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Column 3: Social Media */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#5666f5]">
              Connect With Us
            </h3>
            <div className="flex flex-wrap gap-4">
              <a href="#" className="group bg-gray-800 p-3 rounded-lg hover:bg-[#5666f5] transition-colors" aria-label="Follow us on Facebook">
                <Facebook className="w-5 h-5 text-gray-400 group-hover:text-white" aria-hidden="true" />
              </a>
              <a href="#" className="group bg-gray-800 p-3 rounded-lg hover:bg-[#5666f5] transition-colors" aria-label="Follow us on Twitter">
                <Twitter className="w-5 h-5 text-gray-400 group-hover:text-white" aria-hidden="true" />
              </a>
              <a href="#" className="group bg-gray-800 p-3 rounded-lg hover:bg-[#5666f5] transition-colors" aria-label="Follow us on Instagram">
                <Instagram className="w-5 h-5 text-gray-400 group-hover:text-white" aria-hidden="true" />
              </a>
              <a href="#" className="group bg-gray-800 p-3 rounded-lg hover:bg-[#5666f5] transition-colors" aria-label="Follow us on LinkedIn">
                <Linkedin className="w-5 h-5 text-gray-400 group-hover:text-white" aria-hidden="true" />
              </a>
            </div>
            <p className="text-sm text-gray-400">
              Follow us for the latest updates and news
            </p>
          </div>

          {/* Column 4: Newsletter */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-[#5666f5]">
              Stay Updated
            </h3>
            <p className="text-sm text-gray-400">
              Subscribe to our newsletter for the latest features and updates.
            </p>
            <form className="space-y-3">
              <label htmlFor="footer-email" className="sr-only">Email for newsletter</label>
              <div className="relative">
                <Input
                  id="footer-email"
                  type="email"
                  placeholder="Enter your email"
                  className="w-full bg-gray-800 border-gray-700 text-white placeholder-gray-400 focus:ring-[#5666f5] focus:border-[#5666f5]"
                />
                <Button
                  type="submit"
                  size="icon"
                  className="absolute right-1 top-1 bg-[#5666f5] hover:bg-[#4756d4] text-white"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="mt-12 pt-8 border-t border-gray-800">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-gray-400 text-sm">
              &copy; {new Date().getFullYear()} ContractSense. All rights reserved.
            </p>
            <div className="flex gap-6 text-sm text-gray-400">
              <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
              <a href="#" className="hover:text-white transition-colors">Cookie Policy</a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Eye, EyeOff, ArrowRight } from "lucide-react"
import { AuthLayout } from "@/components/auth/AuthLayout"
import { ShimmerButton } from "@/components/magicui/shimmer-button"
import { BorderBeam } from "@/components/magicui/border-beam"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { getGaClientId } from "@/lib/gtag"

export default function SignUp() {
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [couponCode, setCouponCode] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setIsLoading(true)

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_EXTRACTOR_API_URL}/signup/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          password,
          coupon_code: couponCode,
          ga_client_id: getGaClientId(),
        }),
      })

      const data = await response.json()

      if (response.ok) {
        localStorage.setItem("token", "cookie")
        router.push("/agent")
      } else {
        setError(data.detail || "Failed to create account")
      }
    } catch (err) {
      console.warn("Sign-up error:", err)
      setError("Something went wrong. Please try again.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthLayout
      title="ContractSense"
      subtitle="Create your account"
      isSignIn={false}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative w-full max-w-md"
      >
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg"
          >
            <p className="text-sm font-medium text-red-600 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {error}
            </p>
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              Username
            </label>
            <Input
              id="username"
              placeholder="Choose a username"
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={isLoading}
              className="h-11 text-base border-gray-300 focus:border-[#0084C7] focus:ring-2 focus:ring-[#0084C7]/50 rounded-lg shadow-sm transition-all"
            />
          </div>

          <div className="space-y-3">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <Input
              id="email"
              placeholder="Enter your email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              className="h-11 text-base border-gray-300 focus:border-[#0084C7] focus:ring-2 focus:ring-[#0084C7]/50 rounded-lg shadow-sm transition-all"
            />
          </div>

          <div className="space-y-3">
            <label htmlFor="coupon-code" className="block text-sm font-medium text-gray-700">
              Coupon Code <span className="text-gray-500">(Optional)</span>
            </label>
            <Input
              id="coupon-code"
              placeholder="Enter your coupon code"
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              disabled={isLoading}
              className="h-11 text-base border-gray-300 focus:border-[#0084C7] focus:ring-2 focus:ring-[#0084C7]/50 rounded-lg shadow-sm transition-all"
            />
          </div>

          <div className="space-y-3">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <div className="relative">
              <Input
                id="password"
                placeholder="Create a password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="h-11 text-base border-gray-300 focus:border-[#0084C7] focus:ring-2 focus:ring-[#0084C7]/50 rounded-lg shadow-sm transition-all pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff size={18} className="text-gray-500" />
                ) : (
                  <Eye size={18} className="text-gray-500" />
                )}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Password must be at least 8 characters long
            </p>
          </div>

          <div className="flex items-center">
            <input
              id="terms"
              name="terms"
              type="checkbox"
              required
              className="h-4 w-4 rounded border-gray-300 text-[#0084C7] focus:ring-[#0084C7]"
            />
            <label htmlFor="terms" className="ml-2 block text-sm text-gray-700">
              I agree to the <span className="text-[#0084C7]">Terms of Service</span> and <span className="text-[#0084C7]">Privacy Policy</span>
            </label>
          </div>

          <div className="pt-2">
            <ShimmerButton
              className={cn(
                "w-full h-11 rounded-lg text-white font-medium text-base",
                "bg-gradient-to-r from-[#0084C7] to-[#0066a1]",
                "shadow-md hover:shadow-lg transition-shadow",
                "relative overflow-hidden"
              )}
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating account...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Create account <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </ShimmerButton>
          </div>
        </form>

        <div className="mt-8 pt-8 border-t border-gray-200">
          <p className="text-center text-sm text-gray-500">
            Already have an account?{' '}
            <button
              onClick={() => router.push("/signin")}
              className="font-medium text-[#0084C7] hover:text-[#0066a1] transition-colors"
              disabled={isLoading}
            >
              Sign in
            </button>
          </p>
        </div>
      </motion.div>
    </AuthLayout>
  )
}

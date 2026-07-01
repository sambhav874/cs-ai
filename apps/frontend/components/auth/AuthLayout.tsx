import { ReactNode } from 'react'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import { BorderBeam } from '../magicui/border-beam'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { Home } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useRouter } from "next/navigation";

const inter = Inter({ subsets: ['latin'] })

interface AuthLayoutProps {
  children: ReactNode
  title: string
  subtitle: string
  isSignIn?: boolean
}

interface AuthFooterProps {
  isSignIn: boolean
}



function AuthFooter({ isSignIn }: AuthFooterProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="space-y-4 text-sm"
    >
      <p className="text-gray-400 text-[13px]">
        By {isSignIn ? "continuing" : "signing up"}, you agree to our{" "}
        <Link href="/terms" className="text-[#0084C7] hover:underline font-medium">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-[#0084C7] hover:underline font-medium">
          Privacy Policy
        </Link>
      </p>
    </motion.div>
  )
}

export function AuthLayout({ children, title, subtitle, isSignIn = true }: AuthLayoutProps) {

  const router = useRouter();
  return (
    <div className={`min-h-screen flex ${inter.className}`}>
      {/* Auth Form Section */}
      <div className="w-full lg:w-[30%] flex items-center justify-center bg-gradient-to-br from-gray-50 to-white px-4 py-8 relative overflow-hidden">

        <div className="w-full max-w-md relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-white rounded-xl border border-gray-100 p-8 shadow-sm relative overflow-hidden"
          >
            <BorderBeam
              size={300}
              duration={12}
              delay={5}
              borderWidth={1.5}
              className="absolute inset-0 pointer-events-none"
            />


            <div className="flex flex-col space-y-8 relative z-10">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="space-y-1.5"
              >
                <h2 className="text-[28px] font-medium tracking-tight text-gray-900 mb-1">
                  {title}
                </h2>
                <p className="text-[15px] text-gray-500 font-normal">
                  {subtitle}
                </p>
              </motion.div>

              {children}

              <AuthFooter isSignIn={isSignIn} />
            </div>
          </motion.div>
        </div>
      </div>
      <div className="absolute top-4 left-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="flex items-center gap-1 text-gray-600 hover:text-[#0084C7]"
        >
          <Home className="h-4 w-4" />
          <span className='text-md'>Home</span>
        </Button>
      </div>

      {/* Image Section */}
      <div className="hidden lg:block w-[70%] h-screen relative">
        <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-white/30 z-10" />
        <Image
          src="/greet.jpeg"
          alt="Authentication background"
          fill
          priority
          className="object-cover"
        />

      </div>
    </div>
  )
}
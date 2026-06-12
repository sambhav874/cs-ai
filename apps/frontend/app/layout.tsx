// app/layout.tsx
import type { Metadata } from "next"
import { Geist, Geist_Mono, Cormorant_Garamond, DM_Mono, Syne } from "next/font/google"
import "./globals.css"
import Footer from "@/components/new/footer"
import ClientLayout from "@/components/client-layout"
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ThemeProvider } from "@/components/main/themes-provider"
import { Toaster } from "@/components/ui/sonner"
import { AccountProvider } from "./context/AccountContext"
import SecureApiProvider from "@/components/auth/SecureApiProvider"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: 'swap',
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: 'swap',
})

const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "600"],
  display: 'swap',
})

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: 'swap',
})

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: "ContractSense - AI-Powered Contract Intelligence & Analysis",
    template: "%s | ContractSense"
  },
  description: "Transform your contract management with AI-powered analysis, automated review, and intelligent insights. Streamline legal workflows, reduce risks, and accelerate deal closure with ContractSense.",
  keywords: [
    "contract management",
    "AI contract analysis",
    "legal tech",
    "contract intelligence",
    "document review",
    "contract automation",
    "legal AI",
    "contract collaboration",
    "legal workflow",
    "contract insights",
    "legal document analysis",
    "contract risk assessment"
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${cormorantGaramond.variable} ${dmMono.variable} ${syne.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background" suppressHydrationWarning>
        <SecureApiProvider />
        <AccountProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <ClientLayout>{children}</ClientLayout>
            <Toaster />
          </ThemeProvider>
        </AccountProvider>
      </body>
    </html>
  )
}

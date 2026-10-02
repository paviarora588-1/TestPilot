import type { Metadata } from "next";
import { Geist, Geist_Mono, Chakra_Petch } from "next/font/google";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { QueryProvider } from "@/lib/query-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display/heading face — geometric and technical, matching the app's dark
// "instrumentation panel" identity without tipping into gaming/sci-fi camp.
// Headings previously fell back to Geist Sans (identical to body text, no
// typographic hierarchy of their own) — this gives every <h1>-<h6> across
// the app real personality via the existing --font-heading token, with no
// per-page changes needed.
const chakraPetch = Chakra_Petch({
  variable: "--font-chakra-petch",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "TestPilot",
  description: "Enterprise QA automation platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${chakraPetch.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/* reducedMotion="user" makes every motion/react animation in the
              app honor the OS-level prefers-reduced-motion setting
              automatically, without opting in to it per animated component. */}
          <MotionConfig reducedMotion="user">
            <QueryProvider>
              <AuthProvider>
                {children}
                <Toaster />
              </AuthProvider>
            </QueryProvider>
          </MotionConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}

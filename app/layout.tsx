import { ClerkProvider } from "@clerk/nextjs";
import { DEMO_MODE } from "@/lib/auth/mode";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
});

export const metadata: Metadata = {
  title: {
    default: "Corva — customer operations platform",
    template: "%s · Corva",
  },
  description:
    "Corva answers your helpline with an AI trained on your own documentation, scores every customer on eleven live signals, and hands a human the full brief the moment judgement is needed.",
};

/**
 * Root shell. Deliberately thin — the three surfaces (marketing, the tenant
 * console, the platform operator console) each bring their own chrome and
 * their own ground colour.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const shell = (
    <html lang="en-GB" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );

  // Clerk throws if mounted without keys. Demo mode runs without them, so the
  // provider is only mounted once the workspace has real authentication.
  return DEMO_MODE ? shell : <ClerkProvider>{shell}</ClerkProvider>;
}

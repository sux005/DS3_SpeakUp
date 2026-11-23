import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Fredoka } from "next/font/google";
import { SiteFooter } from "@/components/Scenery";
import { SiteNav } from "@/components/SiteNav";
import { AuthProvider } from "@/lib/auth";
import { DemoProvider } from "@/lib/demo-store";
import { LiveProvider } from "@/lib/live-store";
import "./globals.css";

// Rounded display face for headings; DM Sans and DM Mono stay for reading and labels.
// Only 600 is loaded, so bold headings stay rounded without turning blobby at 700.
const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: "600",
});

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "SpeakUp",
  description: "Practice presentations and get feedback on your delivery.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fredoka.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('speakup-theme')==='dark'?'dark':'light'}catch{document.documentElement.dataset.theme='light'}" }} />
        <AuthProvider>
          <DemoProvider>
            <LiveProvider>
              <SiteNav />
              {children}
              <SiteFooter />
            </LiveProvider>
          </DemoProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

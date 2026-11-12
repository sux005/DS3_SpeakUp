import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Space_Grotesk } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { DemoProvider } from "@/lib/demo-store";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
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
      className={`${spaceGrotesk.variable} ${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('speakup-theme')==='dark'?'dark':'light'}catch{document.documentElement.dataset.theme='light'}" }} />
        <DemoProvider>
          <SiteNav />
          {children}
        </DemoProvider>
      </body>
    </html>
  );
}

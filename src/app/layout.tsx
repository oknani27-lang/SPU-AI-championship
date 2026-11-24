import type { Metadata, Viewport } from "next";
import { Sarabun } from "next/font/google";
import { SessionProvider } from "@/components/care/SessionContext";
import { ApplicationFrame } from "@/components/layout/AppShell";
import "./globals.css";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
  display: "swap",
});

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "CarePlan", statusBarStyle: "default" },
  icons: { apple: "/careplan-192.png" },
  title: "CarePlan — ผู้ช่วยจัดตารางดูแลผู้สูงอายุรายสัปดาห์",
  description:
    "ระบบวางแผนและติดตามตารางดูแลผู้สูงอายุรายสัปดาห์สำหรับผู้ดูแลที่บ้าน พร้อมยืนยันภาพถ่าย สรุปผลประจำวัน และแชร์ตารางให้ครอบครัวผ่าน LINE",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#256B4A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body className="bg-[#FAFBF9] text-[#17241D] antialiased">
        <SessionProvider><ApplicationFrame>{children}</ApplicationFrame></SessionProvider>
      </body>
    </html>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarCheck2, CheckCircle2, Lock, Play, ShieldCheck } from "lucide-react";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading, error, startDemo, refreshSession } = useSession();
  const [startingDemo, setStartingDemo] = React.useState(false);
  const [demoError, setDemoError] = React.useState<string | null>(null);

  const handleStartDemo = async () => {
    setStartingDemo(true);
    setDemoError(null);
    try {
      await startDemo(false);
    } catch (err) {
      setDemoError(
        err instanceof Error ? err.message : "ไม่สามารถเริ่มโหมดสาธิตได้"
      );
    } finally {
      setStartingDemo(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFBF9] flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-md bg-[#EAF3EC] flex items-center justify-center text-[#256B4A]">
              <CalendarCheck2 className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-[#17241D]">Careplan</p>
              <p className="text-sm text-[#66736B]">กำลังตรวจสอบสถานะการใช้งาน...</p>
            </div>
          </div>
          <div className="space-y-2 pt-1">
            <div className="h-3 w-3/4 rounded bg-[#EAF3EC] animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-[#F0F4F1] animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div className="min-h-screen bg-[#FAFBF9] flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-md border border-[#D4E6D8] bg-[#EAF3EC] px-2.5 py-1 text-xs font-medium text-[#1E583C]">
              <CalendarCheck2 className="h-3.5 w-3.5" />
              Careplan — AI Weekly Care Scheduler
            </div>
            <h1 className="text-2xl font-bold text-[#17241D] leading-snug">
              วางแผนดูแลผู้สูงอายุรายสัปดาห์อย่างเป็นระบบและสบายใจ
            </h1>
            <p className="text-[15px] text-[#66736B]">
              จัดตารางงานประจำวัน ยืนยันการดูแลด้วยภาพถ่าย แจ้งเตือนตรงเวลา
              และแชร์แผนดูแลให้ครอบครัวผ่าน LINE ได้ในที่เดียว
            </p>
          </div>

          <ul className="space-y-2 rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-4 text-sm text-[#17241D]">
            <li className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#256B4A] mt-0.5 shrink-0" />
              <span>AI ช่วยจัดเรียงตารางและแปลงข้อความที่พิมพ์เป็นงานดูแล (อนุมัติก่อนบันทึกทุกครั้ง)</span>
            </li>
            <li className="flex items-start gap-2">
              <Lock className="h-4 w-4 text-[#256B4A] mt-0.5 shrink-0" />
              <span>ยืนยันงานเสร็จด้วยภาพถ่ายอย่างน้อย 1 รูป และล็อกประวัติถาวรอย่างโปร่งใส</span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-[#256B4A] mt-0.5 shrink-0" />
              <span>รองรับตารางซ้ำทุก 7 วัน แจ้งเตือนอัตโนมัติ และแชร์ให้ครอบครัวดูได้โดยไม่ต้องล็อกอิน</span>
            </li>
          </ul>

          {(error || demoError) && (
            <Alert variant="error" title="เกิดข้อผิดพลาด">
              {demoError || error}
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshSession()}
                >
                  ลองเชื่อมต่อใหม่
                </Button>
              </div>
            </Alert>
          )}

          {session?.demo_available === true && <div className="space-y-3">
            <Button
              size="lg"
              variant="primary"
              className="w-full"
              loading={startingDemo}
              onClick={handleStartDemo}
            >
              <Play className="h-4 w-4" />
              ทดลองใช้งาน Careplan
            </Button>
            <p className="text-xs text-[#66736B] text-center">
              เข้าสู่โหมดสาธิต (Demo Mode — คุณเมย์ / คุณสมใจ) พร้อมตารางตัวอย่างครบ 7 วันทันที
            </p>
          </div>}
          {session?.demo_available === false && !session.live_ready && <Alert variant="warning">ระบบออนไลน์กำลังเตรียมเปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบก่อนสมัครบัญชี</Alert>}

          {session?.demo_available === true && <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[#E3E9E3]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#FFFFFF] px-3 text-[#66736B]">
                หรือเข้าใช้งานด้วยบัญชีของคุณ
              </span>
            </div>
          </div>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Link
              href="/login"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-4 text-[15px] font-medium text-[#17241D] hover:bg-[#F4F7F4] transition-colors"
            >
              เข้าสู่ระบบ
            </Link>
            <Link
              href="/register"
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#D4E6D8] bg-[#EAF3EC] px-4 text-[15px] font-medium text-[#17241D] hover:bg-[#DCECE0] transition-colors"
            >
              สมัครสมาชิกใหม่
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

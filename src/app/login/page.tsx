"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck2, LogIn, Play } from "lucide-react";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { loginAccount } from "@/lib/api-client";

export default function LoginPage() {
  const router = useRouter();
  const { refreshSession, startDemo } = useSession();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [startingDemo, setStartingDemo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await loginAccount({
        email: email.trim(),
        password,
      });
      await refreshSession();
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async () => {
    setStartingDemo(true);
    setError(null);
    try {
      await startDemo(false);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถเริ่มโหมดสาธิตได้"
      );
    } finally {
      setStartingDemo(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFBF9] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-6 sm:p-8 space-y-6">
        <div className="space-y-1.5">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-[#256B4A]"
          >
            <span className="h-7 w-7 rounded-md bg-[#256B4A] text-white flex items-center justify-center">
              <CalendarCheck2 className="h-4 w-4" />
            </span>
            CarePlan
          </Link>
          <h1 className="text-2xl font-bold text-[#17241D]">เข้าสู่ระบบ</h1>
          <p className="text-sm text-[#66736B]">
            จัดการตารางดูแลผู้สูงอายุรายสัปดาห์และติดตามความคืบหน้าประจำวัน
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="block text-sm font-medium text-[#17241D] mb-1"
            >
              อีเมล
            </label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              required
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="block text-sm font-medium text-[#17241D] mb-1"
            >
              รหัสผ่าน
            </label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="กรอกรหัสผ่านของคุณ"
              required
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full"
          >
            <LogIn className="h-4 w-4" />
            เข้าสู่ระบบ
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#E3E9E3]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[#FFFFFF] px-3 text-[#66736B]">
              สำหรับกรรมการและผู้ทดลองใช้งาน
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            variant="secondary"
            size="lg"
            loading={startingDemo}
            onClick={handleDemo}
            className="w-full"
          >
            <Play className="h-4 w-4" />
            เข้าใช้งานโหมดสาธิต (Hackathon Demo Mode)
          </Button>
          <p className="text-xs text-[#66736B] text-center">
            ทดลองใช้งานทุกฟีเจอร์ได้ทันทีโดยไม่ต้องสมัครสมาชิก
          </p>
        </div>

        <p className="text-center text-sm text-[#66736B]">
          ยังไม่มีบัญชีใช่ไหม?{" "}
          <Link
            href="/register"
            className="font-semibold text-[#256B4A] hover:underline"
          >
            สมัครสมาชิกใหม่
          </Link>
        </p>
      </div>
    </div>
  );
}

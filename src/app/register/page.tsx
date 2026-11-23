"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck2, Play, UserPlus } from "lucide-react";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { registerAccount } from "@/lib/api-client";

export default function RegisterPage() {
  const router = useRouter();
  const { refreshSession, startDemo } = useSession();

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [recipientName, setRecipientName] = React.useState("คุณแม่");
  const [recipientAge, setRecipientAge] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [startingDemo, setStartingDemo] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [infoMsg, setInfoMsg] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfoMsg(null);
    try {
      const ageNum = recipientAge.trim() ? Number(recipientAge) : null;
      const res = await registerAccount({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        care_recipient_name: recipientName.trim() || "คุณแม่",
        care_recipient_age:
          ageNum !== null && Number.isFinite(ageNum) ? ageNum : null,
      });

      if (res.requires_email_confirmation) {
        setInfoMsg(
          "สมัครสมาชิกเรียบร้อยแล้ว กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ"
        );
        return;
      }

      await refreshSession();
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถสมัครสมาชิกได้ กรุณาตรวจสอบข้อมูลอีกครั้ง"
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
          <h1 className="text-2xl font-bold text-[#17241D]">สมัครสมาชิกใหม่</h1>
          <p className="text-sm text-[#66736B]">
            เริ่มต้นวางแผนการดูแลผู้สูงอายุรายสัปดาห์อย่างเป็นระบบ
          </p>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {infoMsg && <Alert variant="success">{infoMsg}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label
              htmlFor="reg-name"
              className="block text-sm font-medium text-[#17241D] mb-1"
            >
              ชื่อผู้ดูแล *
            </label>
            <Input
              id="reg-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="เช่น สมชาย ใจดี"
              required
            />
          </div>

          <div>
            <label
              htmlFor="reg-email"
              className="block text-sm font-medium text-[#17241D] mb-1"
            >
              อีเมล *
            </label>
            <Input
              id="reg-email"
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
              htmlFor="reg-password"
              className="block text-sm font-medium text-[#17241D] mb-1"
            >
              รหัสผ่าน (อย่างน้อย 6 ตัวอักษร) *
            </label>
            <Input
              id="reg-password"
              type="password"
              minLength={6}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="ตั้งรหัสผ่านของคุณ"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div className="sm:col-span-2">
              <label
                htmlFor="reg-recipient"
                className="block text-sm font-medium text-[#17241D] mb-1"
              >
                ผู้รับการดูแล
              </label>
              <Input
                id="reg-recipient"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="เช่น คุณแม่ / คุณยาย"
              />
            </div>
            <div>
              <label
                htmlFor="reg-age"
                className="block text-sm font-medium text-[#17241D] mb-1"
              >
                อายุ (ปี)
              </label>
              <Input
                id="reg-age"
                type="number"
                min={50}
                max={120}
                value={recipientAge}
                onChange={(e) => setRecipientAge(e.target.value)}
                placeholder="72"
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full mt-2"
          >
            <UserPlus className="h-4 w-4" />
            สร้างบัญชี CarePlan
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[#E3E9E3]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[#FFFFFF] px-3 text-[#66736B]">หรือ</span>
          </div>
        </div>

        <Button
          variant="secondary"
          size="lg"
          loading={startingDemo}
          onClick={handleDemo}
          className="w-full"
        >
          <Play className="h-4 w-4" />
          ทดลองใช้งานโหมดสาธิตทันที (Hackathon Demo Mode)
        </Button>

        <p className="text-center text-sm text-[#66736B]">
          มีบัญชีอยู่แล้ว?{" "}
          <Link
            href="/login"
            className="font-semibold text-[#256B4A] hover:underline"
          >
            เข้าสู่ระบบ
          </Link>
        </p>
      </div>
    </div>
  );
}

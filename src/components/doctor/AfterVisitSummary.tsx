"use client";

import * as React from "react";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/components/ui/alert";

type Category = "care" | "medication" | "follow_up" | "other";
interface SummaryResult {
  summary: {
    overview: string;
    sections: Array<{ category: Category; text: string; source: string }>;
    questions: string[];
  };
  provider: string;
}
const labels: Record<Category, string> = {
  care: "การดูแล",
  medication: "ยา · ตามข้อความต้นฉบับ",
  follow_up: "นัดติดตาม",
  other: "เรื่องสำคัญอื่น ๆ",
};

// Only display known diagnostic categories, never a provider's raw error body.
export function aftercareErrorMessage(status: number, reason?: string): string {
  if (status === 401) return "กรุณาเข้าสู่ระบบอีกครั้ง";
  if (reason === "gemini_http_429" || status === 429) return "AI ถึงขีดจำกัดการใช้งาน กรุณารอสักครู่แล้วลองใหม่";
  if (reason === "gemini_http_503" || reason === "gemini_http_502" || reason === "gemini_http_504") return "บริการ AI ไม่พร้อมชั่วคราว กรุณาลองใหม่อีกสักครู่";
  if (reason === "gemini_timeout") return "AI ใช้เวลานานเกินไป กรุณาลองใหม่";
  if (reason === "gemini_api_key_not_configured" || reason === "gemini_http_400" || reason === "gemini_http_401" || reason === "gemini_http_403" || reason === "gemini_http_404") return "การเชื่อมต่อ AI ยังไม่พร้อม กรุณาตรวจการตั้งค่าคีย์และโมเดล";
  if (reason === "source_validation_failed" || reason?.startsWith("source_") || reason === "gemini_schema_validation_failed" || reason === "gemini_empty_response") return "AI ส่งผลสรุปที่ตรวจยืนยันกับต้นฉบับไม่ได้ กรุณาลองใหม่";
  if (reason === "gemini_network_or_parse_error") return "เชื่อมต่อ AI ไม่สำเร็จ กรุณาลองใหม่";
  if (status === 413) return "ข้อความยาวเกินไป กรุณาลดข้อความแล้วลองใหม่";
  if (status === 400) return "กรุณาตรวจข้อความและการยินยอมก่อนสรุป";
  if (status === 403) return "ส่งคำขอไม่ได้ กรุณารีเฟรชหน้าเว็บแล้วลองใหม่";
  return "สรุปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

export function AfterVisitSummary() {
  const { session, demoVersion } = useSession();
  // Remount on an account/mode reset so private source and results never carry over.
  const identity = `${session?.user?.id ?? "signed-out"}:${session?.mode}:${demoVersion}`;
  return <SummaryForm key={identity} authenticated={Boolean(session?.authenticated)} />;
}

function SummaryForm({ authenticated }: { authenticated: boolean }) {
  const [text, setText] = React.useState("");
  const [consent, setConsent] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);
  const [result, setResult] = React.useState<SummaryResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [status, setStatus] = React.useState("");
  const request = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const submitLock = React.useRef(false);
  const lastSummary = React.useRef<{ text: string; result: SummaryResult } | null>(null);
  const sourceId = React.useId();
  const consentId = React.useId();
  const reviewId = React.useId();

  React.useEffect(() => () => {
    request.current++;
    controller.current?.abort();
  }, []);

  function invalidate() {
    request.current++;
    controller.current?.abort();
    submitLock.current = false;
    setBusy(false); setResult(null); setReviewed(false); setError(""); setStatus("");
  }
  function clear() {
    invalidate(); lastSummary.current = null; setText(""); setConsent(false);
  }
  async function summarize(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submitLock.current) return;
    if (!authenticated) { setError("กรุณาเข้าสู่ระบบก่อนสรุป"); return; }
    if (!consent) { setError("กรุณายินยอมก่อนส่งข้อความให้ AI"); return; }
    if (text.trim().length < 10) { setError("เพิ่มข้อความจากแพทย์อย่างน้อย 10 ตัวอักษร"); return; }
    if (lastSummary.current?.text === text.trim()) {
      setResult(lastSummary.current.result); setReviewed(false); setError(""); setStatus("ใช้ผลสรุปเดิม · ไม่ได้เรียก AI ซ้ำ");
      return;
    }
    const generation = ++request.current;
    submitLock.current = true;
    controller.current?.abort();
    const pending = new AbortController(); controller.current = pending;
    const timer = window.setTimeout(() => pending.abort(), 35000);
    setBusy(true); setError(""); setStatus(""); setResult(null); setReviewed(false);
    try {
      const response = await fetch("/api/ai/aftercare", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), consent: true }), signal: pending.signal,
      });
      let data;
      try { data = await response.json(); } catch { throw new Error(aftercareErrorMessage(response.status)); }
      if (!response.ok) throw new Error(aftercareErrorMessage(response.status, typeof data?.details?.reason === "string" ? data.details.reason : undefined));
      if (!data?.summary || typeof data.summary.overview !== "string" || !Array.isArray(data.summary.sections) || !Array.isArray(data.summary.questions) || typeof data.provider !== "string"
        || !data.summary.sections.every((section: SummaryResult["summary"]["sections"][number]) => section && ["care", "medication", "follow_up", "other"].includes(section.category) && typeof section.text === "string" && typeof section.source === "string")
        || !data.summary.questions.every((question: unknown) => typeof question === "string")) throw new Error("ผลสรุปไม่สมบูรณ์ กรุณาลองอีกครั้ง");
      if (generation === request.current) {
        lastSummary.current = { text: text.trim(), result: data as SummaryResult };
        setResult(data as SummaryResult);
      }
    } catch (problem) {
      if (generation === request.current) setError(problem instanceof Error && problem.name === "AbortError" ? "ใช้เวลานานเกินไป กรุณาลองอีกครั้ง" : problem instanceof TypeError ? "เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่" : problem instanceof Error ? problem.message : "เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      window.clearTimeout(timer);
      if (generation === request.current) { setBusy(false); submitLock.current = false; controller.current = null; }
    }
  }
  async function copySummary() {
    if (!result || !reviewed) return;
    const generation = request.current;
    const output = ["สรุปผลการเข้าพบแพทย์", result.summary.overview,
      ...result.summary.sections.map(section => `${labels[section.category]}: ${section.text}`),
      ...(result.summary.questions.length ? ["เรื่องที่ควรยืนยัน", ...result.summary.questions] : []),
      "สรุปด้วย AI · ตรวจทานกับเอกสารแพทย์ก่อนใช้"].join("\n\n");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(output); if (generation === request.current) setStatus("คัดลอกแล้ว");
    } catch { if (generation === request.current) setStatus("คัดลอกไม่ได้ กรุณาเลือกข้อความแล้วคัดลอกด้วยตัวเอง"); }
  }

  return <section className="max-w-2xl space-y-6" aria-labelledby="after-visit-heading">
    <div><h2 id="after-visit-heading" className="text-xl font-semibold">สรุปผลการเข้าพบแพทย์</h2><p className="mt-2 text-sm text-[#6B7C72]">วางคำแนะนำจากแพทย์ แล้วสรุปให้อ่านง่าย</p></div>
    <form onSubmit={summarize} className="space-y-4" aria-busy={busy}>
      <label htmlFor={sourceId} className="block text-sm font-medium">ข้อความจากแพทย์</label>
      <Textarea id={sourceId} rows={6} maxLength={8000} minLength={10} required value={text} placeholder="พิมพ์หรือวางข้อความจากใบสรุปหลังตรวจและฉลากยา" onChange={event => { invalidate(); setText(event.target.value); }} aria-describedby={`${sourceId}-privacy`} />
      <details id={`${sourceId}-privacy`} className="text-xs leading-6 text-[#6B7C72]"><summary className="cursor-pointer">การใช้ข้อมูล</summary><p className="mt-2">ข้อความจะส่งให้ Gemini เมื่อกดสรุปเท่านั้น ไม่บันทึกต้นฉบับหรือผลสรุปไว้บนเซิร์ฟเวอร์ของแอป ควรลบชื่อ เลขบัตร และข้อมูลระบุตัวบุคคลก่อนส่ง การประมวลผลของ Gemini เป็นไปตามเงื่อนไขของผู้ให้บริการ</p></details>
      <label htmlFor={consentId} className="flex items-start gap-3 text-sm leading-6"><input id={consentId} type="checkbox" checked={consent} required onChange={event => { invalidate(); setConsent(event.target.checked); }} className="mt-1 h-4 w-4 shrink-0 accent-[#48735B]" /><span>ยินยอมส่งข้อความนี้ให้ Gemini เพื่อสรุป</span></label>
      <div className="flex flex-wrap items-center gap-3"><Button type="submit" loading={busy} disabled={!authenticated || !consent || text.trim().length < 10}>สรุปให้อ่านง่าย</Button>{text && <Button variant="ghost" onClick={clear}>ล้างข้อความ</Button>}</div>
      {error && <Alert variant="error" role="alert">{error}</Alert>}
    </form>
    {result && <section className="space-y-5 rounded-xl border border-[#DDE5DF] bg-white p-5 sm:p-6" aria-label="ผลสรุปจาก AI" aria-live="polite">
      <div><span className="text-xs font-medium text-[#48735B]">สรุปด้วย AI</span><p className="mt-2 whitespace-pre-wrap break-words text-base leading-7">{result.summary.overview}</p></div>
      {(["care", "medication", "follow_up", "other"] as const).map(category => {
        const items = result.summary.sections.filter(section => section.category === category);
        return items.length ? <section key={category} className="border-t border-[#E3E9E3] pt-4"><h3 className="text-sm font-semibold">{labels[category]}</h3><ul className="mt-2 space-y-3">{items.map((item, index) => <li key={index} className="text-sm leading-7"><p className="whitespace-pre-wrap break-words">{item.text}</p><details className="mt-1 text-xs text-[#6B7C72]"><summary className="cursor-pointer">ดูข้อความต้นฉบับ</summary><blockquote className="mt-2 border-l-2 border-[#DDE5DF] pl-3 whitespace-pre-wrap break-words">{item.source}</blockquote></details></li>)}</ul></section> : null;
      })}
      {result.summary.questions.length > 0 && <section className="border-t border-[#E3E9E3] pt-4"><h3 className="text-sm font-semibold">เรื่องที่ควรยืนยันกับแพทย์หรือเภสัชกร</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-7">{result.summary.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></section>}
      <p className="text-xs leading-6 text-[#6B7C72]">ตรวจทานกับเอกสารแพทย์ก่อนใช้ · AI ไม่ได้วินิจฉัยหรือเปลี่ยนวิธีใช้ยา</p>
      <label htmlFor={reviewId} className="flex items-start gap-3 text-sm leading-6"><input id={reviewId} type="checkbox" checked={reviewed} onChange={event => { setReviewed(event.target.checked); setStatus(""); }} className="mt-1 h-4 w-4 shrink-0 accent-[#48735B]" /><span>ตรวจทานกับต้นฉบับแล้ว</span></label>
      <Button variant="outline" disabled={!reviewed} onClick={() => void copySummary()}>คัดลอกสรุป</Button>
    </section>}
    <p role="status" className="text-sm text-[#48735B]">{status}</p>
  </section>;
}

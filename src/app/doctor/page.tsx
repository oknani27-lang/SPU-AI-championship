"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
const AfterVisitSummary = dynamic(() => import("@/components/doctor/AfterVisitSummary").then(module => module.AfterVisitSummary), { loading: () => <p role="status">กำลังโหลด…</p> });
import { getCalendarEvents } from "@/lib/api-client";
import { addDays, cn, formatThaiDate, getBangkokToday } from "@/lib/utils";
import { isValidDateString } from "@/lib/timezone";
import type { CalendarEventOccurrence } from "@/types/careplan";

const hospitals = [
  { id: "a", name: "โรงพยาบาลตัวอย่าง A", distance: "1.2", department: "อายุรกรรม", area: "ใจกลางเมือง" },
  { id: "b", name: "โรงพยาบาลตัวอย่าง B", distance: "2.8", department: "เวชปฏิบัติทั่วไป", area: "รอบเมือง" },
];
const primary = "inline-flex items-center justify-center rounded-lg bg-[#48735B] px-5 py-3 text-sm font-medium text-white hover:bg-[#365B46]";
type Tab = "appointments" | "hospitals" | "aftercare";
type Hospital = (typeof hospitals)[number];
const calendarLink = (event: CalendarEventOccurrence) => `/calendar?${new URLSearchParams({ event: event.event_id, date: event.occurrence_date })}`;

export default function DoctorPage() {
  return <AppShell><React.Suspense fallback={<p role="status">กำลังโหลด…</p>}><DoctorContent /></React.Suspense></AppShell>;
}

function DoctorContent() {
  const params = useSearchParams();
  const { session, demoVersion } = useSession();
  const [tab, setTab] = React.useState<Tab>(() => params.get("tab") === "aftercare" ? "aftercare" : params.get("tab") === "hospitals" ? "hospitals" : "appointments");
  const [events, setEvents] = React.useState<CalendarEventOccurrence[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Hospital | null>(null);
  const [contact, setContact] = React.useState<string | null>(null);
  const [requestHospital, setRequestHospital] = React.useState<Hospital | null>(null);
  const [requestPreview, setRequestPreview] = React.useState(false);
  const eventId = params.get("event");
  const date = params.get("date");
  const owner = session?.user?.id;
  const mode = session?.mode;
  const paramTab = params.get("tab");

  React.useEffect(() => {
    setTab(paramTab === "hospitals" || paramTab === "aftercare" ? paramTab : "appointments");
  }, [paramTab, eventId]);

  React.useEffect(() => {
    let cancelled = false;
    setEvents([]); setError(""); setLoading(true);
    if (!owner) { setLoading(false); return; }
    if (tab !== "appointments" && !eventId) { setLoading(false); return; }
    if (eventId && (!date || !isValidDateString(date))) { setError("เปิดนัดหมายจากปฏิทินอีกครั้ง"); setLoading(false); return; }
    const start = eventId && date ? date : getBangkokToday();
    void getCalendarEvents(start, eventId ? start : addDays(start, 90)).then(result => {
      if (cancelled) return;
      setEvents(result.occurrences.filter(event => event.event_type === "doctor" && (!eventId || event.event_id === eventId && event.occurrence_date === date)));
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "โหลดนัดหมายไม่สำเร็จ"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner, mode, demoVersion, eventId, date, retry, tab]);

  const matches = hospitals.filter(h => `${h.name} ${h.department} ${h.area}`.toLowerCase().includes(query.trim().toLowerCase()));
  const next = events[0];
  return <div className="mx-auto max-w-4xl py-3 sm:py-7 text-[#263F32]">
    <header className="mb-6 sm:mb-8 flex items-center justify-between gap-4">
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">นัดแพทย์</h1>
      <Link href="/calendar?new=doctor" className={primary}>＋ เพิ่มนัด</Link>
    </header>
    <nav aria-label="ส่วนนัดหมายแพทย์" className="flex gap-6 sm:gap-10 border-b border-[#DDE5DF] text-sm overflow-x-auto">
      {([["appointments", "นัดหมาย"], ["hospitals", "โรงพยาบาล"], ["aftercare", "สรุปหลังพบแพทย์"]] as const).map(([id, label]) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined} className={cn("whitespace-nowrap pb-3 pt-2 border-b-2", tab === id ? "border-[#48735B] text-[#48735B] font-semibold" : "border-transparent text-[#6B7C72]")}>{label}</button>)}
    </nav>
    <div className="py-6 sm:py-8">
      {tab === "appointments" && <>
        {loading ? <p role="status" className="py-10 text-sm text-[#6B7C72]">กำลังโหลด…</p> : error ? <Alert variant="error">{error}<button className="block mt-2 underline" onClick={() => setRetry(n => n + 1)}>ลองใหม่</button></Alert> : next ? <>
          <article className="rounded-2xl bg-[#EFF5EE] p-5 sm:p-8 grid sm:grid-cols-[0.8fr_1.2fr] gap-5 sm:gap-8">
            <div className="sm:border-r sm:border-[#CFDCCF] sm:pr-6"><p className="text-xs text-[#6B7C72]">{eventId ? "นัดหมายของคุณ" : "นัดถัดไป"}</p><h2 className="mt-3 text-lg sm:text-xl font-semibold">{formatThaiDate(next.occurrence_date, { includeWeekday: false, fullMonth: true })}</h2><p className="mt-2 text-2xl font-semibold">{next.is_all_day ? "ตลอดวัน" : `${next.start_time} น.`}</p></div>
            <div className="min-w-0"><h3 className="text-xl font-semibold break-words">{next.title}</h3>{next.description && <details className="mt-3 text-sm text-[#6B7C72]"><summary className="cursor-pointer">รายละเอียด</summary><p className="mt-2 whitespace-pre-wrap break-words">{next.description}</p></details>}<Link className="mt-5 inline-block text-sm font-semibold text-[#48735B] hover:underline" href={calendarLink(next)}>เปิดในปฏิทิน →</Link></div>
          </article>
          {events.length > 1 && <div className="mt-6 divide-y divide-[#DDE5DF]">{events.slice(1).map(event => <Link key={event.occurrence_key} href={calendarLink(event)} className="flex items-center justify-between gap-4 py-4 hover:bg-[#F2F6F0]"><div className="min-w-0"><p className="font-medium break-words">{event.title}</p><p className="mt-1 text-sm text-[#6B7C72]">{formatThaiDate(event.occurrence_date, { includeWeekday: false })} · {event.is_all_day ? "ตลอดวัน" : `${event.start_time} น.`}</p></div><span aria-hidden="true" className="text-[#48735B]">→</span></Link>)}</div>}
          <details className="mt-4 text-xs text-[#6B7C72]"><summary className="cursor-pointer">เกี่ยวกับนัดหมาย</summary><p className="mt-2">บันทึกในปฏิทินแล้ว กรุณายืนยันนัดกับโรงพยาบาล</p></details>
        </> : <div className="py-12 text-center"><h2 className="text-lg font-medium">{eventId ? "ไม่พบนัดหมายนี้" : "ยังไม่มีนัดหมาย"}</h2><Link href="/calendar?new=doctor" className="mt-4 inline-block text-sm font-semibold text-[#48735B]">เพิ่มนัดแรก →</Link></div>}
        <div className="mt-6 flex flex-wrap justify-between gap-4 text-sm text-[#48735B]"><button className="hover:underline" onClick={() => setTab("hospitals")}>ค้นหาโรงพยาบาล →</button><Link href="/calendar" className="hover:underline">กลับปฏิทิน</Link></div>
      </>}
      {tab === "hospitals" && <div className="max-w-2xl">
        <span className="inline-block rounded-full bg-[#F0F5EE] px-3 py-1 text-xs text-[#6B7C72]">ข้อมูลโรงพยาบาลตัวอย่าง</span>
        <label className="sr-only" htmlFor="hospital-search">ค้นหาโรงพยาบาล</label><Input id="hospital-search" type="search" className="mt-5" placeholder="ชื่อโรงพยาบาลหรือแผนก" value={query} onChange={e => setQuery(e.target.value)} />
        <div className="mt-4 divide-y divide-[#DDE5DF]">{matches.map(h => <button key={h.id} onClick={() => { setSelected(h); setContact(null); }} className="w-full py-5 text-left flex items-center justify-between gap-4 hover:bg-[#F2F6F0]"><span className="min-w-0"><strong className="block text-base font-semibold">{h.name}</strong><small className="mt-1 block text-[#6B7C72]">{h.department} · ระยะสมมติ {h.distance} กม.</small></span><span aria-hidden="true" className="text-[#48735B]">→</span></button>)}{!matches.length && <p role="status" className="py-8 text-sm text-[#6B7C72]">ไม่พบโรงพยาบาลตัวอย่าง</p>}</div>
      </div>}
      {tab === "aftercare" && <AfterVisitSummary />}
    </div>
    <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.name ?? "โรงพยาบาล"} description="ช่องทางตัวอย่าง · ยังไม่เชื่อมต่อโรงพยาบาล" maxWidthClass="max-w-md">
      <div className="space-y-4"><Button className="w-full" onClick={() => { setRequestHospital(selected); setSelected(null); setRequestPreview(false); }}>ทดลองขอนัด</Button><div className="divide-y divide-[#DDE5DF]">{["โทร", "LINE", "เว็บไซต์"].map(title => <button key={title} onClick={() => setContact(title)} className="flex w-full items-center justify-between py-4 text-left text-sm"><span>{title}</span><span aria-hidden="true">↗</span></button>)}</div>{contact && <p role="status" className="text-sm text-[#6B7C72]">{contact}: ช่องทางตัวอย่าง ยังไม่เปิดใช้งาน</p>}</div>
    </Dialog>
    <Dialog open={Boolean(requestHospital)} onClose={() => setRequestHospital(null)} title="ทดลองขอนัด" description="แบบตัวอย่าง ไม่ส่งคำขอจริง" maxWidthClass="max-w-md">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); setRequestPreview(true); }}><p className="font-medium">{requestHospital?.name}</p><label className="block text-sm">วันที่<Input required type="date" className="mt-2" /></label><label className="block text-sm">เวลา<Input required type="time" className="mt-2" /></label><Button type="submit">ทดลองส่งคำขอ</Button>{requestPreview && <p role="status" className="text-sm text-[#48735B]">ทดลองสำเร็จ · ยังไม่ได้ส่งให้โรงพยาบาล</p>}</form>
    </Dialog>
  </div>;
}

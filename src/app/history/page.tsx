"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Lock,
  Search,
  Stethoscope,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { getHistory } from "@/lib/api-client";
import {
  formatDuration,
  formatThaiDate,
  formatThaiDateTime,
  formatThaiTime,
  getEvidenceUrl,
} from "@/lib/utils";
import type {
  CompletionEvidence,
  DailyTaskOccurrence,
} from "@/types/careplan";

export default function HistoryPage() {
  return (
    <AppShell>
      <HistoryContent />
    </AppShell>
  );
}

function HistoryContent() {
  const { demoVersion } = useSession();
  const [items, setItems] = React.useState<DailyTaskOccurrence[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [lightbox, setLightbox] = React.useState<{
    evidence: CompletionEvidence;
    taskTitle: string;
  } | null>(null);

  const loadHistory = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getHistory(100);
      setItems(res.completed_occurrences || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดประวัติการดูแลได้"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadHistory();
  }, [demoVersion, loadHistory]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (o) =>
        o.title.toLowerCase().includes(q) ||
        o.occurrence_date.includes(q) ||
        (o.description && o.description.toLowerCase().includes(q))
    );
  }, [items, query]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17241D] flex items-center gap-2">
            <History className="h-6 w-6 text-[#256B4A]" />
            ประวัติการดูแล (อ่านอย่างเดียว)
          </h1>
          <p className="text-sm text-[#66736B] mt-0.5">
            บันทึกงานที่ยืนยันเสร็จสิ้นแล้วทั้งหมดพร้อมเวลาที่ยืนยันและภาพถ่ายหลักฐาน
          </p>
        </div>
        <Badge variant="locked">
          <Lock className="h-3 w-3" />
          ถูกล็อกถาวร (Immutable)
        </Badge>
      </div>

      <Alert variant="sage">
        หน้านี้แสดงข้อมูลแบบอ่านอย่างเดียวเพื่อความโปร่งใสและความเชื่อมั่นของครอบครัว
        รายการที่ยืนยันเสร็จสิ้นแล้วและภาพถ่ายหลักฐานไม่สามารถแก้ไขหรือลบย้อนหลังได้
      </Alert>

      {/* Search Filter */}
      <div className="relative max-w-md">
        <Search className="h-4 w-4 text-[#66736B] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ค้นหาชื่องานหรือวันที่ (เช่น 2026-11-23)..."
          className="pl-9"
        />
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-28 rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] animate-pulse"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-8 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 mx-auto text-[#66736B]" />
          <p className="font-semibold text-[#17241D]">
            {query
              ? "ไม่พบประวัติที่ตรงกับคำค้นหา"
              : "ยังไม่มีรายการดูแลที่ยืนยันเสร็จสิ้น"}
          </p>
          <p className="text-sm text-[#66736B]">
            เมื่อคุณแนบภาพถ่ายยืนยันและกดยืนยันทำเสร็จสิ้น รายการจะมาปรากฏในหน้านี้โดยอัตโนมัติ
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((occ) => (
            <article
              key={occ.id}
              className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 sm:p-5 space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-[#66736B]">
                      {formatThaiDate(occ.occurrence_date)}
                    </span>
                    <Badge variant={occ.is_delayed ? "warning" : "locked"}>
                      {occ.is_delayed ? "เสร็จล่าช้ากว่าเวลา" : "เสร็จตรงเวลา"}
                    </Badge>
                    {occ.is_medically_prescribed && (
                      <Badge variant="warning">
                        <Stethoscope className="h-3 w-3" />
                        สำคัญทางการแพทย์
                      </Badge>
                    )}
                  </div>

                  <h2 className="text-[17px] font-semibold text-[#17241D]">
                    {occ.title}
                  </h2>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-[#66736B]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-[#256B4A]" />
                      กำหนดการ: {occ.scheduled_time} น. (
                      {formatDuration(occ.duration_minutes)})
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#17241D] font-medium">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#256B4A]" />
                      ยืนยันเสร็จเมื่อ: {formatThaiTime(occ.completed_at)}
                    </span>
                  </div>
                </div>

                <Link
                  href={`/tasks/${occ.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-2.5 py-1.5 text-xs font-medium text-[#17241D] hover:bg-[#EAF3EC] hover:text-[#256B4A]"
                >
                  ดูรายละเอียด
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>

              {/* Private Evidence Thumbnails */}
              {occ.evidence.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs font-medium text-[#66736B] flex items-center gap-1">
                    <Camera className="h-3.5 w-3.5 text-[#256B4A]" />
                    ภาพถ่ายยืนยัน ({occ.evidence.length} รูป · เฉพาะบัญชีเจ้าของ)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {occ.evidence.map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={() =>
                          setLightbox({ evidence: ev, taskTitle: occ.title })
                        }
                        className="relative h-20 w-28 overflow-hidden rounded-md border border-[#E3E9E3] bg-[#FAFBF9] hover:border-[#256B4A] transition-colors"
                      >
                        <Image
                          src={getEvidenceUrl(ev)}
                          alt={`หลักฐาน ${occ.title}`}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {/* Lightbox Modal */}
      <Dialog
        open={Boolean(lightbox)}
        onClose={() => setLightbox(null)}
        title={lightbox?.taskTitle || "ภาพถ่ายยืนยันการดูแล"}
        description={
          lightbox
            ? `อัปโหลดเมื่อ ${formatThaiDateTime(lightbox.evidence.uploaded_at)} · ถูกล็อกถาวร`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {lightbox && (
          <div className="space-y-3">
            <div className="relative w-full aspect-[4/3] rounded-md overflow-hidden border border-[#E3E9E3] bg-[#FAFBF9]">
              <Image
                src={getEvidenceUrl(lightbox.evidence)}
                alt={lightbox.taskTitle}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
            <p className="text-xs text-[#66736B]">
              ภาพถ่ายหลักฐานจัดเก็บแบบส่วนตัว (Private Evidence Endpoint) และถูกล็อกถาวรหลังการยืนยันเสร็จสิ้น
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

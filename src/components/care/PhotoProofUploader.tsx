"use client";

import * as React from "react";
import Image from "next/image";
import {
  Camera,
  CheckCircle2,
  ImagePlus,
  Lock,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import {
  confirmOccurrenceCompletion,
  uploadOccurrenceEvidence,
} from "@/lib/api-client";
import { formatThaiDateTime, getEvidenceUrl } from "@/lib/utils";
import type {
  CompletionEvidence,
  DailyTaskOccurrence,
  NotificationDeliveryLog,
} from "@/types/careplan";

export interface PhotoProofUploaderProps {
  occurrence: DailyTaskOccurrence;
  onUpdated: (result: {
    occurrence: DailyTaskOccurrence;
    nextDependent?: DailyTaskOccurrence | null;
    notificationsCreated?: NotificationDeliveryLog[];
  }) => void;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

export function PhotoProofUploader({
  occurrence,
  onUpdated,
}: PhotoProofUploaderProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);
  const [lightboxItem, setLightboxItem] =
    React.useState<CompletionEvidence | null>(null);

  const isCompleted = occurrence.status === "completed" || occurrence.is_locked;
  const hasEvidence = occurrence.evidence.length > 0;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setError(null);
    setSuccessMsg(null);

    if (!file.type.startsWith("image/")) {
      setError("กรุณาเลือกไฟล์รูปภาพเท่านั้น (เช่น JPG, PNG, WEBP, HEIC)");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("ขนาดไฟล์รูปภาพต้องไม่เกิน 5 MB");
      return;
    }

    setUploading(true);
    try {
      const res = await uploadOccurrenceEvidence(occurrence.id, file);
      const updatedOccurrence: DailyTaskOccurrence = {
        ...occurrence,
        evidence: [...occurrence.evidence, res.evidence],
      };
      setSuccessMsg("อัปโหลดภาพถ่ายยืนยันเรียบร้อยแล้ว");
      onUpdated({ occurrence: updatedOccurrence });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "อัปโหลดภาพถ่ายไม่สำเร็จ"
      );
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (!hasEvidence) {
      setError("กรุณาแนบภาพถ่ายยืนยันอย่างน้อย 1 รูปก่อนกดยืนยันเสร็จสิ้น");
      return;
    }

    setConfirming(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await confirmOccurrenceCompletion(occurrence.id);
      setSuccessMsg(
        "ยืนยันทำเสร็จสิ้นเรียบร้อยแล้ว บันทึกและภาพถ่ายถูกล็อกถาวร"
      );
      onUpdated({
        occurrence: res.occurrence,
        nextDependent: res.next_dependent,
        notificationsCreated: res.notifications_created,
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถยืนยันงานเสร็จสิ้นได้"
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Policy Transparency Note */}
      <Alert variant={isCompleted ? "success" : "sage"}>
        {isCompleted ? (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#17241D]">
                เสร็จสิ้นและล็อกถาวรแล้ว (Immutable)
              </span>
              <Badge variant={occurrence.is_delayed ? "warning" : "locked"}>
                {occurrence.is_delayed ? "เสร็จล่าช้ากว่าเวลา" : "เสร็จตรงเวลา"}
              </Badge>
            </div>
            <p className="text-xs text-[#66736B]">
              เวลาที่ยืนยัน: {formatThaiDateTime(occurrence.completed_at)} ·
              ไม่สามารถแก้ไขหรือลบหลักฐานภาพถ่ายย้อนหลังได้
            </p>
          </div>
        ) : (
          <p className="text-xs sm:text-sm text-[#17241D]">
            <strong>นโยบายยืนยันงานด้วยภาพถ่าย:</strong>{" "}
            ระบบไม่ใช้ AI ตัดสินภาพถ่าย แต่บังคับต้องมีรูปยืนยันอย่างน้อย 1 รูปก่อนกดยืนยันเสร็จสิ้น
          </p>
        )}
      </Alert>

      {/* Evidence Thumbnails */}
      {hasEvidence ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[#17241D] flex items-center gap-1.5">
              <Camera className="h-4 w-4 text-[#256B4A]" />
              ภาพถ่ายยืนยัน ({occurrence.evidence.length} รูป)
            </p>
            {isCompleted && (
              <span className="inline-flex items-center gap-1 text-xs text-[#256B4A] font-medium">
                <Lock className="h-3 w-3" /> ล็อกถาวร
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {occurrence.evidence.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => setLightboxItem(ev)}
                className="group relative aspect-[4/3] w-full overflow-hidden rounded-md border border-[#E3E9E3] bg-[#FAFBF9] text-left"
              >
                <Image
                  src={getEvidenceUrl(ev)}
                  alt={ev.file_name || "ภาพถ่ายยืนยันการดูแล"}
                  fill
                  unoptimized
                  className="object-cover transition-transform group-hover:scale-[1.02]"
                />
                <span className="absolute bottom-0 inset-x-0 bg-[#17241D]/65 px-2 py-1 text-[11px] text-white truncate">
                  {ev.file_name}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#CBD6CD] bg-[#FAFBF9] px-4 py-5 text-center space-y-1.5">
          <ImagePlus className="h-6 w-6 mx-auto text-[#66736B]" />
          <p className="text-sm font-medium text-[#17241D]">
            ยังไม่มีภาพถ่ายยืนยันสำหรับงานนี้
          </p>
          <p className="text-xs text-[#66736B]">
            รองรับไฟล์ JPG, PNG, WEBP, HEIC (ไม่เกิน 5 MB) จัดเก็บแบบส่วนตัวเฉพาะบัญชีของคุณ
          </p>
        </div>
      )}

      {error && <Alert variant="error">{error}</Alert>}
      {successMsg && <Alert variant="success">{successMsg}</Alert>}

      {/* Action Buttons (only while incomplete) */}
      {!isCompleted && (
        <div className="space-y-2.5 pt-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/*"
            onChange={handleFileChange}
            className="sr-only"
            aria-label="เลือกไฟล์ภาพถ่ายยืนยัน"
          />

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              loading={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1"
            >
              <Upload className="h-4 w-4" />
              {hasEvidence ? "แนบภาพถ่ายเพิ่มเติม" : "อัปโหลดภาพถ่ายยืนยัน"}
            </Button>

            <Button
              variant="primary"
              loading={confirming}
              disabled={!hasEvidence || uploading}
              onClick={handleConfirm}
              className="flex-1"
            >
              <CheckCircle2 className="h-4 w-4" />
              ยืนยันทำเสร็จสิ้น
            </Button>
          </div>

          {!hasEvidence && (
            <p className="text-xs text-[#66736B] flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#256B4A] shrink-0" />
              ปุ่ม “ยืนยันทำเสร็จสิ้น” จะเปิดใช้งานเมื่ออัปโหลดภาพถ่ายยืนยันอย่างน้อย 1 รูปแล้ว
            </p>
          )}
        </div>
      )}

      {/* Lightbox Modal for Private Evidence Preview */}
      <Dialog
        open={Boolean(lightboxItem)}
        onClose={() => setLightboxItem(null)}
        title={lightboxItem?.file_name || "ภาพถ่ายยืนยันการดูแล"}
        description={
          lightboxItem
            ? `อัปโหลดเมื่อ ${formatThaiDateTime(lightboxItem.uploaded_at)}`
            : undefined
        }
        maxWidthClass="max-w-2xl"
      >
        {lightboxItem && (
          <div className="space-y-3">
            <div className="relative w-full aspect-[4/3] rounded-md overflow-hidden border border-[#E3E9E3] bg-[#FAFBF9]">
              <Image
                src={getEvidenceUrl(lightboxItem)}
                alt={lightboxItem.file_name || "ภาพถ่ายยืนยัน"}
                fill
                unoptimized
                className="object-contain"
              />
            </div>
            <p className="text-xs text-[#66736B]">
              ภาพถ่ายนี้เข้าถึงได้เฉพาะเจ้าของบัญชีผ่าน Private API เท่านั้น
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}

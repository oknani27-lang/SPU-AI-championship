"use client";

import * as React from "react";
import {
  Check,
  Clock,
  Coffee,
  EyeOff,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import {
  generateRestSuggestions,
  getRestSuggestions,
  updateRestSuggestionStatus,
} from "@/lib/api-client";
import { formatDuration } from "@/lib/utils";
import type { RestSuggestionRecord } from "@/types/careplan";

export interface RestSuggestionsPanelProps {
  date: string;
  refreshSignal?: number;
}

export function RestSuggestionsPanel({
  date,
  refreshSignal = 0,
}: RestSuggestionsPanelProps) {
  const [suggestions, setSuggestions] = React.useState<RestSuggestionRecord[]>(
    []
  );
  const [loading, setLoading] = React.useState(true);
  const [generating, setGenerating] = React.useState(false);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadSuggestions = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRestSuggestions(date);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถโหลดคำแนะนำช่วงพักได้"
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  React.useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions, refreshSignal]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateRestSuggestions(date);
      setSuggestions(res.suggestions || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "ไม่สามารถวิเคราะห์ช่วงเวลาพักได้"
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleStatusChange = async (
    id: string,
    status: "accepted" | "dismissed" | "ignored"
  ) => {
    setUpdatingId(id);
    setError(null);
    try {
      const res = await updateRestSuggestionStatus(id, status);
      setSuggestions((prev) =>
        prev.map((item) => (item.id === id ? res.suggestion : item))
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "ไม่สามารถอัปเดตสถานะได้"
      );
    } finally {
      setUpdatingId(null);
    }
  };

  const visibleSuggestions = suggestions.filter((s) => s.status !== "ignored");

  return (
    <section className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-4 sm:p-5 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[16px] font-semibold text-[#17241D] flex items-center gap-2">
            <Coffee className="h-4 w-4 text-[#256B4A]" />
            ช่วงเวลาพักผ่อนสำหรับผู้ดูแล
          </h3>
          <p className="text-xs text-[#66736B] mt-0.5">
            เป็นทางเลือกเสริม ไม่บังคับ ไม่ต้องถ่ายรูปยืนยัน และไม่กระทบคะแนนการดูแล
          </p>
        </div>

        <Button
          size="sm"
          variant="outline"
          loading={generating}
          onClick={handleGenerate}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          หาช่วงพักจากตาราง
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {loading && suggestions.length === 0 ? (
        <div className="h-16 rounded-md bg-[#FAFBF9] animate-pulse" />
      ) : visibleSuggestions.length === 0 ? (
        <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-4 text-center space-y-2">
          <p className="text-sm text-[#66736B]">
            ยังไม่มีคำแนะนำช่วงเวลาพักสำหรับวันนี้
          </p>
          <Button
            size="sm"
            variant="secondary"
            loading={generating}
            onClick={handleGenerate}
          >
            วิเคราะห์ช่วงว่างเพื่อพักผ่อน
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {visibleSuggestions.map((item) => {
            const isBusy = updatingId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-3.5 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#256B4A] bg-[#EAF3EC] border border-[#CFE3D4] rounded px-2 py-0.5 tabular-nums">
                    <Clock className="h-3 w-3" />
                    {item.gap_start}–{item.gap_end} (
                    {formatDuration(item.duration_minutes)})
                  </span>

                  {item.status === "accepted" && (
                    <Badge variant="sage">รับคำแนะนำแล้ว</Badge>
                  )}
                  {item.status === "dismissed" && (
                    <Badge variant="neutral">ข้ามช่วงนี้แล้ว</Badge>
                  )}
                </div>

                <div>
                  <p className="text-[15px] font-semibold text-[#17241D]">
                    {item.activity_title}
                  </p>
                  <p className="text-xs sm:text-sm text-[#66736B] mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                </div>

                {item.supervision_safety_note && (
                  <p className="flex items-start gap-1.5 rounded bg-[#FDF6F0] border border-[#EBCBB2] px-2.5 py-1.5 text-xs text-[#7A441D]">
                    <ShieldAlert className="h-3.5 w-3.5 text-[#B86A32] mt-0.5 shrink-0" />
                    <span>{item.supervision_safety_note}</span>
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    variant={
                      item.status === "accepted" ? "primary" : "secondary"
                    }
                    disabled={isBusy}
                    onClick={() => void handleStatusChange(item.id, "accepted")}
                    className="h-7 px-2.5 text-xs"
                  >
                    <Check className="h-3.5 w-3.5" />
                    รับคำแนะนำ
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      void handleStatusChange(item.id, "dismissed")
                    }
                    className="h-7 px-2.5 text-xs"
                  >
                    <X className="h-3.5 w-3.5" />
                    ข้าม
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={() => void handleStatusChange(item.id, "ignored")}
                    className="h-7 px-2.5 text-xs text-[#66736B]"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    ซ่อน
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

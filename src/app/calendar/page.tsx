"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  Calendar as CalendarIcon,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Download,
  Stethoscope,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { useSession } from "@/components/care/SessionContext";
const CalendarEventModal = dynamic(() => import("@/components/care/CalendarEventModal").then(module => module.CalendarEventModal));
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import {
  getCalendarEvents,
  getOccurrencesByDate,
  getOccurrencesByWeek,
  getSchedule,
} from "@/lib/api-client";
import {
  addDays,
  cn,
  formatIsoDateUtc,
  formatThaiDate,
  getBangkokToday,
  getDayOfWeek,
  getWeekDates,
  getWeekMonday,
  parseIsoDate,
  THAI_MONTHS_FULL,
} from "@/lib/utils";
import {
  ALL_DAYS,
  THAI_DAY_NAMES,
  type CalendarEventOccurrence,
  type CalendarEventRecord,
  type DailyTaskOccurrence,
  type DayOfWeek,
  type RecurringTaskTemplate,
  type WeeklyScheduleTemplate,
} from "@/types/careplan";
import { isValidDateString } from "@/lib/timezone";

type CalendarViewMode = "month" | "week" | "day";

function getMonthGridBounds(anchorDate: string): {
  year: number;
  month: number; // 0-indexed
  gridStart: string;
  gridEnd: string;
  cells: Array<{ date: string; inCurrentMonth: boolean; dayNumber: number; dow: DayOfWeek }>;
} {
  const dt = parseIsoDate(anchorDate);
  const year = dt.getUTCFullYear();
  const month = dt.getUTCMonth();
  const firstOfMonth = formatIsoDateUtc(new Date(Date.UTC(year, month, 1, 12)));
  const gridStart = getWeekMonday(firstOfMonth);

  const cells: Array<{
    date: string;
    inCurrentMonth: boolean;
    dayNumber: number;
    dow: DayOfWeek;
  }> = [];
  for (let i = 0; i < 42; i++) {
    const date = addDays(gridStart, i);
    const cellDt = parseIsoDate(date);
    cells.push({
      date,
      inCurrentMonth: cellDt.getUTCMonth() === month,
      dayNumber: cellDt.getUTCDate(),
      dow: getDayOfWeek(date),
    });
  }
  return {
    year,
    month,
    gridStart,
    gridEnd: cells[41].date,
    cells,
  };
}

function shiftMonth(anchorDate: string, deltaMonths: number): string {
  const dt = parseIsoDate(anchorDate);
  const y = dt.getUTCFullYear();
  const m = dt.getUTCMonth() + deltaMonths;
  return formatIsoDateUtc(new Date(Date.UTC(y, m, 1, 12)));
}

function getTemplatesForDate(
  templates: RecurringTaskTemplate[],
  restDays: DayOfWeek[],
  date: string
): RecurringTaskTemplate[] {
  const dow = getDayOfWeek(date);
  if (restDays.includes(dow)) return [];
  return templates
    .filter(
      (t) =>
        t.is_active &&
        t.day_of_week === dow &&
        t.effective_from_date <= date &&
        (t.effective_until_date === null || t.effective_until_date >= date)
    )
    .sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
}

export default function CalendarPage() {
  return (
    <AppShell>
      <React.Suspense fallback={<p role="status">กำลังเปิดปฏิทิน…</p>}><CalendarContent /></React.Suspense>
    </AppShell>
  );
}

function CalendarContent() {
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const { demoVersion } = useSession();
  const today = React.useMemo(() => getBangkokToday(), []);

  const [viewMode, setViewMode] = React.useState<CalendarViewMode>("month");
  const [selectedDate, setSelectedDate] = React.useState<string>(today);

  const [schedule, setSchedule] = React.useState<WeeklyScheduleTemplate | null>(
    null
  );
  const [templates, setTemplates] = React.useState<RecurringTaskTemplate[]>([]);
  const [events, setEvents] = React.useState<CalendarEventRecord[]>([]);
  const [eventOccurrences, setEventOccurrences] = React.useState<
    CalendarEventOccurrence[]
  >([]);
  const [dayTasks, setDayTasks] = React.useState<DailyTaskOccurrence[]>([]);
  const [dayIsRest, setDayIsRest] = React.useState(false);
  const [weekTaskMap, setWeekTaskMap] = React.useState<
    Record<string, { isRest: boolean; tasks: DailyTaskOccurrence[] }>
  >({});

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const loadRequest = React.useRef(0);

  // Modal state
  const [modalOpen, setModalOpen] = React.useState(false);
  const [modalDefaultDate, setModalDefaultDate] = React.useState(today);
  const [defaultEventType, setDefaultEventType] = React.useState<"general" | "doctor">("general");
  const handledQuery = React.useRef("");
  const [editingOccurrence, setEditingOccurrence] =
    React.useState<CalendarEventOccurrence | null>(null);
  const [editingRecord, setEditingRecord] =
    React.useState<CalendarEventRecord | null>(null);

  React.useEffect(() => {
    const date = searchParams.get("date");
    if (date && isValidDateString(date)) setSelectedDate(date);
  }, [queryKey, searchParams]);

  const monthGrid = React.useMemo(
    () => getMonthGridBounds(selectedDate),
    [selectedDate]
  );
  const weekMonday = React.useMemo(
    () => getWeekMonday(selectedDate),
    [selectedDate]
  );
  const weekDays = React.useMemo(() => getWeekDates(weekMonday), [weekMonday]);

  const loadData = React.useCallback(async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    setError(null);
    try {
      const rangeStart =
        viewMode === "month"
          ? monthGrid.gridStart
          : viewMode === "week"
          ? weekMonday
          : selectedDate;
      const rangeEnd =
        viewMode === "month"
          ? monthGrid.gridEnd
          : viewMode === "week"
          ? addDays(weekMonday, 6)
          : selectedDate;

      const [schedRes, calRes, dayRes, weekRes] = await Promise.all([
        getSchedule(),
        getCalendarEvents(rangeStart, rangeEnd),
        viewMode === "week" ? Promise.resolve(null) : getOccurrencesByDate(selectedDate),
        viewMode === "week"
          ? getOccurrencesByWeek(weekMonday)
          : Promise.resolve(null),
      ]);

      if (request !== loadRequest.current) return;

      setSchedule(schedRes.weekly_schedule);
      setTemplates(schedRes.templates || []);
      setEvents(calRes.events || []);
      setEventOccurrences(calRes.occurrences || []);
      const selectedDay = dayRes ?? weekRes?.days?.find(day => day.date === selectedDate);
      setDayTasks(selectedDay?.occurrences || []);
      setDayIsRest(Boolean(selectedDay?.is_rest_day));

      if (weekRes) {
        const nextMap: Record<
          string,
          { isRest: boolean; tasks: DailyTaskOccurrence[] }
        > = {};
        for (const d of weekRes.days || []) {
          nextMap[d.date] = {
            isRest: d.is_rest_day,
            tasks: d.occurrences || [],
          };
        }
        setWeekTaskMap(nextMap);
      }
    } catch (err) {
      if (request !== loadRequest.current) return;
      setError(
        err instanceof Error ? err.message : "ไม่สามารถโหลดข้อมูลปฏิทินได้"
      );
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }, [viewMode, monthGrid.gridStart, monthGrid.gridEnd, weekMonday, selectedDate]);

  React.useEffect(() => {
    const requestState = loadRequest;
    void loadData();
    return () => { requestState.current++; };
  }, [loadData, demoVersion]);

  const eventsByDate = React.useMemo(() => {
    const map = new Map<string, CalendarEventOccurrence[]>();
    for (const occ of eventOccurrences) {
      let cursor = occ.occurrence_date;
      let guard = 0;
      while (cursor <= occ.end_date && guard < 31) {
        const list = map.get(cursor) ?? [];
        list.push(occ);
        map.set(cursor, list);
        cursor = addDays(cursor, 1);
        guard++;
      }
    }
    return map;
  }, [eventOccurrences]);

  const restDays = schedule?.rest_days ?? [];

  const openCreateModal = (date: string) => {
    setDefaultEventType("general");
    setEditingOccurrence(null);
    setEditingRecord(null);
    setModalDefaultDate(date);
    setModalOpen(true);
  };

  const openEditModal = (occ: CalendarEventOccurrence) => {
    const rec = events.find((e) => e.id === occ.event_id) ?? null;
    setEditingOccurrence(occ);
    setEditingRecord(rec);
    setModalDefaultDate(occ.occurrence_date);
    setModalOpen(true);
  };

  React.useEffect(() => {
    if (!queryKey || handledQuery.current === queryKey) return;
    if (searchParams.get("new") === "doctor") {
      handledQuery.current = queryKey;
      setEditingOccurrence(null); setEditingRecord(null);
      setDefaultEventType("doctor"); setModalDefaultDate(selectedDate); setModalOpen(true);
      return;
    }
    const id = searchParams.get("event"), date = searchParams.get("date");
    if (!id || !date || !isValidDateString(date) || loading || selectedDate !== date) return;
    const occurrence = eventOccurrences.find(event => event.event_id === id && event.occurrence_date === date);
    const record = events.find(event => event.id === id);
    if (!occurrence || !record) return;
    handledQuery.current = queryKey;
    setEditingOccurrence(occurrence); setEditingRecord(record);
    setModalDefaultDate(date); setModalOpen(true);
  }, [queryKey, searchParams, selectedDate, loading, eventOccurrences, events]);

  const handleNavigate = (direction: -1 | 1) => {
    if (viewMode === "month") {
      setSelectedDate((d) => shiftMonth(d, direction));
    } else if (viewMode === "week") {
      setSelectedDate((d) => addDays(d, direction * 7));
    } else {
      setSelectedDate((d) => addDays(d, direction));
    }
  };

  const periodHeading = React.useMemo(() => {
    if (viewMode === "month") {
      return `${THAI_MONTHS_FULL[monthGrid.month]} ${monthGrid.year + 543}`;
    }
    if (viewMode === "week") {
      return `${formatThaiDate(weekMonday, { includeWeekday: false })} – ${formatThaiDate(
        addDays(weekMonday, 6),
        { includeWeekday: false }
      )}`;
    }
    return formatThaiDate(selectedDate, { fullMonth: true });
  }, [viewMode, monthGrid.month, monthGrid.year, weekMonday, selectedDate]);

  const selectedDayEvents = eventsByDate.get(selectedDate) ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17241D] flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-[#256B4A]" />
            ปฏิทิน
          </h1>

        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/calendar/ics?scope=week&date=${encodeURIComponent(selectedDate)}`}
            download
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-3 text-sm font-medium text-[#17241D] hover:bg-[#F4F7F4] transition-colors"
          >
            <Download className="h-4 w-4 text-[#256B4A]" />
            ส่งออก .ics
          </a>
          <Button
            variant="primary"
            onClick={() => openCreateModal(selectedDate)}
          >
            <CalendarPlus className="h-4 w-4" />
            เพิ่มกิจกรรม
          </Button>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {/* Apple Calendar-style Toolbar */}
      <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] p-3 flex flex-wrap items-center justify-between gap-3">
        {/* Left: Period Nav */}
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="outline"
            aria-label="ช่วงเวลาก่อนหน้า"
            onClick={() => handleNavigate(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedDate(today)}
          >
            วันนี้
          </Button>
          <Button
            size="icon"
            variant="outline"
            aria-label="ช่วงเวลาถัดไป"
            onClick={() => handleNavigate(1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="ml-1.5 text-base sm:text-lg font-semibold text-[#17241D]">
            {periodHeading}
          </h2>
        </div>

        {/* Right: Segmented View Switcher (Month | Week | Day) */}
        <div
          role="tablist"
          aria-label="มุมมองปฏิทิน"
          className="inline-flex rounded-md border border-[#E3E9E3] bg-[#FAFBF9] p-0.5"
        >
          {(
            [
              { id: "month", label: "เดือน" },
              { id: "week", label: "สัปดาห์" },
              { id: "day", label: "วัน" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={viewMode === tab.id}
              onClick={() => setViewMode(tab.id)}
              className={cn(
                "rounded px-3.5 py-1.5 text-sm font-medium transition-colors",
                viewMode === tab.id
                  ? "bg-[#256B4A] text-white shadow-xs"
                  : "text-[#66736B] hover:text-[#17241D]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ==================== MONTH VIEW ==================== */}
      {viewMode === "month" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] overflow-hidden">
            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-[#E3E9E3] bg-[#FAFBF9]">
              {ALL_DAYS.map((dow) => (
                <div
                  key={dow}
                  className="py-2 text-center text-xs font-semibold text-[#66736B]"
                >
                  {THAI_DAY_NAMES[dow].short}
                </div>
              ))}
            </div>

            {/* 6x7 Month Cells */}
            <div className="grid grid-cols-7 divide-x divide-y divide-[#E3E9E3]">
              {monthGrid.cells.map((cell) => {
                const isToday = cell.date === today;
                const isSelected = cell.date === selectedDate;
                const isRest = restDays.includes(cell.dow);
                // shortcut: month grid task badges derive from active weekly templates (not per-day hydrated status) to avoid 42 API calls; clicking any day loads exact occurrences below
                const cellTemplates = getTemplatesForDate(
                  templates,
                  restDays,
                  cell.date
                );
                const cellEvents = eventsByDate.get(cell.date) ?? [];

                return (
                  <div
                    key={cell.date}
                    onClick={() => setSelectedDate(cell.date)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedDate(cell.date);
                      }
                    }}
                    className={cn(
                      "min-h-[82px] sm:min-h-[108px] p-1.5 sm:p-2 text-left transition-colors cursor-pointer flex flex-col gap-1",
                      !cell.inCurrentMonth && "bg-[#FAFBF9]/80 text-[#9AA69E]",
                      isSelected && "bg-[#EAF3EC]/55 ring-1 ring-inset ring-[#256B4A]",
                      !isSelected && cell.inCurrentMonth && "hover:bg-[#FAFBF9]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums",
                          isToday
                            ? "bg-[#256B4A] text-white"
                            : cell.inCurrentMonth
                            ? "text-[#17241D]"
                            : "text-[#9AA69E]"
                        )}
                      >
                        {cell.dayNumber}
                      </span>
                      {isRest && cell.inCurrentMonth && (
                        <span className="hidden sm:inline-block rounded bg-[#F1F4F1] px-1 py-0.5 text-[10px] text-[#66736B]">
                          วันพัก
                        </span>
                      )}
                    </div>

                    {/* Desktop/tablet compact event & task pills */}
                    <div className="hidden sm:flex flex-col gap-0.5 min-w-0">
                      {cellEvents.slice(0, 2).map((ev) => (
                        <button
                          key={ev.occurrence_key}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditModal(ev);
                          }}
                          className="truncate rounded bg-[#FDF6F0] border border-[#EBCBB2] px-1.5 py-0.5 text-left text-[11px] font-medium text-[#7A441D] hover:bg-[#F9E8D9]"
                          title={`${ev.is_all_day ? "ตลอดวัน" : ev.start_time} ${ev.title}`}
                        >
                          {ev.is_all_day ? "ตลอดวัน" : ev.start_time} {ev.title}
                        </button>
                      ))}
                      {cellTemplates
                        .slice(0, Math.max(0, 2 - Math.min(2, cellEvents.length)))
                        .map((tpl) => (
                          <div
                            key={tpl.id}
                            className="truncate rounded bg-[#EAF3EC] px-1.5 py-0.5 text-[11px] text-[#1E583C]"
                            title={`${tpl.scheduled_time} ${tpl.title}`}
                          >
                            {tpl.scheduled_time} {tpl.title}
                          </div>
                        ))}
                      {cellEvents.length + cellTemplates.length > 2 && (
                        <span className="text-[10px] font-medium text-[#66736B] pl-1">
                          +{cellEvents.length + cellTemplates.length - 2} รายการ
                        </span>
                      )}
                    </div>

                    {/* Mobile indicator dots */}
                    <div className="flex sm:hidden items-center gap-1 mt-auto pt-1">
                      {cellTemplates.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[#256B4A] font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#256B4A]" />
                          {cellTemplates.length}
                        </span>
                      )}
                      {cellEvents.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-[#B86A32] font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#B86A32]" />
                          {cellEvents.length}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Date Agenda Panel (clicking any date opens its schedule) */}
          <SelectedDaySchedulePanel
            date={selectedDate}
            isRestDay={dayIsRest}
            tasks={dayTasks}
            events={selectedDayEvents}
            loading={loading}
            onCreateEvent={() => openCreateModal(selectedDate)}
            onEditEvent={openEditModal}
            onOpenDayView={() => setViewMode("day")}
          />
        </div>
      )}

      {/* ==================== WEEK VIEW ==================== */}
      {viewMode === "week" && (
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5">
          {weekDays.map((wd) => {
            const isToday = wd.date === today;
            const isSelected = wd.date === selectedDate;
            const dayInfo = weekTaskMap[wd.date];
            const isRest = dayInfo ? dayInfo.isRest : restDays.includes(wd.dayOfWeek);
            const tasks = dayInfo?.tasks ?? [];
            const dayEvs = eventsByDate.get(wd.date) ?? [];

            return (
              <div
                key={wd.date}
                className={cn(
                  "rounded-lg border bg-[#FFFFFF] flex flex-col min-h-[260px]",
                  isSelected
                    ? "border-[#256B4A] ring-1 ring-[#256B4A]/20"
                    : "border-[#E3E9E3]"
                )}
              >
                <div
                  onClick={() => {
                    setSelectedDate(wd.date);
                    setViewMode("day");
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedDate(wd.date);
                      setViewMode("day");
                    }
                  }}
                  className={cn(
                    "border-b border-[#E3E9E3] px-3 py-2 flex items-center justify-between cursor-pointer rounded-t-lg",
                    isToday ? "bg-[#EAF3EC]" : "bg-[#FAFBF9]"
                  )}
                >
                  <div>
                    <p className="text-xs font-medium text-[#66736B]">
                      {wd.shortThai}
                    </p>
                    <p
                      className={cn(
                        "text-base font-bold tabular-nums",
                        isToday ? "text-[#256B4A]" : "text-[#17241D]"
                      )}
                    >
                      {wd.dayNumber}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      openCreateModal(wd.date);
                    }}
                    aria-label={`เพิ่มกิจกรรมวันที่ ${wd.date}`}
                    className="rounded p-1 text-[#256B4A] hover:bg-[#EAF3EC]"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="p-2 space-y-1.5 flex-1">
                  {isRest && (
                    <div className="rounded bg-[#FAFBF9] border border-[#E3E9E3] px-2 py-1 text-[11px] text-[#66736B] flex items-center gap-1">
                      <Coffee className="h-3 w-3 text-[#256B4A]" />
                      วันพักตาราง
                    </div>
                  )}

                  {dayEvs.map((ev) => (
                    <button
                      key={ev.occurrence_key}
                      type="button"
                      onClick={() => openEditModal(ev)}
                      className="w-full text-left rounded-md border border-[#EBCBB2] bg-[#FDF6F0] px-2 py-1.5 hover:bg-[#F9E8D9] transition-colors"
                    >
                      <p className="text-[11px] font-semibold text-[#B86A32] tabular-nums">
                        {ev.is_all_day
                          ? "ตลอดวัน"
                          : `${ev.start_time}–${ev.end_time}`}
                      </p>
                      <p className="text-xs font-medium text-[#17241D] leading-snug line-clamp-2">
                        {ev.title}
                      </p>
                    </button>
                  ))}

                  {tasks.map((task) => {
                    const completed = task.status === "completed";
                    return (
                      <Link
                        key={task.id}
                        href={`/tasks/${task.id}`}
                        className={cn(
                          "block rounded-md border px-2 py-1.5 transition-colors",
                          completed
                            ? "border-[#CFE3D4] bg-[#EAF3EC]/60"
                            : "border-[#E3E9E3] bg-[#FFFFFF] hover:border-[#256B4A]/40"
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-semibold text-[#256B4A] tabular-nums">
                            {task.scheduled_time}
                          </span>
                          {completed && (
                            <CheckCircle2 className="h-3 w-3 text-[#256B4A] shrink-0" />
                          )}
                        </div>
                        <p className="text-xs font-medium text-[#17241D] leading-snug line-clamp-2">
                          {task.title}
                        </p>
                      </Link>
                    );
                  })}

                  {!isRest && tasks.length === 0 && dayEvs.length === 0 && (
                    <p className="text-xs text-[#66736B] text-center py-6">
                      ไม่มีรายการ
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== DAY VIEW ==================== */}
      {viewMode === "day" && (
        <SelectedDaySchedulePanel
          date={selectedDate}
          isRestDay={dayIsRest}
          tasks={dayTasks}
          events={selectedDayEvents}
          loading={loading}
          onCreateEvent={() => openCreateModal(selectedDate)}
          onEditEvent={openEditModal}
          fullPage
        />
      )}

      {/* Event Create / Edit / Delete Modal */}
      {modalOpen && <CalendarEventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultDate={modalDefaultDate}
        defaultEventType={defaultEventType}
        editingOccurrence={editingOccurrence}
        editingRecord={editingRecord}
        onSaved={() => void loadData()}
      />}
    </div>
  );
}

interface SelectedDaySchedulePanelProps {
  date: string;
  isRestDay: boolean;
  tasks: DailyTaskOccurrence[];
  events: CalendarEventOccurrence[];
  loading: boolean;
  onCreateEvent: () => void;
  onEditEvent: (occ: CalendarEventOccurrence) => void;
  onOpenDayView?: () => void;
  fullPage?: boolean;
}

function SelectedDaySchedulePanel({
  date,
  isRestDay,
  tasks,
  events,
  loading,
  onCreateEvent,
  onEditEvent,
  onOpenDayView,
  fullPage = false,
}: SelectedDaySchedulePanelProps) {
  const allDayEvents = events.filter((e) => e.is_all_day);
  const timedItems = React.useMemo(() => {
    const items: Array<
      | { kind: "task"; sortTime: string; task: DailyTaskOccurrence }
      | { kind: "event"; sortTime: string; event: CalendarEventOccurrence }
    > = [];

    for (const task of tasks) {
      items.push({ kind: "task", sortTime: task.scheduled_time, task });
    }
    for (const ev of events.filter((e) => !e.is_all_day)) {
      items.push({ kind: "event", sortTime: ev.start_time, event: ev });
    }
    return items.sort((a, b) => a.sortTime.localeCompare(b.sortTime));
  }, [tasks, events]);


  return (
    <section className="rounded-lg border border-[#E3E9E3] bg-white p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-[#17241D]">{formatThaiDate(date, { fullMonth: true })}</h3>
        <div className="flex gap-2">{!fullPage && onOpenDayView && <Button size="sm" variant="ghost" onClick={onOpenDayView}>ดูทั้งวัน</Button>}<Button size="sm" variant="secondary" onClick={onCreateEvent}><CalendarPlus className="h-3.5 w-3.5" />เพิ่มกิจกรรม</Button></div>
      </div>
      {isRestDay && <p className="rounded-md bg-[#F0F5EE] p-3 text-xs text-[#66736B]">วันพักตาราง · การดูแลตามแพทย์กำหนดยังคงเดิม</p>}
      {loading ? <div className="h-16 animate-pulse rounded bg-[#F4F7F4]" /> : timedItems.length === 0 && allDayEvents.length === 0 ? <p className="py-8 text-center text-sm text-[#66736B]">วันนี้ยังไม่มีรายการ</p> : <div className="divide-y divide-[#E3E9E3]">
        {allDayEvents.map(ev => <button key={ev.occurrence_key} type="button" onClick={() => onEditEvent(ev)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-[#FAFBF9]"><span className="w-16 shrink-0 text-xs text-[#B86A32]">ทั้งวัน</span><span className="min-w-0 flex-1 break-words text-sm font-medium">{ev.title}</span><ChevronRight className="h-4 w-4 shrink-0 text-[#87958C]" /></button>)}
        {timedItems.map(item => {
          if (item.kind === "event") { const ev = item.event; return <button key={ev.occurrence_key} type="button" onClick={() => onEditEvent(ev)} className="flex w-full items-center gap-3 py-3.5 text-left hover:bg-[#FAFBF9]"><span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-[#B86A32]">{ev.start_time}</span><span className="min-w-0 flex-1 break-words text-sm font-medium">{ev.title}</span>{ev.event_type === "doctor" && <Stethoscope className="h-4 w-4 text-[#48735B] shrink-0" aria-label="นัดพบแพทย์" />}<ChevronRight className="h-4 w-4 shrink-0 text-[#87958C]" /></button>; }
          const task = item.task, completed = task.status === "completed";
          return <Link key={task.id} href={`/tasks/${task.id}`} className="flex items-center gap-3 py-3.5 hover:bg-[#FAFBF9]"><span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-[#256B4A]">{task.scheduled_time}</span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{task.title}</span>{task.is_medically_prescribed && <span className="text-[11px] text-[#66736B]">ตามแพทย์กำหนด</span>}</span>{completed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[#256B4A]" aria-label="เสร็จแล้ว" /> : <ChevronRight className="h-4 w-4 shrink-0 text-[#87958C]" />}</Link>;
        })}
      </div>}
    </section>
  );
}

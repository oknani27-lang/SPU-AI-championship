"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  CalendarRange,
  CheckCheck,
  Clock,
  FileBarChart2,
  History,
  Home,
  LogOut,
  RotateCcw,
  Settings,
  User,
} from "lucide-react";
import { AuthGate } from "@/components/care/AuthGate";
import { useSession } from "@/components/care/SessionContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getReminders,
  markReminderRead,
  processReminders,
} from "@/lib/api-client";
import {
  buildBangkokIso,
  cn,
  formatThaiTime,
  getBangkokNowTime,
  getBangkokToday,
} from "@/lib/utils";
import type { NotificationDeliveryLog } from "@/types/careplan";

const NAV_ITEMS = [
  { href: "/", label: "วันนี้", fullLabel: "วันนี้ / แดชบอร์ด", icon: Home },
  {
    href: "/schedule",
    label: "ตารางสัปดาห์",
    fullLabel: "ตารางสัปดาห์",
    icon: CalendarRange,
  },
  {
    href: "/history",
    label: "ประวัติ",
    fullLabel: "ประวัติการดูแล",
    icon: History,
  },
  {
    href: "/summary",
    label: "สรุปวัน",
    fullLabel: "สรุปประจำวัน",
    icon: FileBarChart2,
  },
  {
    href: "/settings",
    label: "ตั้งค่า",
    fullLabel: "ตั้งค่า",
    icon: Settings,
  },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppShellInner>{children}</AppShellInner>
    </AuthGate>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { session, startDemo, logout, demoVersion } = useSession();

  const [resettingDemo, setResettingDemo] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);

  // Notifications popover state
  const [bellOpen, setBellOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<
    NotificationDeliveryLog[]
  >([]);
  const [loadingBell, setLoadingBell] = React.useState(false);
  const [simulating, setSimulating] = React.useState(false);
  const [simulateTime, setSimulateTime] = React.useState(() =>
    getBangkokNowTime()
  );
  const [simFeedback, setSimFeedback] = React.useState<string | null>(null);
  const bellRef = React.useRef<HTMLDivElement>(null);

  const loadNotifications = React.useCallback(async () => {
    setLoadingBell(true);
    try {
      const res = await getReminders();
      setNotifications(res.notifications || []);
    } catch {
      // Quietly handle if offline; user can click simulate or reload
    } finally {
      setLoadingBell(false);
    }
  }, []);

  React.useEffect(() => {
    if (!session?.authenticated) return;
    void loadNotifications();

    // Open-tab automatic reminder check every 60 seconds (respecting user preference & quiet hours on server)
    const runOpenTabCheck = async () => {
      try {
        const res = await processReminders({ date: getBangkokToday() });
        if (res.delivered && res.delivered.length > 0) {
          await loadNotifications();
          if (
            typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            for (const item of res.delivered.slice(0, 2)) {
              try {
                new Notification(item.title, { body: item.body });
              } catch {
                // Ignore restricted browser notification errors
              }
            }
          }
        }
      } catch {
        // Ignore transient background poll errors
      }
    };

    const intervalId = window.setInterval(() => {
      void runOpenTabCheck();
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [session?.authenticated, demoVersion, loadNotifications]);

  // Close notification popover on outside click / Esc
  React.useEffect(() => {
    if (!bellOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setBellOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [bellOpen]);

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleResetDemo = async () => {
    setResettingDemo(true);
    try {
      await startDemo(true);
      await loadNotifications();
    } finally {
      setResettingDemo(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleSimulateReminders = async () => {
    setSimulating(true);
    setSimFeedback(null);
    try {
      const today = getBangkokToday();
      const simIso = buildBangkokIso(today, simulateTime || getBangkokNowTime());
      const res = await processReminders({
        date: today,
        simulate_now: simIso,
      });

      await loadNotifications();

      if (res.delivered && res.delivered.length > 0) {
        setSimFeedback(
          `ส่งการแจ้งเตือนแล้ว ${res.delivered.length} รายการ (เวลาจำลอง ${simulateTime} น.)`
        );
        // Trigger Browser Notification API if permission is granted
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          for (const item of res.delivered.slice(0, 3)) {
            try {
              new Notification(item.title, { body: item.body });
            } catch {
              // Ignore browser notification errors in restricted contexts
            }
          }
        }
      } else if (res.skipped_reason) {
        setSimFeedback(res.skipped_reason);
      } else {
        setSimFeedback(
          `ไม่มีงานที่ถึงเวลาแจ้งเตือน ณ เวลาจำลอง ${simulateTime} น. (ลองปรับเวลาเป็นช่วงหลังเวลาเริ่มงาน)`
        );
      }
    } catch (err) {
      setSimFeedback(
        err instanceof Error
          ? err.message
          : "ไม่สามารถจำลองการแจ้งเตือนได้"
      );
    } finally {
      setSimulating(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await markReminderRead(id);
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
    } catch {
      // ignore
    }
  };

  const isNavActive = (href: string) => {
    if (href === "/") {
      return pathname === "/" || pathname.startsWith("/tasks/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <div className="min-h-screen bg-[#FAFBF9] text-[#17241D] flex flex-col lg:flex-row">
      {/* Desktop Minimal Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-[224px] lg:shrink-0 lg:flex-col border-r border-[#E3E9E3] bg-[#FFFFFF] sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-5 h-15 border-b border-[#E3E9E3]">
          <div className="h-8 w-8 rounded-md bg-[#256B4A] text-white flex items-center justify-center shrink-0">
            <CalendarCheck2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-[16px] leading-tight text-[#17241D]">
              CarePlan
            </p>
            <p className="text-xs text-[#66736B] truncate">
              ตารางดูแลรายสัปดาห์
            </p>
          </div>
        </div>

        <nav aria-label="เมนูหลัก" className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-[15px] font-medium transition-colors",
                  active
                    ? "bg-[#EAF3EC] text-[#256B4A]"
                    : "text-[#17241D] hover:bg-[#F4F7F4]"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-[#256B4A]" : "text-[#66736B]"
                  )}
                />
                <span className="truncate">{item.fullLabel}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[#E3E9E3] p-3 space-y-2.5">
          {session?.care_recipient && (
            <div className="rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-3 py-2 text-xs">
              <p className="text-[#66736B]">ผู้รับการดูแล</p>
              <p className="font-semibold text-[#17241D] truncate mt-0.5">
                {session.care_recipient.display_name}
                {session.care_recipient.age_years
                  ? ` (${session.care_recipient.age_years} ปี)`
                  : ""}
              </p>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#17241D] truncate">
                {session?.user?.full_name || "ผู้ดูแล"}
              </p>
              <p className="text-[11px] text-[#66736B] truncate">
                {session?.mode === "demo" ? "โหมดสาธิต" : session?.user?.email}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              title="ออกจากระบบ"
              aria-label="ออกจากระบบ"
              className="rounded-md p-1.5 text-[#66736B] hover:bg-[#F4F7F4] hover:text-[#17241D]"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 pb-16 lg:pb-0">
        {/* Hackathon Demo Mode Banner */}
        {session?.mode === "demo" && (
          <div className="no-print border-b border-[#CFE3D4] bg-[#EAF3EC] px-4 py-2">
            <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-[#17241D]">
              <div className="flex items-center gap-2 min-w-0">
                <Badge variant="primary" className="shrink-0">
                  Demo Mode
                </Badge>
                <span className="leading-snug">
                  <strong>โหมดสาธิต (Hackathon Demo Mode):</strong>{" "}
                  ข้อมูลบันทึกอยู่ในเซิร์ฟเวอร์สาธิตในเครื่องเพื่อการทดสอบ (ไม่ใช่ฐานข้อมูลจริง)
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={resettingDemo}
                onClick={handleResetDemo}
                className="h-7 px-2.5 text-xs bg-[#FFFFFF]"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                รีเซ็ตข้อมูลสาธิต
              </Button>
            </div>
          </div>
        )}

        {/* Top Bar */}
        <header className="app-topbar no-print sticky top-0 z-30 border-b border-[#E3E9E3] bg-[#FFFFFF]/95 backdrop-blur-xs">
          <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 sm:px-6 h-14">
            {/* Mobile Brand */}
            <Link
              href="/"
              className="flex lg:hidden items-center gap-2 font-bold text-[#17241D]"
            >
              <span className="h-7 w-7 rounded-md bg-[#256B4A] text-white flex items-center justify-center">
                <CalendarCheck2 className="h-4 w-4" />
              </span>
              <span>CarePlan</span>
            </Link>

            {/* Desktop Context Info */}
            <div className="hidden lg:flex items-center gap-2 text-sm text-[#66736B]">
              <span>เขตเวลาประเทศไทย (Asia/Bangkok)</span>
              {session?.gemini_configured ? (
                <Badge variant="sage">Gemini AI พร้อมใช้งาน</Badge>
              ) : (
                <Badge variant="neutral">โหมดจัดตารางอัตโนมัติ (Fallback)</Badge>
              )}
            </div>

            {/* Right Controls: Notification Bell + Profile Chip */}
            <div className="flex items-center gap-2">
              {/* Notification Bell */}
              <div className="relative" ref={bellRef}>
                <button
                  type="button"
                  onClick={() => {
                    const next = !bellOpen;
                    setBellOpen(next);
                    if (next) void loadNotifications();
                  }}
                  aria-label="การแจ้งเตือน"
                  aria-expanded={bellOpen}
                  className="relative inline-flex h-9 items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-2.5 text-sm font-medium text-[#17241D] hover:bg-[#F4F7F4]"
                >
                  <Bell className="h-4 w-4 text-[#256B4A]" />
                  <span className="hidden sm:inline">แจ้งเตือน</span>
                  {unreadCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#B86A32] px-1 text-[11px] font-semibold text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {bellOpen && (
                  <div className="absolute right-0 mt-2 w-[320px] sm:w-[370px] rounded-lg border border-[#E3E9E3] bg-[#FFFFFF] shadow-lg z-40">
                    <div className="border-b border-[#E3E9E3] px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-[#17241D]">
                          การแจ้งเตือนงานดูแล
                        </p>
                        <p className="text-xs text-[#66736B]">
                          แจ้งเตือนเมื่อถึงเวลาและเตือนซ้ำหากยังไม่เสร็จ
                        </p>
                      </div>
                      <Badge variant={unreadCount > 0 ? "warning" : "neutral"}>
                        ยังไม่อ่าน {unreadCount}
                      </Badge>
                    </div>

                    {/* Reminder Engine Test Controls */}
                    <div className="border-b border-[#E3E9E3] bg-[#FAFBF9] px-4 py-3 space-y-2">
                      <p className="text-xs font-medium text-[#17241D]">
                        ทดสอบระบบแจ้งเตือนหลังบ้าน (Reminder Engine)
                      </p>
                      <div className="flex items-center gap-2">
                        <label className="sr-only" htmlFor="sim-time-input">
                          เวลาที่ต้องการจำลอง
                        </label>
                        <input
                          id="sim-time-input"
                          type="time"
                          value={simulateTime}
                          onChange={(e) => setSimulateTime(e.target.value)}
                          className="h-8 rounded-md border border-[#E3E9E3] bg-[#FFFFFF] px-2 text-xs text-[#17241D]"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          loading={simulating}
                          onClick={handleSimulateReminders}
                          className="flex-1 text-xs h-8"
                        >
                          <Clock className="h-3.5 w-3.5" />
                          จำลองการแจ้งเตือน (ทดสอบ)
                        </Button>
                      </div>
                      {simFeedback && (
                        <p className="text-xs text-[#256B4A] leading-snug">
                          {simFeedback}
                        </p>
                      )}
                    </div>

                    {/* Notifications List */}
                    <div className="max-h-72 overflow-y-auto divide-y divide-[#E3E9E3]">
                      {loadingBell && notifications.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-[#66736B]">
                          กำลังโหลดการแจ้งเตือน...
                        </p>
                      ) : notifications.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-[#66736B]">
                          ยังไม่มีการแจ้งเตือนในขณะนี้
                        </p>
                      ) : (
                        notifications.slice(0, 15).map((item) => {
                          const isUnread = !item.read_at;
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "px-4 py-3 text-sm transition-colors",
                                isUnread ? "bg-[#EAF3EC]/45" : "bg-[#FFFFFF]"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <Link
                                  href={`/tasks/${item.occurrence_id}`}
                                  onClick={() => {
                                    if (isUnread) void handleMarkRead(item.id);
                                    setBellOpen(false);
                                  }}
                                  className="font-medium text-[#17241D] hover:text-[#256B4A] leading-snug"
                                >
                                  {item.title}
                                </Link>
                                {isUnread && (
                                  <button
                                    type="button"
                                    onClick={() => void handleMarkRead(item.id)}
                                    title="ทำเครื่องหมายว่าอ่านแล้ว"
                                    className="text-[#256B4A] hover:text-[#1E583C] shrink-0"
                                  >
                                    <CheckCheck className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-[#66736B] leading-relaxed">
                                {item.body}
                              </p>
                              <p className="mt-1 text-[11px] text-[#66736B]">
                                {formatThaiTime(item.delivered_at)}
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Compact User Chip (Mobile + Desktop) */}
              <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-[#E3E9E3] bg-[#FAFBF9] px-2.5 h-9 text-xs text-[#17241D]">
                <User className="h-3.5 w-3.5 text-[#256B4A]" />
                <span className="max-w-[140px] truncate font-medium">
                  {session?.user?.full_name || "ผู้ดูแล"}
                </span>
                {session?.care_recipient && (
                  <span className="text-[#66736B] truncate max-w-[110px]">
                    · ดูแล{session.care_recipient.display_name}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                aria-label="ออกจากระบบ"
                title="ออกจากระบบ"
                className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E3E9E3] bg-[#FFFFFF] text-[#66736B] hover:text-[#17241D]"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        {/* Page Container */}
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="เมนูหลักบนมือถือ"
        className="no-print lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[#E3E9E3] bg-[#FFFFFF]"
      >
        <div className="grid grid-cols-5 h-15">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  active ? "text-[#256B4A]" : "text-[#66736B]"
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

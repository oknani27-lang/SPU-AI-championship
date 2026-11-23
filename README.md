# CarePlan — AI Weekly Care Scheduler

**SPU AI Championship 2026 — Working MVP**

CarePlan คือเว็บแอปพลิเคชันช่วยครอบครัวจัดตารางการดูแลผู้สูงอายุ (60 ปีขึ้นไป) ที่บ้านแบบวนซ้ำ 7 วัน พร้อมผู้ช่วย AI 2 กระบวนการหลัก เพื่อ:
1. **ลดเวลาจัดการงานดูแล (Time Management)**
2. **เพิ่มประสิทธิภาพการดูแล (Efficiency)**
3. **ยกระดับความต่อเนื่องและคุณภาพการดูแล (Quality of Care)**

---

## 1. Application Architecture

```
Browser (Next.js App Router + React 19 + Tailwind CSS v4 + Lucide Icons)
   │  Same-origin API calls only (Zero Supabase or Gemini keys in browser)
   ▼
Next.js Server Route Handlers (/api/*)
   ├── Auth & Session (HttpOnly HMAC-signed Cookie + Supabase Auth JWT)
   ├── Storage Layer (CarePlanStore Interface)
   │     ├── Live Mode: Supabase PostgreSQL (15 careplan_* tables + RLS + Immutability Triggers + Transactional RPC)
   │     │              + Private Supabase Storage bucket (careplan-evidence)
   │     └── Hackathon Demo Mode: Persistent server-side disk store (.careplan-demo-store/) enforcing identical rules
   ├── AI Process 1: AI Schedule Generator + Text-to-Task (Google Gemini Server-Side + Zod + Honest Fallback)
   ├── AI Process 2: AI Daily Summary + Optional Rest Suggestions (Verified DB records only)
   └── Smart Reminder Engine (/api/reminders/process — Vercel Cron every 15 min + Simulation trigger)
```

### Core Security & Domain Invariants (Enforced on Server & DB)
- **Active incomplete occurrences** cannot be edited or deleted (`HTTP 409`).
- **Photo Proof Completion:** At least 1 valid uploaded image is required before confirming completion (`HTTP 400` if missing). No AI judges photo validity; images are stored privately with strict owner-only access (`GET /api/evidence/[id]`).
- **Immutable Completed History:** Completed occurrences and their photo evidence are locked via both server logic and PostgreSQL triggers.
- **Future-Week Template Editing:** Editing a recurring template is blocked while today's/current-week occurrence is incomplete; once completed, edits create a new future template version starting next week without altering past records.
- **Rest Day Safety:** Marking a weekday as a rest day pauses app-scheduled tasks for that day without automatically canceling medically required care.
- **Typed Text Only:** Feature 3 (Text-to-Task) uses typed text only; no speech/voice input.
- **Share Links:** Unguessable random tokens with optional expiry, instant revocation, and private notes excluded by default.
- **Timezone:** `Asia/Bangkok` (UTC+7) default with timezone-aware `timestamptz` storage.

---

## 2. Environment Variables (No Secrets Committed)

Copy `.env.example` to `.env.local` locally and never commit `.env` or `.env.local`. All variables are **server-only**:

| Variable | Required | Description |
| :--- | :---: | :--- |
| `GEMINI_API_KEY` | For Live AI | Google Gemini API key (falls back honestly to deterministic engine if absent) |
| `GEMINI_MODEL` | Optional | Default `gemini-2.5-flash` |
| `SUPABASE_URL` | For Live DB | Supabase project URL (`NEXT_PUBLIC_SUPABASE_URL` alias supported) |
| `SUPABASE_PUBLISHABLE_KEY` | For Live DB | Supabase publishable/anon key (`NEXT_PUBLIC_SUPABASE_ANON_KEY` alias supported) |
| `SUPABASE_SECRET_KEY` | For Live DB | Server-only Supabase secret/service role key (`SUPABASE_SERVICE_ROLE_KEY` alias supported) |
| `APP_BASE_URL` | Recommended | Public base URL for shareable links (e.g., `https://your-app.vercel.app`) |
| `CRON_SECRET` | Recommended | Bearer token protecting `GET /api/reminders/process` for Vercel Cron |
| `CAREPLAN_DEMO_MODE` | Optional | Set `true` to allow clearly labeled Hackathon Demo Mode when live DB isn't migrated yet |

---

## 3. Database Migration (Supabase PostgreSQL)

Legacy BizPlan migrations (`supabase/migrations/20261119_*.sql`) are **preserved untouched** and no old tables are dropped.

To initialize CarePlan on your Supabase project:
1. Open **Supabase Dashboard -> SQL Editor**.
2. Run [`supabase/migrations/20261123_careplan_schema.sql`](supabase/migrations/20261123_careplan_schema.sql) once.
3. Verify the 15 `careplan_*` tables, private bucket `careplan-evidence`, RLS policies, immutability triggers, and `careplan_confirm_occurrence_completion` RPC are created.
4. Enable Email/Password authentication in Supabase Auth.

---

## 4. Local Development & Verification

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`. If live Supabase env vars are not yet configured locally, click **"เริ่มใช้งานโหมดสาธิต (Hackathon Demo Mode)"** on `/login` to test the full persistent server-side workflow immediately.

---

## 5. Vercel Deployment Instructions

1. Push the `main` branch (preserving `backup/bizplan-legacy`) to GitHub (`https://github.com/oknani27-lang/SPU-AI-championship`).
2. Import/connect the repository in Vercel (Framework Preset: **Next.js**).
3. Keep your existing Vercel environment variables (`GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) and add `APP_BASE_URL` and `CRON_SECRET`.
4. Deploy — `vercel.json` automatically configures the 15-minute Smart Reminder Cron Job at `/api/reminders/process`.

---

## 6. Hackathon Judge Demo Script (19-Step End-to-End Walkthrough)

1. **เข้าสู่ระบบ:** เปิด `/login` สมัครสมาชิก/เข้าสู่ระบบ หรือคลิก **"เริ่มใช้งานโหมดสาธิต (Hackathon Demo Mode)"**
2. **เลือกวันจันทร์:** ไปที่หน้า **ตารางสัปดาห์ (`/schedule`)** แล้วเลือก **วันจันทร์**
3. **พิมพ์กิจกรรม 3 รายการ (Text-to-Task):** พิมพ์ข้อความเช่น `"วันจันทร์ 8 โมงเตรียมอาหารให้แม่ 9 โมงจัดยา แล้วบ่ายสองพาไปหาหมอ"` แล้วกดแยกเป็นรายการงาน
4. **สร้างตารางด้วย AI (AI Process 1):** ตรวจสอบรายการงานแล้วคลิก **"ให้ AI ช่วยจัดตารางเวลา"** สังเกตเหตุผลภาษาไทย ข้อสมมติฐาน และการคงเวลาทางการแพทย์ไว้ไม่ขยับเอง
5. **อนุมัติและบันทึก:** กด **"อนุมัติและบันทึกตาราง"**
6. **ดูรายการที่บันทึก:** กลับมาที่ **แดชบอร์ด (`/`)** เพื่อดูรายการงานวันจันทร์เรียงตามเวลา
7. **ทดสอบการแจ้งเตือน (Smart Reminder):** กดไอคอนกระดิ่งมุมขวาบน แล้วกด **"จำลองการแจ้งเตือน (ทดสอบ)"** ระบบจะสร้างแจ้งเตือนเริ่มงาน/แจ้งซ้ำทุก 15 นาทีโดยไม่ส่งซ้ำ
8. **เปิดงานที่ยังไม่เสร็จ:** คลิกที่งานแรกเพื่อเปิดหน้า **รายละเอียดงาน (`/tasks/[id]`)**
9. **ตรวจสอบกฎห้ามแก้ไขงานที่ยังไม่เสร็จ:** สังเกตแบนเนอร์ชัดเจนว่างานที่กำลังดำเนินอยู่ไม่สามารถแก้ไขหรือลบได้
10. **อัปโหลดรูปยืนยัน:** ลองสังเกตว่าปุ่มยืนยันยังไม่เปิดใช้งานจนกว่าจะแนบรูปภาพ จากนั้นแนบรูปอย่างน้อย 1 รูป
11. **ยืนยันทำเสร็จสิ้น:** กด **"ยืนยันทำเสร็จสิ้น"**
12. **ตรวจสอบการล็อกถาวร:** งานและภาพถ่ายเปลี่ยนเป็นสถานะ **เสร็จสิ้นและล็อกถาวร (Immutable)**
13. **ตรวจสอบการแจ้งงานถัดไป:** ระบบแสดงการ์ดงานต่อเนื่องถัดไปพร้อมการแจ้งเตือน
14. **แก้ไขเทมเพลตสำหรับสัปดาห์ถัดไป:** เมื่อรอบปัจจุบันเสร็จแล้ว ส่วน **"แก้ไขแผนสำหรับสัปดาห์ถัดไป"** จะปลดล็อก แก้ไขชื่อหรือเวลาแล้วบันทึก
15. **ยืนยันประวัติเดิมไม่เปลี่ยน:** ไปที่หน้า **ประวัติการดูแล (`/history`)** เพื่อดูประวัติเดิมและรูปถ่ายหลักฐานที่ยังคงเดิมทุกประการ
16. **แชร์ตารางสัปดาห์:** กดปุ่ม **"แชร์ตาราง"** เลือกแบบรายสัปดาห์ ลองดาวน์โหลด **PNG**, สั่ง **พิมพ์/PDF**, สร้าง **ลิงก์แชร์ (ไม่รวมบันทึกส่วนตัว)** และกดดูผ่านหน้า `/share/[token]` แบบไม่ต้องล็อกอิน (พร้อมปุ่มแชร์เข้า LINE)
17. **สร้างสรุปประจำวันด้วย AI (AI Process 2):** ไปที่หน้า **สรุปประจำวัน (`/summary`)** กดสร้างสรุปเพื่อดูตัวเลขจริงจากฐานข้อมูลและข้อความให้กำลังใจ
18. **ดูคำแนะนำเวลาพัก (Optional Rest):** ดูช่วงเวลาว่างที่ AI แนะนำกิจกรรมพักผ่อนพร้อมคำเตือนเรื่องผู้ดูแลแทน และลองกด **รับคำแนะนำ / ข้าม / ซ่อน**
19. **ตรวจสอบการวนซ้ำสัปดาห์ถัดไป:** สลับปุ่ม **"สัปดาห์ถัดไป (ซ้ำ 7 วัน)"** ในหน้า Dashboard หรือ Weekly Schedule เพื่อเห็นตารางที่วนซ้ำพร้อมการเปลี่ยนแปลงที่มีผลเฉพาะอนาคต

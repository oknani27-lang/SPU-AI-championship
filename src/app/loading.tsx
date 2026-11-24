export default function LoadingPage() {
  return <div role="status" aria-label="กำลังเปิดหน้า" className="space-y-5 py-3 motion-safe:animate-pulse">
    <span className="sr-only">กำลังเปิดหน้า…</span>
    <div className="h-8 w-40 rounded-md bg-[#E3E9E3]" />
    <div className="h-28 rounded-xl border border-[#E3E9E3] bg-white" />
    <div className="h-48 rounded-xl border border-[#E3E9E3] bg-white" />
  </div>;
}

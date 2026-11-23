import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

export function jsonOk<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status });
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json(
      {
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
      { status: err.statusCode }
    );
  }

  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    return NextResponse.json(
      {
        error: firstIssue?.message ?? "ข้อมูลที่ส่งมาไม่ถูกต้อง",
        code: "VALIDATION_ERROR",
        issues: err.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  // Never leak stack traces or environment secrets to clients
  return NextResponse.json(
    {
      error: "เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง",
      code: "INTERNAL_SERVER_ERROR",
    },
    { status: 500 }
  );
}

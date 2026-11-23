export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code = "VALIDATION_ERROR", details?: Record<string, unknown>) {
    super(message, 400, code, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "กรุณาเข้าสู่ระบบก่อนดำเนินการ", code = "UNAUTHORIZED") {
    super(message, 401, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้", code = "FORBIDDEN") {
    super(message, 403, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "ไม่พบข้อมูลที่ต้องการ", code = "NOT_FOUND") {
    super(message, 404, code);
  }
}

export class ForbiddenRuleError extends AppError {
  constructor(message: string, code = "POLICY_CONFLICT", details?: Record<string, unknown>) {
    super(message, 409, code, details);
  }
}

export class GoneError extends AppError {
  constructor(message = "ลิงก์นี้หมดอายุหรือถูกยกเลิกแล้ว", code = "GONE") {
    super(message, 410, code);
  }
}

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_REQUIRED"
  | "REAUTHORIZATION_REQUIRED"
  | "CALENDAR_API_ERROR"
  | "CONTACTS_API_ERROR"
  | "STORAGE_ERROR"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = 500
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function successJson(data: unknown, init?: ResponseInit) {
  return Response.json({ success: true, data }, init);
}

export function errorJson(error: ApiError, requestId: string) {
  return Response.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        requestId
      }
    },
    { status: error.status }
  );
}

export function normalizeError(error: unknown) {
  if (error instanceof ApiError) return error;
  return new ApiError("INTERNAL_ERROR", "Internal server error.", 500);
}

export function getRequestId(request: Request) {
  return request.headers.get("cf-ray") || crypto.randomUUID();
}

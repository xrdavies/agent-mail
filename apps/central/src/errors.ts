type ApiErrorStatus = 400 | 404 | 409 | 422 | 500;

export class ApiError extends Error {
  status: ApiErrorStatus;
  code: string;
  details?: unknown;

  constructor(status: ApiErrorStatus, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

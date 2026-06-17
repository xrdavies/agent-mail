export type HostHttpStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

export class HostHttpError extends Error {
  constructor(
    readonly status: HostHttpStatus,
    message: string
  ) {
    super(message);
    this.name = "HostHttpError";
  }
}

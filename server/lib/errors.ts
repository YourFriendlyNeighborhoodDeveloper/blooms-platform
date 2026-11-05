export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in.') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do that.') => new AppError(403, 'forbidden', message);
export const notFound = (message = 'Not found.') => new AppError(404, 'not_found', message);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);
export const unavailable = (code: string, message: string, details?: unknown) => new AppError(503, code, message, details);
export const tooMany = (message = 'Too many attempts. Please wait a little and try again.') => new AppError(429, 'rate_limited', message);

type PgError = { code?: string; constraint?: string; message?: string };

export const isPgError = (err: unknown, code: string, constraint?: string) => {
  const e = err as PgError;
  return e?.code === code && (!constraint || e.constraint === constraint);
};

/** Turns database constraint failures into something safe and useful to show. */
export function mapDatabaseError(err: unknown): AppError | null {
  const e = err as PgError;
  switch (e?.code) {
    case '23P01':
      return conflict('time_conflict', 'That time was just taken. Please choose another.');
    case 'BL001':
      return conflict('rental_unavailable', 'That rental quantity is no longer available for those dates.');
    case '23505':
      return conflict('duplicate', 'That already exists.');
    case '23503':
      return conflict('in_use', 'That is referenced by other records and cannot be changed this way.');
    case '23514':
      return badRequest('That value is not allowed.');
    case '22P02':
      return badRequest('Invalid identifier.');
    default:
      return null;
  }
}

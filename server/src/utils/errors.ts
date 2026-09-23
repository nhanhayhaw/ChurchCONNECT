/**
 * Application error types.
 *
 * Every error thrown deliberately by a route or service is an ApiError with a
 * human-readable message safe to show a church administrator. The error
 * handler never leaks a database message to the client (see middleware/error.ts).
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg = 'The request could not be understood.', details?: unknown) =>
  new ApiError(400, msg, 'bad_request', details);

export const unauthorized = (msg = 'Please sign in to continue.') =>
  new ApiError(401, msg, 'unauthorized');

export const forbidden = (msg = 'You do not have permission to perform this action.') =>
  new ApiError(403, msg, 'forbidden');

export const notFound = (msg = 'The requested record could not be found.') =>
  new ApiError(404, msg, 'not_found');

export const conflict = (msg = 'This record already exists.') =>
  new ApiError(409, msg, 'conflict');

export const tooLarge = (msg = 'The uploaded file is too large.') =>
  new ApiError(413, msg, 'payload_too_large');

export const unprocessable = (msg = 'Some of the information provided is not valid.', details?: unknown) =>
  new ApiError(422, msg, 'validation_failed', details);

/**
 * Translate a PostgreSQL error into something a user can act on.
 * Returns null when the error is not a recognised constraint violation, in
 * which case the caller should treat it as an unexpected 500.
 */
export function translatePgError(err: any): ApiError | null {
  if (!err || typeof err.code !== 'string') return null;

  switch (err.code) {
    case '23505': { // unique_violation
      const constraint: string = err.constraint ?? '';
      if (constraint.includes('member_code')) return conflict('That Member ID is already in use.');
      if (constraint.includes('users_email') || constraint.includes('email_lower'))
        return conflict('An account with that email address already exists.');
      if (constraint.includes('uq_attendance'))
        return conflict('Attendance for this member has already been recorded for that service.');
      if (constraint.includes('idx_services_unique'))
        return conflict('A service of that type already exists for the selected date.');
      if (constraint.includes('one_open_per_member'))
        return conflict('This member already has an open follow-up. Close it before starting a new one.');
      if (constraint.includes('roles_name')) return conflict('A role with that name already exists.');
      if (constraint.includes('departments_name')) return conflict('A department with that name already exists.');
      if (constraint.includes('groups_name')) return conflict('A group with that name already exists.');
      return conflict('That record already exists.');
    }
    case '23503': // foreign_key_violation
      return badRequest('A linked record no longer exists. Refresh the page and try again.');
    case '23514': // check_violation
      return unprocessable('One of the values supplied is not allowed. Please review the form.');
    case '23502': // not_null_violation
      return unprocessable(`"${err.column ?? 'A required field'}" cannot be empty.`);
    case '22001': // string_data_right_truncation
      return unprocessable('One of the values entered is too long.');
    case '22003': // numeric_value_out_of_range - e.g. an id larger than BIGINT
      return badRequest('A number in the request is out of range.');
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow - e.g. 2026-02-30 passes the YYYY-MM-DD regex but is not a date
      return unprocessable('One of the dates supplied is not a real calendar date.');
    case '22P02': // invalid_text_representation
      return badRequest('One of the values supplied has the wrong format.');
    case '21000': // cardinality_violation - the same row hit twice in one INSERT ... ON CONFLICT
      return unprocessable('The same record appears more than once in this request.');
    default:
      return null;
  }
}

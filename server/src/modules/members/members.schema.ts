/**
 * Member validation schemas.
 *
 * Messages here are written for the person filling in the form, not for a
 * developer - they surface directly under the field in the UI.
 */
import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please use the date picker to choose a valid date.');

/** Ghanaian numbers are commonly written 024 123 4567 or +233 24 123 4567. */
const phone = z
  .string()
  .trim()
  .regex(/^[+]?[0-9\s()-]{7,20}$/, 'Please enter a valid phone number.');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .or(z.literal(''))
    .transform((v) => (v ? v : null));

/**
 * The base object, kept separate from the refinements below.
 *
 * `.refine()` wraps a schema in ZodEffects, which has no `.partial()`. Chaining
 * two refinements would wrap it twice, so the update schema is derived from
 * this bare object rather than by unwrapping the refined one.
 */
const memberFields = z
  .object({
    // Personal
    memberCode: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9-]*$/, 'Member ID may contain letters, numbers and hyphens only.')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v ? v.toUpperCase() : null)),
    firstName: z.string().trim().min(2, 'First name is required.').max(80),
    middleName: optionalText(80),
    lastName: z.string().trim().min(2, 'Last name is required.').max(80),
    gender: z.enum(['male', 'female'], { errorMap: () => ({ message: 'Please select a gender.' }) }),
    dateOfBirth: isoDate.optional().nullable(),
    maritalStatus: z.enum(['single', 'married', 'divorced', 'widowed']).optional().nullable(),
    nationality: optionalText(60),

    // Contact
    phone: phone.optional().or(z.literal('')).transform((v) => (v ? v : null)),
    altPhone: phone.optional().or(z.literal('')).transform((v) => (v ? v : null)),
    email: z
      .string()
      .trim()
      .email('Please enter a valid email address.')
      .optional()
      .or(z.literal(''))
      .transform((v) => (v ? v.toLowerCase() : null)),
    address: optionalText(500),

    // Church
    dateJoined: isoDate,
    membershipStatus: z.enum(['active', 'inactive', 'transferred', 'deceased']).default('active'),
    baptismStatus: z.enum(['baptised', 'not_baptised', 'pending']).default('not_baptised'),
    communionStatus: z.enum(['communicant', 'not_communicant']).default('not_communicant'),
    membershipCategory: z
      .enum(['full_member', 'associate', 'new_convert', 'visitor', 'child'])
      .default('full_member'),
    ministry: optionalText(120),
    departmentId: z.coerce.number().int().positive().optional().nullable(),
    groupId: z.coerce.number().int().positive().optional().nullable(),

    // Emergency contact
    emergencyName: optionalText(120),
    emergencyRelationship: optionalText(60),
    emergencyPhone: phone.optional().or(z.literal('')).transform((v) => (v ? v : null)),

    notes: optionalText(2000),
  });

export const memberCreateSchema = memberFields
  .refine((d) => !d.dateOfBirth || d.dateOfBirth <= new Date().toISOString().slice(0, 10), {
    message: 'Date of birth cannot be in the future.',
    path: ['dateOfBirth'],
  })
  .refine((d) => !d.dateOfBirth || d.dateJoined >= d.dateOfBirth, {
    message: 'Date joined cannot be before the date of birth.',
    path: ['dateJoined'],
  });

/**
 * Update accepts the same fields, all optional.
 *
 * The cross-field date checks are re-applied, but only when BOTH values are
 * present in the payload - a partial update that touches neither date must not
 * fail on values it never sent.
 */
export const memberUpdateSchema = memberFields
  .partial()
  .refine((d) => !d.dateOfBirth || d.dateOfBirth <= new Date().toISOString().slice(0, 10), {
    message: 'Date of birth cannot be in the future.',
    path: ['dateOfBirth'],
  })
  .refine((d) => !d.dateOfBirth || !d.dateJoined || d.dateJoined >= d.dateOfBirth, {
    message: 'Date joined cannot be before the date of birth.',
    path: ['dateJoined'],
  });

export const memberListQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'transferred', 'deceased', 'all']).optional(),
  gender: z.enum(['male', 'female', 'all']).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  groupId: z.coerce.number().int().positive().optional(),
  category: z.string().max(30).optional(),
  joinedFrom: z.string().optional(),
  joinedTo: z.string().optional(),
  sortBy: z.enum(['name', 'memberCode', 'dateJoined', 'department', 'status', 'age']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export type MemberCreateInput = z.infer<typeof memberCreateSchema>;
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

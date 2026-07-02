import { z } from "zod";

// Runtime validation for everything that crosses a trust boundary (form
// submissions, server action inputs, route params). TypeScript types are
// erased at runtime, so they cannot substitute for this.

export const emailSchema = z.string().trim().toLowerCase().email().max(255);
export const passwordSchema = z.string().min(8).max(72);

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120).optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const tenantNameSchema = z.string().trim().min(2, "Business name is too short").max(80);

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Business URL is too short")
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens only");

export const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: slugSchema,
});

export const uuidSchema = z.string().uuid();

export const roleKeySchema = z.enum(["admin", "estimator", "sales", "field_worker", "viewer"]);
// Note: "owner" is deliberately excluded — it cannot be granted through
// invite_member_by_email()/update_membership() in Phase 0 (see
// docs/14-phase-0-foundations.md, "Deferred work").

export const membershipStatusSchema = z.enum(["active", "suspended", "removed"]);
// Note: "invited" is excluded here — it's a state the system can produce
// (a pending invitation) but not one the client sets directly in Phase 0.

/** Turns a business name into a URL-safe slug suggestion (user can still edit it). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

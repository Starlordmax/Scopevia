import { z } from "zod";
import { emailSchema } from "./schemas";

export const portalRequestOtpSchema = z.object({
  token: z.string().trim().min(16),
  email: emailSchema,
});

export const portalVerifyOtpSchema = z.object({
  token: z.string().trim().min(16),
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email"),
});

export const acceptProposalSchema = z.object({
  token: z.string().trim().min(16),
  clientName: z.string().trim().min(1, "Please enter your name").max(120),
  acceptedTerms: z.literal(true, { message: "Please confirm you've reviewed the proposal before accepting" }),
});

export const declineProposalSchema = z.object({
  token: z.string().trim().min(16),
  declineReason: z.string().trim().max(2000).optional(),
});

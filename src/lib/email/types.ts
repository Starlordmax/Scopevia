export type PortalCodeEmailInput = {
  email: string;
  code: string;
  proposalTitle: string;
  businessName: string;
};

/**
 * A fully-rendered email, ready to send to exactly one recipient — the
 * generic shape every notification email (Phase 3D) is built into before
 * reaching a provider. Deliberately separate from PortalCodeEmailInput
 * (which stays exactly as narrow as it's always been — the OTP send path
 * is unchanged by this phase): this type carries pre-rendered
 * subject/text/html rather than template inputs, since notification
 * templates (src/lib/email/templates/proposal-notification.ts) render
 * once and fan out to several recipients, unlike the single-recipient OTP
 * flow.
 */
export type GenericEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

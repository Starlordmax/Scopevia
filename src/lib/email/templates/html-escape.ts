/**
 * Shared by every email template (src/lib/email/templates/*) — any
 * tenant/client-controlled text (business name, proposal title, client
 * name/email, decline reason) is escaped before interpolation into HTML,
 * since an email client rendering unescaped markup from user-entered text
 * would otherwise be an injection surface.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

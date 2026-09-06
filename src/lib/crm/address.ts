/**
 * Pure client-address display formatting — no "server-only" import,
 * directly unit-testable. Used on the client detail page. All inputs are
 * optional/independent (see docs/73-client-address-and-material-zip-defaults.md);
 * returns null when there's nothing to show at all, rather than an empty
 * string or a line of stray punctuation.
 */
export type ClientAddressFields = {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

export function formatClientAddress(address: ClientAddressFields): string | null {
  const line1 = [address.addressLine1, address.addressLine2].filter(Boolean).join(", ");
  const cityStateZip = [address.city, [address.state, address.postalCode].filter(Boolean).join(" ").trim()]
    .filter(Boolean)
    .join(", ");
  const showCountry = Boolean(address.countryCode) && address.countryCode?.toUpperCase() !== "US";

  const parts = [line1, cityStateZip, showCountry ? address.countryCode : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

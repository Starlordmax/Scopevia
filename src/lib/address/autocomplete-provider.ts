/**
 * Address autocomplete provider selection — pure, no "server-only", no
 * Next.js/browser dependency, so directly unit-testable. See
 * docs/73-client-address-and-material-zip-defaults.md, "Autocomplete
 * strategy."
 *
 * This phase ships the STRUCTURE and a fully-working manual-entry path
 * only. No third-party geocoding/places API call is made anywhere in this
 * codebase yet — `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER` exists so a
 * later phase can wire in a real provider (Google Places, Mapbox, ...)
 * behind this same flag without changing the address form's structure:
 * the input already carries `data-address-autocomplete="<provider>"` (see
 * `address-fields.tsx`) as the hook point a real integration would attach
 * a suggestions dropdown to.
 *
 * Both env vars are deliberately `NEXT_PUBLIC_*` (never secret) — a
 * client-side places/autocomplete key is, by the nature of the feature,
 * exposed to the browser regardless of provider; the real security
 * control for that class of key is a domain-restriction on the key
 * itself, configured in the provider's own console, documented in
 * docs/73 rather than enforced here. Nothing here ever holds a private
 * API key. Neither var being set is a supported, default-safe state
 * (provider resolves to "none"), so Render/staging never breaks from a
 * missing var.
 */
export type AddressAutocompleteProvider = "none" | "google_places";

const KNOWN_PROVIDERS: readonly AddressAutocompleteProvider[] = ["google_places"];

export function resolveAddressAutocompleteProvider(rawProvider: string | undefined, hasApiKey: boolean): AddressAutocompleteProvider {
  const normalized = (rawProvider ?? "").trim().toLowerCase();
  if (!normalized) return "none";
  if (!hasApiKey) return "none";
  return (KNOWN_PROVIDERS as readonly string[]).includes(normalized) ? (normalized as AddressAutocompleteProvider) : "none";
}

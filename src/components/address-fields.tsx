"use client";

import { resolveAddressAutocompleteProvider } from "../lib/address/autocomplete-provider";
import { FieldError, fieldErrorProps } from "./form-field-error";

/**
 * Shared "Address" field group — used by the New Client form
 * (`src/app/(protected)/clients/client-form.tsx`) and Quick Create Client
 * (`src/app/(protected)/proposals/new/quick-create-client-modal.tsx`).
 * Every field is optional; only `postalCode` has any format validation
 * (server-side, in `quickCreateClientSchema`/`createClientSchema`), and
 * only when it's actually present. `fieldErrors` is passed through from
 * whichever caller's own Server Action state — see
 * docs/74-custom-service-name-and-multistroke-drawing.md, "Validation UX."
 *
 * Autocomplete: `data-address-autocomplete` carries the resolved provider
 * ("none" unless both `NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER` and
 * `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY` are set) so a future integration has
 * a stable hook point without changing this component's structure. No
 * provider is actually wired up in this phase — see
 * docs/73-client-address-and-material-zip-defaults.md. The form works
 * identically, with plain manual entry, whether or not a provider is
 * configured; nothing here ever blocks submission on a missing provider.
 */
export function AddressFields({
  defaultValues,
  fieldErrors,
}: {
  defaultValues?: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  };
  fieldErrors?: Record<string, string>;
}) {
  const provider = resolveAddressAutocompleteProvider(
    process.env.NEXT_PUBLIC_ADDRESS_AUTOCOMPLETE_PROVIDER,
    Boolean(process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY)
  );

  return (
    <fieldset className="stack" style={{ border: "none", padding: 0, margin: 0 }}>
      <legend className="field-legend">Address</legend>
      <span className="hint">
        Used as the default job ZIP for material pricing. You can change it on each proposal.
      </span>

      <div className="field">
        <label htmlFor="addressLine1">Street address</label>
        <input
          id="addressLine1"
          name="addressLine1"
          type="text"
          maxLength={255}
          placeholder="Start typing an address…"
          autoComplete="off"
          data-address-autocomplete={provider}
          defaultValue={defaultValues?.addressLine1 ?? ""}
        />
      </div>

      <div className="field">
        <label htmlFor="addressLine2">Apt / Suite / Unit (optional)</label>
        <input id="addressLine2" name="addressLine2" type="text" maxLength={255} autoComplete="off" defaultValue={defaultValues?.addressLine2 ?? ""} />
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 2 }}>
          <label htmlFor="city">City</label>
          <input id="city" name="city" type="text" maxLength={120} autoComplete="off" defaultValue={defaultValues?.city ?? ""} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="state">State</label>
          <input id="state" name="state" type="text" maxLength={40} autoComplete="off" defaultValue={defaultValues?.state ?? ""} />
        </div>
      </div>

      <div className="tenant-form" style={{ width: "100%" }}>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="postalCode">ZIP code</label>
          <input
            id="postalCode"
            name="postalCode"
            type="text"
            inputMode="numeric"
            maxLength={20}
            placeholder="e.g. 33101"
            autoComplete="off"
            defaultValue={defaultValues?.postalCode ?? ""}
            {...fieldErrorProps(fieldErrors, "postalCode")}
          />
          <FieldError fieldErrors={fieldErrors} id="postalCode" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="countryCode">Country</label>
          <input
            id="countryCode"
            name="countryCode"
            type="text"
            maxLength={2}
            placeholder="US"
            autoComplete="off"
            defaultValue={defaultValues?.countryCode ?? "US"}
          />
        </div>
      </div>
    </fieldset>
  );
}

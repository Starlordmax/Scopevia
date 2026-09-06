"use client";

import { useRouter } from "next/navigation";
import { FieldError, fieldErrorProps } from "../../../../components/form-field-error";
import type { ClientOption } from "../../../../lib/crm/client-options";

/**
 * Reloads the page with ?clientId=... on change so the server can refetch
 * that client's contacts/open opportunities — same "small client component
 * for one interactive control, plain GET navigation otherwise" pattern as
 * tenant-switcher.tsx.
 *
 * `key={defaultClientId}` forces a remount whenever the selected client
 * changes — necessary because `defaultValue` on an UNCONTROLLED <select>
 * is only applied at mount; when this same component instance receives a
 * new `defaultClientId` prop without remounting (e.g. after Quick Create
 * Client's router.push() lands the user back here with a brand-new
 * clientId), the DOM's own selection never updates and the select falls
 * back to showing its placeholder. Manually picking a DIFFERENT client via
 * this dropdown's own onChange already updates the browser's native
 * selection immediately (a real user interaction, not a prop change), so
 * this key-based remount is specifically for the "selection changed from
 * OUTSIDE this component" case.
 */
export function ClientSelect({
  clients,
  defaultClientId,
  fieldErrors,
}: {
  clients: ClientOption[];
  defaultClientId?: string;
  fieldErrors?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <>
      <select
        key={defaultClientId ?? "none"}
        id="clientId"
        name="clientId"
        defaultValue={defaultClientId ?? ""}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (e.target.value) params.set("clientId", e.target.value);
          router.push(`/proposals/new?${params.toString()}`);
        }}
        {...fieldErrorProps(fieldErrors, "clientId")}
      >
        <option value="" disabled>
          Select a client…
        </option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
      <FieldError fieldErrors={fieldErrors} id="clientId" />
    </>
  );
}

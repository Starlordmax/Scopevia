"use client";

import { useRouter } from "next/navigation";
import type { ClientOption } from "../../../../lib/crm/client-options";

/**
 * Reloads the page with ?clientId=... on change so the server can refetch
 * that client's contacts/open opportunities — same "small client component
 * for one interactive control, plain GET navigation otherwise" pattern as
 * tenant-switcher.tsx.
 */
export function ClientSelect({ clients, defaultClientId }: { clients: ClientOption[]; defaultClientId?: string }) {
  const router = useRouter();

  return (
    <select
      id="clientId"
      name="clientId"
      required
      defaultValue={defaultClientId ?? ""}
      onChange={(e) => {
        const params = new URLSearchParams();
        if (e.target.value) params.set("clientId", e.target.value);
        router.push(`/proposals/new?${params.toString()}`);
      }}
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
  );
}

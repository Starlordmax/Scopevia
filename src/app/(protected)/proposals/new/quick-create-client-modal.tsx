"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createQuickClientAction } from "../../../../actions/clients";
import { AddressFields } from "../../../../components/address-fields";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";

const noopSubscribe = () => () => {};

/** True only once mounted in a real browser — SSR-safe way to gate a portal target (document.body) without the setState-in-effect footgun. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

/**
 * "+ New client" — lets the user create a client without leaving the New
 * Proposal form. A native <dialog> (showModal()/close()) rather than a
 * hand-rolled overlay: built-in focus trap, Escape-to-close, and
 * ::backdrop dimming for free, no extra dependency. See
 * docs/34-proposal-builder-ux.md, "Quick Create Client."
 *
 * On success, navigates to `/proposals/new?clientId=<new>&created=1` — the
 * EXACT SAME mechanism ClientSelect's onChange already uses when a user
 * manually picks a different client (see client-select.tsx). Reusing it
 * (rather than inventing client-side state to splice the new client into
 * the `clients` list) means: the new client is guaranteed to actually be
 * in `getClientOptions()`'s result (a real server refetch, not an
 * optimistic guess), it's pre-selected via `defaultClientId`, and —
 * because this is the same navigation the page already relies on when
 * switching clients — any proposal title/service-type text already typed
 * survives untouched (proven by the pre-existing client-switch behavior;
 * this feature doesn't introduce any new state-loss risk).
 */
export function QuickCreateClientModal({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [clientType, setClientType] = useState<"individual" | "business">("individual");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  useFocusFirstFieldError(fieldErrors);
  // The trigger button lives inside the proposal page's own <form> (it's
  // just a plain button, that's fine); the <dialog> — which has its OWN
  // <form> inside it — must NOT be a DOM descendant of that outer <form>,
  // since a <form> nested inside another <form> is invalid HTML and React
  // warns/misbehaves on it. Portalled to document.body instead. Portals
  // need a browser DOM to target, so it only renders once mounted.
  const isClient = useIsClient();

  function openModal() {
    setError(null);
    setFieldErrors(undefined);
    setClientType("individual");
    formRef.current?.reset();
    dialogRef.current?.showModal();
  }

  function closeModal() {
    dialogRef.current?.close();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors(undefined);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const result = await createQuickClientAction({
      tenantId,
      clientType,
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      email: String(formData.get("email") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      addressLine1: String(formData.get("addressLine1") ?? ""),
      addressLine2: String(formData.get("addressLine2") ?? ""),
      city: String(formData.get("city") ?? ""),
      state: String(formData.get("state") ?? ""),
      postalCode: String(formData.get("postalCode") ?? ""),
      countryCode: String(formData.get("countryCode") ?? ""),
    });

    setIsSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      setFieldErrors(result.fieldErrors);
      return;
    }

    closeModal();
    const params = new URLSearchParams();
    params.set("clientId", result.clientId);
    params.set("created", "1");
    router.push(`/proposals/new?${params.toString()}`);
  }

  const dialog = (
    <dialog ref={dialogRef} className="modal" aria-labelledby="quick-create-client-title">
      <form ref={formRef} onSubmit={handleSubmit} className="stack">
        <h2 id="quick-create-client-title" className="modal-title">
          Create new client
        </h2>

        {error ? <p className="error-banner">{error}</p> : null}

        <div className="field">
          <label htmlFor="quickClientType">Client type</label>
          <select
            id="quickClientType"
            name="quickClientType"
            value={clientType}
            onChange={(e) => setClientType(e.target.value === "business" ? "business" : "individual")}
          >
            <option value="individual">Individual</option>
            <option value="business">Business</option>
          </select>
        </div>

        <div className="tenant-form" style={{ width: "100%" }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="firstName">First name</label>
            {/* No `required` -- an empty submit must reach our own
                red-state UI, not the browser's native popup. */}
            <input
              id="firstName"
              name="firstName"
              type="text"
              maxLength={80}
              autoComplete="off"
              {...fieldErrorProps(fieldErrors, "firstName")}
            />
            <FieldError fieldErrors={fieldErrors} id="firstName" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              maxLength={80}
              autoComplete="off"
              {...fieldErrorProps(fieldErrors, "lastName")}
            />
            <FieldError fieldErrors={fieldErrors} id="lastName" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            maxLength={255}
            autoComplete="off"
            {...fieldErrorProps(fieldErrors, "email")}
          />
          <FieldError fieldErrors={fieldErrors} id="email" />
        </div>

        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            maxLength={30}
            autoComplete="off"
            {...fieldErrorProps(fieldErrors, "phone")}
          />
          <FieldError fieldErrors={fieldErrors} id="phone" />
        </div>

        <AddressFields fieldErrors={fieldErrors} />

        <div className="tenant-form" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="button-secondary" onClick={closeModal} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="button-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create client"}
          </button>
        </div>
      </form>
    </dialog>
  );

  return (
    <>
      <button type="button" className="button-secondary" onClick={openModal}>
        + New client
      </button>
      {isClient ? createPortal(dialog, document.body) : null}
    </>
  );
}

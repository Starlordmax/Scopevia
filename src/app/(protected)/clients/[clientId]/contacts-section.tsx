"use client";

import { useActionState, useState } from "react";
import {
  createClientContactAction,
  updateClientContactAction,
  setPrimaryContactAction,
  archiveClientContactAction,
  restoreClientContactAction,
} from "../../../../actions/clients";
import type { ActionResult } from "../../../../actions/auth";
import { SubmitButton } from "../../../../components/submit-button";
import { FieldError, fieldErrorProps, useFocusFirstFieldError } from "../../../../components/form-field-error";
import type { Database } from "../../../../../types/database";

type Contact = Database["public"]["Tables"]["client_contacts"]["Row"];

const initialState: ActionResult = {};

export function ContactsSection({
  clientId,
  contacts,
  canCreate,
  canUpdate,
  canArchive,
  canRestore,
}: {
  clientId: string;
  contacts: Contact[];
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const [createState, createAction] = useActionState(createClientContactAction, initialState);
  const [showForm, setShowForm] = useState(false);
  useFocusFirstFieldError(createState.fieldErrors);

  return (
    <div className="stack">
      {contacts.length === 0 ? (
        <p className="hint">No contacts yet.</p>
      ) : (
        <ul className="stack" style={{ gap: 10, listStyle: "none", padding: 0, margin: 0 }}>
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} clientId={clientId} canUpdate={canUpdate} canArchive={canArchive} canRestore={canRestore} />
          ))}
        </ul>
      )}

      {canCreate ? (
        showForm ? (
          <form action={createAction} noValidate className="stack">
            {createState.error ? <p className="error-banner">{createState.error}</p> : null}
            <input type="hidden" name="clientId" value={clientId} />
            <div className="tenant-form" style={{ width: "100%" }}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="firstName">First name</label>
                {/* No `required` -- an empty submit must reach our own
                    red-state UI, not the browser's native popup. */}
                <input id="firstName" name="firstName" type="text" {...fieldErrorProps(createState.fieldErrors, "firstName")} />
                <FieldError fieldErrors={createState.fieldErrors} id="firstName" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="c-last">Last name</label>
                <input id="c-last" name="lastName" type="text" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-title">Job title</label>
              <input id="c-title" name="jobTitle" type="text" />
            </div>
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input id="c-email" name="email" type="email" />
            </div>
            <div className="field">
              <label htmlFor="c-phone">Phone</label>
              <input id="c-phone" name="phone" type="tel" />
            </div>
            <label className="tenant-form" style={{ alignItems: "center" }}>
              <input type="checkbox" name="isPrimary" style={{ width: "auto", minHeight: 0 }} />
              Make primary contact
            </label>
            <SubmitButton pendingText="Adding…">Add contact</SubmitButton>
          </form>
        ) : (
          <button type="button" className="button-secondary" onClick={() => setShowForm(true)}>
            + Add contact
          </button>
        )
      ) : null}
    </div>
  );
}

function ContactRow({
  contact,
  clientId,
  canUpdate,
  canArchive,
  canRestore,
}: {
  contact: Contact;
  clientId: string;
  canUpdate: boolean;
  canArchive: boolean;
  canRestore: boolean;
}) {
  const [editState, editAction] = useActionState(updateClientContactAction, initialState);
  const [editing, setEditing] = useState(false);
  useFocusFirstFieldError(editState.fieldErrors);
  // Swaps to the plain schema field name ("firstName", matching
  // fieldErrors' key) only while THIS row actually has the error, so
  // useFocusFirstFieldError's getElementById lookup can find it -- every
  // row otherwise keeps its own `edit-first-${contact.id}` id, since
  // several ContactRow instances render at once and a bare "firstName"
  // id would collide across rows.
  const firstNameFieldId = editState.fieldErrors?.firstName ? "firstName" : `edit-first-${contact.id}`;

  return (
    <li className="card" style={{ padding: 12 }}>
      <div className="tenant-form" style={{ justifyContent: "space-between", width: "100%" }}>
        <div>
          <strong>
            {contact.first_name} {contact.last_name}
          </strong>
          {contact.is_primary ? <span className="badge"> Primary</span> : null}
          {contact.archived_at ? <span className="badge"> Archived</span> : null}
          <div className="hint">
            {contact.job_title ? `${contact.job_title} · ` : ""}
            {contact.email ?? ""} {contact.phone ?? ""}
          </div>
        </div>
      </div>

      {!contact.archived_at ? (
        <div className="tenant-form" style={{ marginTop: 8 }}>
          {canUpdate ? (
            <button type="button" className="button-secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel" : "Edit"}
            </button>
          ) : null}
          {canUpdate && !contact.is_primary ? (
            <form action={setPrimaryContactAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <input type="hidden" name="clientId" value={clientId} />
              <button type="submit" className="button-secondary">
                Make primary
              </button>
            </form>
          ) : null}
          {canArchive ? (
            <form action={archiveClientContactAction}>
              <input type="hidden" name="contactId" value={contact.id} />
              <input type="hidden" name="clientId" value={clientId} />
              <button type="submit" className="button-danger">
                Archive
              </button>
            </form>
          ) : null}
        </div>
      ) : canRestore ? (
        <form action={restoreClientContactAction} style={{ marginTop: 8 }}>
          <input type="hidden" name="contactId" value={contact.id} />
          <input type="hidden" name="clientId" value={clientId} />
          <button type="submit" className="button-secondary">
            Restore
          </button>
        </form>
      ) : null}

      {editing ? (
        <form action={editAction} noValidate className="stack" style={{ marginTop: 10 }}>
          {editState.error ? <p className="error-banner">{editState.error}</p> : null}
          <input type="hidden" name="contactId" value={contact.id} />
          <input type="hidden" name="clientId" value={clientId} />
          <div className="tenant-form" style={{ width: "100%" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor={firstNameFieldId}>First name</label>
              <input
                id={firstNameFieldId}
                name="firstName"
                type="text"
                defaultValue={contact.first_name}
                {...fieldErrorProps(editState.fieldErrors, "firstName")}
              />
              <FieldError fieldErrors={editState.fieldErrors} id="firstName" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor={`edit-last-${contact.id}`}>Last name</label>
              <input id={`edit-last-${contact.id}`} name="lastName" type="text" defaultValue={contact.last_name ?? ""} />
            </div>
          </div>
          <div className="field">
            <label htmlFor={`edit-title-${contact.id}`}>Job title</label>
            <input id={`edit-title-${contact.id}`} name="jobTitle" type="text" defaultValue={contact.job_title ?? ""} />
          </div>
          <div className="field">
            <label htmlFor={`edit-email-${contact.id}`}>Email</label>
            <input id={`edit-email-${contact.id}`} name="email" type="email" defaultValue={contact.email ?? ""} />
          </div>
          <div className="field">
            <label htmlFor={`edit-phone-${contact.id}`}>Phone</label>
            <input id={`edit-phone-${contact.id}`} name="phone" type="tel" defaultValue={contact.phone ?? ""} />
          </div>
          <SubmitButton pendingText="Saving…" className="button-secondary">
            Save
          </SubmitButton>
        </form>
      ) : null}
    </li>
  );
}

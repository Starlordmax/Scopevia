"use client";

import { useActionState } from "react";
import { createNoteAction, updateNoteAction, archiveNoteAction } from "../actions/notes";
import type { ActionResult } from "../actions/auth";
import { SubmitButton } from "./submit-button";

const initialState: ActionResult = {};

export type NoteItem = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
};

type ParentIds = { tenantId: string; clientId?: string; opportunityId?: string; projectId?: string };

function ParentHiddenFields({ clientId, opportunityId, projectId }: Omit<ParentIds, "tenantId">) {
  return (
    <>
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      {opportunityId ? <input type="hidden" name="opportunityId" value={opportunityId} /> : null}
      {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
    </>
  );
}

export function NotesSection({
  notes,
  canCreate,
  canUpdate,
  canArchive,
  ...parent
}: ParentIds & { notes: NoteItem[]; canCreate: boolean; canUpdate: boolean; canArchive: boolean }) {
  const [createState, createAction] = useActionState(createNoteAction, initialState);

  return (
    <div className="stack">
      {notes.length === 0 ? (
        <p className="hint">No notes yet.</p>
      ) : (
        <ul className="stack" style={{ gap: 12, listStyle: "none", padding: 0, margin: 0 }}>
          {notes.map((note) => (
            <li key={note.id}>
              <NoteBody note={note} canUpdate={canUpdate} canArchive={canArchive} parent={parent} />
            </li>
          ))}
        </ul>
      )}

      {canCreate ? (
        <form action={createAction} className="stack">
          {createState.error ? <p className="error-banner">{createState.error}</p> : null}
          <input type="hidden" name="tenantId" value={parent.tenantId} />
          <ParentHiddenFields {...parent} />
          <div className="field">
            <label htmlFor="note-body">Add a note</label>
            <textarea
              id="note-body"
              name="body"
              rows={3}
              required
              style={{ font: "inherit", padding: 10, borderRadius: 8, border: "1px solid var(--color-border)" }}
            />
          </div>
          <SubmitButton pendingText="Adding…">Add note</SubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function NoteBody({
  note,
  canUpdate,
  canArchive,
  parent,
}: {
  note: NoteItem;
  canUpdate: boolean;
  canArchive: boolean;
  parent: Omit<ParentIds, "tenantId">;
}) {
  const [updateState, updateAction] = useActionState(updateNoteAction, initialState);
  const [archiveState, archiveAction] = useActionState(archiveNoteAction, initialState);

  return (
    <div className="card" style={{ padding: 12 }}>
      <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{note.body}</p>
      <span className="hint">
        {note.authorName ?? "Unknown"} · {new Date(note.createdAt).toLocaleString()}
      </span>

      {canUpdate || canArchive ? (
        <details style={{ marginTop: 8 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            Edit
          </summary>
          <div className="stack" style={{ marginTop: 8 }}>
            {canUpdate ? (
              <form action={updateAction} className="stack">
                {updateState.error ? <p className="error-banner">{updateState.error}</p> : null}
                <input type="hidden" name="noteId" value={note.id} />
                <ParentHiddenFields {...parent} />
                <textarea
                  name="body"
                  defaultValue={note.body}
                  rows={2}
                  style={{ font: "inherit", padding: 10, borderRadius: 8, border: "1px solid var(--color-border)" }}
                />
                <SubmitButton pendingText="Saving…" className="button-secondary">
                  Save
                </SubmitButton>
              </form>
            ) : null}
            {canArchive ? (
              <form action={archiveAction}>
                {archiveState.error ? <p className="error-banner">{archiveState.error}</p> : null}
                <input type="hidden" name="noteId" value={note.id} />
                <ParentHiddenFields {...parent} />
                <SubmitButton pendingText="Archiving…" className="button-danger">
                  Archive note
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

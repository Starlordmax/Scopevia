"use client";

import { useFormStatus } from "react-dom";

/** Like SubmitButton, but blocks the submit with a native confirm() dialog first — for actions that need an explicit "are you sure" step (e.g. archive/delete). */
export function ConfirmSubmitButton({
  children,
  confirmMessage,
  pendingText,
  className = "button-primary",
}: {
  children: React.ReactNode;
  confirmMessage: string;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? (pendingText ?? "Please wait…") : children}
    </button>
  );
}

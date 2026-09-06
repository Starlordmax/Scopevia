"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  className = "button-primary",
  disabled = false,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? (pendingText ?? "Please wait…") : children}
    </button>
  );
}

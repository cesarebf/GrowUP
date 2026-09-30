"use client";

export function RequestRefresh({ disabled = false }: { disabled?: boolean }) {
  // A full read also clears uncertain action state; never replay a mutation.
  return <button type="button" disabled={disabled} className="text-sm underline disabled:opacity-50"
    onClick={() => window.location.reload()}>Refresh status</button>;
}

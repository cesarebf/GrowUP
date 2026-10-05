import { invitationPath, type InvitationHistory } from "./invitation-validation.ts";
import { requestPageInput, type RequestSearchParams } from "./request-presentation.ts";

export const invitationPageSize = 20;
export const unavailableInvitationMessage = "This invitation is unavailable. It may be invalid, expired, revoked, or already used. Ask the community owner or an admin for a new link.";
export const invitationStatusLabels: Record<InvitationHistory["status"], string> = {
  active: "Active", accepted: "Accepted", revoked: "Revoked", expired: "Expired",
};

export function invitationPageInput(search: RequestSearchParams, communityId: string) {
  const result = requestPageInput(search, communityId);
  return result.status === "error" ? { status: "error", message: "Invalid invitation page. Return to the first page." } as const : result;
}

export function nextInvitationPage(path: string, row: InvitationHistory) {
  return `${path}?${new URLSearchParams({ at: row.created_at, id: row.invitation_id })}`;
}

// The caller supplies window.location.origin, never a submitted/query origin.
export function invitationPresentationUrl(path: string, browserOrigin: string): string | null {
  if (!path.startsWith("/invite/") || invitationPath(path.slice(8)) !== path) return null;
  try {
    const origin = new URL(browserOrigin);
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== browserOrigin) return null;
    return new URL(path, origin).href;
  } catch { return null; }
}

export async function copyInvitationLink(path: string, browserOrigin: string, clipboard?: Pick<Clipboard, "writeText">): Promise<"copied" | "manual" | "invalid"> {
  const url = invitationPresentationUrl(path, browserOrigin);
  if (!url) return "invalid";
  try {
    if (!clipboard) return "manual";
    await clipboard.writeText(url);
    return "copied";
  } catch { return "manual"; }
}

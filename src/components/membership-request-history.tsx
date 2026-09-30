import Link from "next/link";
import type { RequestReceipt } from "@/lib/communities/request-validation";
import { requestDate, requestStatusMessage } from "@/lib/communities/request-presentation";

export function MembershipRequestHistory({ requests }: { requests: RequestReceipt[] }) {
  if (requests.length === 0) return <p className="text-sm text-muted-foreground">No request attempts on this page.</p>;
  return <ul className="space-y-4">{requests.map((request) => <li key={request.request_id} className="space-y-2 rounded-lg border p-4">
    {request.community_name !== null && request.community_slug !== null
      ? <Link href={`/c/${request.community_slug}`} prefetch={false} className="break-words font-medium underline">{request.community_name}</Link>
      : <p className="font-medium">Community details unavailable</p>}
    <p className="text-sm">{requestStatusMessage(request)}</p>
    <p className="break-words text-sm">Shared name: {request.requester_display_name}</p>
    <p className="text-sm text-muted-foreground">Requested <time dateTime={request.created_at}>{requestDate(request.created_at)}</time></p>
    {request.resolved_at && <p className="text-sm text-muted-foreground">Resolved <time dateTime={request.resolved_at}>{requestDate(request.resolved_at)}</time></p>}
  </li>)}</ul>;
}

# GrowUP security and privacy

Status: design principles and release gates. Implement and verify protections with each feature; the final hardening phase does not postpone basic security.

## Tenant isolation and authorization

- Treat community IDs, route parameters, object IDs, role fields, price IDs, and uploaded metadata as untrusted. Verify identity, current membership, role, resource scope, and required entitlement server-side for each sensitive action.
- Combine least-privilege database grants, deny-by-default RLS, and tenant-safe relational constraints. Test anonymous access, legitimate access, role escalation, former members, and cross-tenant reads/writes, including forged parent IDs. Review views/functions and elevated database operations for bypasses.
- Prevent members from granting themselves roles, editing subscription state, or changing their tenant through updates. Ownership transfer and last-owner removal require explicit transactional rules.
- Supabase privileged credentials bypass RLS; keep them in narrowly scoped server operations. User-scoped access is the normal path. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
- Apply the same access policy to storage, search, realtime, exports, and cached responses. Revoke future access after bans, membership/tier changes, or account removal; define expiry/revalidation behavior for existing sessions, subscriptions, and signed URLs.

## Secrets, sessions, and payments

- Never place secrets in client bundles, public environment variables, Git, URLs, or logs. Only intentionally public configuration may reach the browser. Ignore `.env` files; examples contain placeholders only. Rotate exposed secrets and separate preview/test/production credentials.
- Verify sessions server-side with maintained Auth helpers. Protect cookies, redirect destinations, and state-changing endpoints against session theft and cross-site request abuse; apply rate limits to sensitive/abusable operations.
- Verify Stripe webhook signatures on the raw body, enforce account/environment scope, deduplicate effects, and handle retries/out-of-order events. Protect outgoing billing actions with authorization and idempotency. Never grant access from a browser payment-success claim. See [Stripe webhooks](https://docs.stripe.com/webhooks).
- Limit provider payload retention and redact payment/session identifiers where appropriate. Use provider-hosted payment collection where suitable; do not store card credentials. Audit billing/role changes without recording secrets.

## User-generated content and media

Validate content and sanitize any supported rich text/HTML; escape rendering and constrain links/embeds. Prevent stored XSS and unsafe URL schemes. Validate upload size/type and ownership, use safe download behavior, and assess malware scanning before enabling risky file types. Any server-side URL fetching needs SSRF defenses.

Private buckets and tenant/participant access policies protect files. A guess-resistant path is not authorization. Public covers require an intentional publishing action and metadata review. Short-lived signed links can be shared until they expire; select lifetimes appropriate to the data and do not promise instant recall of downloaded content. Assess video delivery, quotas, and bandwidth abuse before enabling course uploads.

## DMs, realtime, and location

DM content is accessible only to authorized participants under the agreed policy. Sharing a community, owning it, or knowing a conversation ID does not grant DM access. Do not promise end-to-end encryption: it is not part of the current design. Set rules for contact consent, blocking, reports, retention, notification previews, and tightly controlled audited support access before release.

Authorize channel join/read/write and revalidate long-lived realtime access when permissions change. Presence and typing indicators reveal user activity and need audience restrictions too. Global discussion requires its own defined audience policy, not a community-authorization bypass.

Location sharing must be off by default with explicit opt-in, purpose, audience, and a clear removal control. Prefer volunteered city/region-level data; do not collect continuous location or precise coordinates by default. Store sharing records separately from public profiles. Keep exact/private addresses in restricted fields/resources only if a later approved use case needs them. Do not include them in public discovery, analytics, logs, images' metadata, or broad realtime payloads.

Disabling sharing must stop future disclosure and remove shared location from active views, search, and caches. Define deletion and backup-retention behavior; disclose that prior recipients' copies cannot be recalled. Private event venues need their own audience controls, independent of member location sharing.

## Moderation and operational readiness

Ship basic reporting, blocking where applicable, and abuse response with social features; richer moderation/admin tooling can follow. Separate platform administration from community roles, restrict privileged access, and audit sensitive actions. Resolve prohibited-content, age, escalation, appeal, and retention policies before public launch.

Minimize collected data and define deletion/export, log retention, backup expiry, and financial-record retention before the relevant launch. Add redacted observability, rate limits, upload quotas, dependency review, secret scanning, restore testing, incident response, and verified isolation checks as rollout gates. Choose regional/privacy obligations based on actual markets and users rather than guessing jurisdiction from the developer's location.

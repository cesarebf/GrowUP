# Auth and private profile setup

This slice uses Next.js 16 App Router, `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.117.1. It implements only the [approved email/password and private-profile scope](PHASE_1_DECISIONS.md).

## Environment and database

Copy `.env.example` to `.env.local` and fill in:

| Variable | Value |
| --- | --- |
| `APP_URL` | Canonical application origin, locally `http://localhost:3000`; HTTPS outside localhost. No path/query. |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from the Supabase project's Connect dialog. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The same project's `sb_publishable_...` key. Legacy JWT keys and secret keys are deliberately rejected. |

No service-role, database password, or management token belongs in the application environment. Use separate Supabase projects/configuration for development, preview, and production; never point untrusted previews at production. Public Next.js variables are set at build time, so rebuild when changing projects. Local checks require no credentials; local Auth uses the configured development project. A Supabase CLI/Docker stack is not provisioned by this repository.

Review and apply `supabase/migrations/20260924000100_private_profiles.sql` once to the intended development project through Supabase's SQL Editor as the database administrator (or your reviewed migration workflow). Do not run it automatically against production. It creates the table and triggers and backfills existing non-deleted users. The checked-in TypeScript table contract matches this migration; compare/regenerate it against the actual project when applying migrations.

The table contains only `user_id`, optional `display_name`, and `created_at`. Auth inserts provision rows from `auth.users.id`, ignoring user metadata. Hard deletion cascades; Auth soft deletion removes private data through a trigger. There is no account-deletion UI. RLS is enabled/forced; a narrow security-definer helper with an empty search path checks the current identity, verified email, non-anonymous status, deletion, and current ban. Authenticated users can select only their own eligible row and update only `display_name`. Anonymous access, direct inserts/deletes/truncation, ownership changes, and timestamp updates are denied. Trigger functions cannot be invoked by API roles. Public/community/location profiles remain separate future work.

## Supabase dashboard

1. Enable the Email provider and email/password signup. Keep **Confirm email enabled**; disable anonymous sign-ins and leave OAuth providers unused. Set the password minimum to 12 to match the app's 12–128 character validation. Keep provider rate limits enabled; review their production values before release.
2. In **Authentication → URL Configuration**, set **Site URL** to exactly `APP_URL` (without a trailing slash). Add the exact `APP_URL` plus `/auth/confirm` to the redirect allowlist, for example `http://localhost:3000/auth/confirm` in development. Do not use production wildcard redirects.
3. In **Authentication → Email Templates**, replace the action link in **Confirm signup** with:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email">Verify email</a>
   ```

   Replace the action link in **Reset password** with:

   ```html
   <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a>
   ```

   Use these links instead of `{{ .ConfirmationURL }}`. `SiteURL` deliberately binds emails to that environment's canonical app. No arbitrary `next` or `redirect_to` is accepted by the app. The [email template variables](https://supabase.com/docs/guides/auth/auth-email-templates) and [token-hash verification](https://supabase.com/docs/reference/javascript/auth-verifyotp) are supported Supabase mechanisms. `verifyOtp` uses `email`; the distinct `resend` API still requires `signup`.
4. Configure production SMTP/delivery before release, with email link tracking disabled. Supabase's default mail service is limited; see [SMTP setup](https://supabase.com/docs/guides/auth/auth-smtp). Keep an expiring OTP policy and test expiration/reuse. Review password-security settings against recovery; CAPTCHA is not integrated in this slice, so enabling it requires a separate UI change.

## Sessions and authorization

Invitation Pass 1 adds only a narrow return cookie: explicit same-origin action, canonical 64-lowercase-hex secret, fixed sign-in/sign-up enum, host-only HttpOnly SameSite=Lax Path=/, 60-minute Max-Age. Secure follows trusted `APP_URL` HTTPS; non-Secure is permitted only for loopback HTTP (also for local production-build testing). No arbitrary next/origin is accepted. Successful authoritative sign-in deletes it and returns only `/invite/<token>`; invalid/missing/expired cookie falls back to `/account`. Failed sign-in preserves original expiry; logout clears it. No automatic acceptance. Last-started invitation flow wins across tabs. Same-browser/same-origin cookie context cannot follow verification into another device: finish Auth and reopen the original link. Signup/resend/confirmation/provider callbacks remain unchanged and carry no invitation secret. Existing session-cookie policy is unchanged.

`APP_URL=http://localhost:3000` and the existing development Auth delivery suffice; invitations add no domain, DNS, SMTP, email-provider, deployment or paid-service prerequisite. General public Auth delivery/recovery readiness is a separate launch concern. See [invitation hosted-log gate](COMMUNITY_INVITATIONS.md).

Server Actions validate input and use a user-scoped Supabase client. The protected page and profile mutations call `getUser()` for current authoritative identity, then RLS independently enforces eligibility and ownership. Caller-supplied IDs, roles, and redirect targets are ignored. Next.js enforces same-origin Server Action requests; no cross-origin allowance is configured.

The proxy uses `getClaims()` to refresh sessions and forwards every refreshed cookie to both the renderer and browser. Server Components use a read-only cookie adapter; Server Actions write through the SSR helper. Cookies use SameSite=Lax and Secure in production, with the SSR default browser-readable session storage. The browser factory uses only public configuration; current forms perform their mutations on the server. Auth/account responses are dynamic and private/no-store, with no-referrer headers.

GET `/auth/confirm` only validates the link and renders a form, so email scanners do not consume it. Submission calls `verifyOtp` with a server-selected `email` or `recovery` type. Recovery validates the new password before consuming the token, then updates it in the verified session. Confirmation and recovery intentionally close their temporary session and redirect to sign-in. Failed identity/password checks also attempt cleanup. A failed password update consumes the link: request a new one. Normal logout revokes the current session; successful recovery requests global refresh-token revocation. Existing access JWTs may remain usable until expiry; this is [Supabase's sign-out behavior](https://supabase.com/docs/guides/auth/signout), not instant revocation of every issued token.

Application diagnostics include operation names and bounded error codes, never passwords or token values. Email hashes are credentials: redact query strings for `/auth/confirm` in hosting/access logs, and do not attach analytics to that page. Provider rate limits still apply to direct API callers; configure production abuse controls before public release.

## Validation

Run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`. Tests cover service authorization, malformed/expired token responses, cleanup, redirects, the installed SDK's cookie refresh/recovery behavior, and actual PostgreSQL constraints/grants/RLS through PGlite. The Auth schema/context and provider HTTP responses are fixtures; these tests do not claim hosted Auth or SMTP validation.

After dashboard setup and migration, use two test users to verify signup/resend, unverified denial, email confirmation, sign-in, persistence across reload and token expiry, own profile updates, direct cross-user API denial, logout, recovery, expired/reused links, and banned/deleted-user denial. Test confirmation on another browser/device. Confirm Secure cookies and private/no-store responses over production HTTPS. No live project migration or email delivery is validated by the local test suite.

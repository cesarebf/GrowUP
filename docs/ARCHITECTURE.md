# GrowUP architecture

Status: proposed implementation direction beyond the minimal Next.js/TypeScript/Tailwind/shadcn/ui scaffold. No backend integration, deployed infrastructure, or database schema exists yet. See [README](../README.md) for the current setup and validation commands.

## Shape and boundaries

Use one Next.js application with feature-oriented modules and one Supabase PostgreSQL database. This is a modular monolith, deployed to Vercel and versioned in GitHub. Start with ordinary relational data and explicit feature boundaries; no microservices, custom infrastructure, containers, extra backend framework, ORM, or queue is justified yet.

| Boundary | Proposed responsibility |
| --- | --- |
| Frontend | Next.js App Router, strict TypeScript, Tailwind CSS, and shared shadcn/ui components. Server Components for suitable reads; Client Components for interactive UI. Accessible, original GrowUP UX. |
| Server/backend | Server-only feature services for validation, authorization, and business rules. Thin Server Actions/Route Handlers invoke those services; Route Handlers also receive webhooks. Every entry point is treated as externally callable. |
| Authentication | Supabase Auth manages identity and sessions. Verify identity server-side using supported Supabase helpers; derive permissions from current application data. Authentication alone never grants community access. |
| Database | Shared PostgreSQL schema with community scoping, relational constraints, least-privilege grants, and RLS. Version schema/policy changes as migrations; generate TypeScript database types when implemented. |
| Realtime | Supabase Realtime when needed for authorized channels and updates. Persist durable messages first; realtime transports updates and ephemeral presence, not the source of truth. |
| Storage | Supabase Storage with private access by default, authorized uploads/downloads, and short-lived signed URLs where appropriate. Deliberately public covers/assets use a separate policy. Video delivery/transcoding requirements need evaluation before courses ship. |
| Payments | A server-only Stripe integration for Billing and Connect, with separate creator and member billing flows. Invoicing/Tax only when requirements justify them. See [PAYMENTS](PAYMENTS.md). |
| Deployment | Vercel application deployment; Supabase managed services; GitHub review and CI. Separate development/preview/production data and secrets, with Stripe test/live isolation when introduced. |

Next.js documents server data boundaries and the need to authorize server entry points in its [data security guide](https://nextjs.org/docs/app/guides/data-security).

## Tenancy and authorization

A community is the tenant boundary. A user may belong to many communities. Global identity, discovery metadata, user-to-user DMs, and creator billing relationships have explicit scopes rather than a fabricated community owner.

Resolve the requested community and verify current membership, role, and entitlement for each action. A route slug or submitted ID is a locator, never authorization. Carry tenant context into reads, mutations, media access, and any future background work. Use database constraints to prevent cross-community parent/child links.

Use a user-scoped Supabase client for ordinary server requests so RLS applies. Restrict privileged clients to narrow server-only operations, such as verified payment synchronization; explicitly authorize and scope those operations because privileged access bypasses RLS. Review views/functions as well as tables. See [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Public discovery reads only approved public community metadata. Membership does not automatically make profile fields public. Keep private responses out of shared caches; any authorized caching must account for tenant, viewer, permissions, and revocation.

## Extension without premature infrastructure

Organize modules around identity, communities, content, courses, conversations, entitlements, and billing as they are introduced. Keep routing/UI thin and share server business rules. Do not pre-create empty modules or an extensible plugin engine.

Community settings select an enabled landing feature. Validate availability and viewer access on the server; agree on a safe fallback before implementing unavailable or restricted landing targets. Tier entitlements govern benefits; roles govern administrative powers; creator plans govern the creator's platform arrangement.

Database authorization, storage policies, and private realtime authorization must agree. Revalidate long-lived access after membership changes; channel names alone do not protect messages. See [Storage access control](https://supabase.com/docs/guides/storage/security/access-control) and [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization).

Introduce durable background processing only when a concrete workload needs it. Before payments, choose a durable retry/reconciliation mechanism that works within hosting limits; do not rely on work continuing after a server response. Start search with PostgreSQL when needed; defer recommendation infrastructure until ranking requirements and usage warrant it.

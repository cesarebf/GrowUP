# GrowUP agent instructions

GrowUP means “Group + Grow”. Read [PRODUCT](docs/PRODUCT.md) and the relevant architecture, data, payment, security, and roadmap documents before changing behavior. Confirmed requirements take priority over proposals; unresolved decisions must not silently become requirements.

## Scope and workflow

- Inspect repository files and `git status` before work. Preserve existing user changes and keep edits within the requested scope.
- This repository currently contains planning only. Do not initialize the application, add migrations, integrate services, or deploy until the user approves implementation. Do not commit unless requested.
- Keep documentation concise and update it when an accepted decision changes. Explain material assumptions, unresolved decisions, verification, and limitations.
- Prefer the simplest implementation for the approved phase. Do not build future features, generic plugin frameworks, microservices, or extra infrastructure speculatively.

## Engineering rules

- Use Next.js, strict TypeScript, Tailwind CSS, shadcn/ui, Supabase/PostgreSQL, Stripe, Vercel, and GitHub as planned. Justify new dependencies; share UI components and business rules without premature abstraction.
- A community is a tenant. Scope community records and operations explicitly; verify relationships cannot cross tenants. Global profiles and DMs need their own privacy rules.
- Authenticate and authorize on the server. Validate untrusted input. Use least-privilege database grants and RLS as defense in depth; never rely on hidden UI controls or caller-supplied tenant IDs.
- Keep privileged Supabase credentials, Stripe keys, webhook secrets, and other secrets server-only. Ignore secret-bearing environment files; commit only placeholder examples. Never log secrets or private message/location content.
- Make database changes through reviewed migrations with constraints, grants, RLS, and relevant allow/deny tests. Do not make undocumented production schema changes.
- Separate community roles, membership tiers/entitlements, creator plans, and prices. Configure commercial amounts, percentages, periods, and entitlements as data; do not branch business logic on the labels “Model A/B/C”.
- Make sensitive mutations and payment processing auditable and idempotent where needed. Handle errors explicitly; expose safe user messages and useful redacted diagnostics.
- Keep location sharing opt-in and removable, with approximate location preferred. Protect DMs, private media, and member-only content across database, storage, realtime, caches, and logs.
- Run checks appropriate to the change. Once implementation begins, test authorization failures and cross-tenant access as well as successful behavior. Do not claim checks passed if they were not run.

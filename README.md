# GrowUP

Group + Grow. Next.js application with Supabase Auth, private profiles, communities, instant join/leave, owner settings, approval requests, [invitations](docs/COMMUNITY_INVITATIONS.md) and [role management](docs/COMMUNITY_ROLE_MANAGEMENT.md). **Phase 1 COMPLETE** under its approved scope and explicit deferrals at `c29e6ba23f95b22e6eec5b9d03e341111245f061`; committed/pushed with green post-push CI. [Phase 2 — Forum / Community experience](docs/ROADMAP.md) planning is next. Commercial features and production readiness remain deferred; Phase 1 requires no paid infrastructure or production domain.

## Local development

Use Node.js **24.21.0** (pinned in `.nvmrc`) and npm **11.19.0** (pinned in `package.json`). Node 24 is the selected [LTS release line](https://nodejs.org/en/about/previous-releases). If necessary, select the Node version with your version manager and run `npm install --global npm@11.19.0`. Engine checks reject incompatible versions.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Copy `.env.example` to ignored `.env.local` and set `APP_URL` (locally `http://localhost:3000`), `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Use existing free development infrastructure and follow [Auth setup](docs/AUTH_SETUP.md). Hosted foundation/request effects, invitations and role management are accepted. The historical request tracking entry is `20260930000900 / community_membership_requests`; the accepted hosted invitation entry is `20261005221026 / community_invitations`, distinct from its local filename. Do not replay historical migrations, repair tracking or bulk-push migrations. No service-role key is needed. Without configuration, local checks work; Auth is unavailable. Never commit credentials.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run lint` | Run ESLint with the Next.js and TypeScript rules; warnings fail validation. |
| `npm run typecheck` | Generate Next.js route types, then check strict TypeScript without emitting code. Works before the first build. |
| `npm test` | Run services, Server Actions, UI rendering/orchestration, SSR cookie, and PostgreSQL grant/RLS/invariant tests without hosted credentials. |
| `npm run build` | Create the production build. |
| `npm start` | Serve the production build locally. |

GitHub Actions runs `npm ci`, lint, typecheck, tests, and build for pull requests and pushes to `main`. Generated output and dependencies are ignored. Keep `package-lock.json` synchronized and use npm for dependency changes.

## Structure and scope

- `src/app/`: Homepage, Auth/account routes, community creation/listing, `/c/{slug}` landings, and Server Actions.
- `components.json`: shadcn/ui component generation and alias configuration.
- `src/lib/`: server Auth/profile and community services, validation, Supabase clients/session helpers, and styling utility.
- `src/proxy.ts`: Auth session refresh and cookie forwarding.
- `supabase/migrations/`: private profile and community schemas, triggers, grants, and RLS.
- `tests/`: Node test runner; PGlite executes the migration against PostgreSQL locally.
- `docs/`: product requirements, proposed architecture/data/payments/security, and phased roadmap.
- `AGENTS.md`: durable instructions for repository work.

The scaffold follows [Next.js installation guidance](https://nextjs.org/docs/app/getting-started/installation) and [shadcn/ui initialization](https://ui.shadcn.com/docs/installation/next). Tailwind provides styling; shadcn/ui establishes theme tokens and component generation conventions. Add UI components only when a feature uses them. System fonts keep this placeholder independent of font downloads.

shadcn/ui was initialized with CLI 4.21.0, the `base-nova` preset, neutral colors, CSS variables, and the `@/*` alias. Its unused generated Button and related component/icon dependencies were removed. Add a component with `npx shadcn add <component>` when needed; the pinned CLI installs its required dependencies.

Tooling limitation: Next.js 16.3.6's lint plugins require ESLint 9 and TypeScript below 6.1. The scaffold pins compatible ESLint 9.39.5 and TypeScript 6.0.3 rather than overriding peer requirements. npm marks ESLint 9 as deprecated; revisit this pin when the Next.js lint dependency chain supports ESLint 10.

The native import resolver uses npm's optional platform binaries. Its fallback postinstall script is explicitly denied in `package.json`; installs do not need that script on the supported Windows/Linux platforms. Keep optional dependencies enabled.

The Supabase packages provide managed Auth and SSR cookie handling; `server-only` protects server modules; PGlite is a development-only dependency for actual SQL security tests. No new framework or service-role client is introduced.

Core email/password Auth, sessions, private profiles, and RLS are committed and live-validated. Password-recovery completion is deferred until custom SMTP/domain infrastructure is available; the existing recovery implementation remains in place. See [Auth setup](docs/AUTH_SETUP.md).

The historical invitation implementation base was `699775f50ccd2537d2f64d50106213199ead68f0` (`docs: plan community invitations`), following requests at `937dbc4`. The [community foundation](docs/COMMUNITY_FOUNDATION.md) provides creation, lists, exact-slug landings, instant join/leave and owner settings. Membership means current participation; leave deletes the row and rejoin starts as member. Private slug landings expose no metadata to nonmembers.

The committed [request feature](docs/COMMUNITY_MEMBERSHIP_REQUESTS.md) provides immutable shared-name attempts, withdrawal, owner/admin review and settings cancellation with requester/reviewer UI. Invitation Pass 1 adds hash-only capabilities, owner/admin management, bounded private preview, explicit member-only acceptance, atomic pending-request cancellation and a narrow Auth-return cookie. Pass 2 adds owner/admin management at `/c/{slug}/invitations`, one-time browser-origin copying, and explicit acceptance/Auth continuation at `/invite/{token}`. Links are relative and expire after exactly 168 elapsed hours; existing members leave them unused. No domain, SMTP, email provider, deployment, paid service or new dependency is required. Invitation hosted/browser acceptance and token-logging inspection passed; no raw token was found in the accessible provider/log surfaces inspected, with no blocking issue remaining. [Role management](docs/COMMUNITY_ROLE_MANAGEMENT.md) is complete, including hosted rollout/acceptance, final UI, independent UI/security review and real browser acceptance; committed/pushed checkpoint `c29e6ba23f95b22e6eec5b9d03e341111245f061` has green post-push CI. Bans, transfer, closure, discovery, OAuth, payments and content remain deferred.

`npm test` runs PGlite/pgcrypto and service/action/transport tests by default. For independent PostgreSQL sessions, supply `GROWUP_TEST_PSQL` and `GROWUP_TEST_PG_PORT` for a disposable loopback server, then run the same command. All three harnesses create/drop only their own random database, emulate Auth and never accept a hosted hostname. Without both variables, all three concurrency suites explicitly skip. See the invitation runbook for results/limits.

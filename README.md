# GrowUP

Group + Grow. Next.js application with Supabase email/password Auth, private account profiles, and a minimal community foundation. Admission workflows and commercial features remain deferred.

## Local development

Use Node.js **24.21.0** (pinned in `.nvmrc`) and npm **11.19.0** (pinned in `package.json`). Node 24 is the selected [LTS release line](https://nodejs.org/en/about/previous-releases). If necessary, select the Node version with your version manager and run `npm install --global npm@11.19.0`. Engine checks reject incompatible versions.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). Copy `.env.example` to ignored `.env.local` and set `APP_URL` (locally `http://localhost:3000`), `NEXT_PUBLIC_SUPABASE_URL`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Use a separate development Supabase project and follow [Auth setup](docs/AUTH_SETUP.md) to apply the migration and configure email templates. No service-role key is needed. Without configuration, the homepage and local checks work; Auth is unavailable. Never commit credentials or put secrets in `NEXT_PUBLIC_*` variables.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run lint` | Run ESLint with the Next.js and TypeScript rules; warnings fail validation. |
| `npm run typecheck` | Generate Next.js route types, then check strict TypeScript without emitting code. Works before the first build. |
| `npm test` | Run Auth/community services, SSR cookie, and PostgreSQL grant/RLS/invariant tests without hosted credentials. |
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

The locally implemented [community foundation](docs/COMMUNITY_FOUNDATION.md) adds `/communities/new`, `/communities`, and `/c/{slug}`, backed by a second migration. It requires explicit visibility and join-policy choices and atomically creates one owner membership. Apply reviewed migrations in order to a development project before exercising these pages. Private communities expose no metadata to nonmembers. No joining, approval, invitation, role-management, or transfer workflow exists yet. Google OAuth, public/community/location profiles, Stripe, courses, forum, chat, DMs, and creator plans remain deferred.

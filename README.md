# GrowUP

Group + Grow. A minimal application scaffold; product features are not implemented.

## Local development

Use Node.js **24.21.0** (pinned in `.nvmrc`) and npm **11.19.0** (pinned in `package.json`). Node 24 is the selected [LTS release line](https://nodejs.org/en/about/previous-releases). If necessary, select the Node version with your version manager and run `npm install --global npm@11.19.0`. Engine checks reject incompatible versions.

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The scaffold requires no environment variables or external service credentials. `.env.example` contains only an optional, currently unused application URL variable with an empty value. If environment configuration is needed later, copy it to ignored `.env.local`; never add secrets to `NEXT_PUBLIC_*` variables or committed files.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server. |
| `npm run lint` | Run ESLint with the Next.js and TypeScript rules; warnings fail validation. |
| `npm run typecheck` | Generate Next.js route types, then check strict TypeScript without emitting code. Works before the first build. |
| `npm run build` | Create the production build. |
| `npm start` | Serve the production build locally. |

GitHub Actions runs `npm ci`, lint, typecheck, and build for pull requests and pushes to `main`. Generated output and dependencies are ignored. Keep `package-lock.json` committed and use npm for dependency changes.

## Structure and scope

- `src/app/`: App Router layout, minimal homepage, and global styles.
- `components.json`: shadcn/ui component generation and alias configuration.
- `src/lib/`: shared styling utility installed by shadcn/ui.
- `docs/`: product requirements, proposed architecture/data/payments/security, and phased roadmap.
- `AGENTS.md`: durable instructions for repository work.

The scaffold follows [Next.js installation guidance](https://nextjs.org/docs/app/getting-started/installation) and [shadcn/ui initialization](https://ui.shadcn.com/docs/installation/next). Tailwind provides styling; shadcn/ui establishes theme tokens and component generation conventions. Add UI components only when a feature uses them. System fonts keep this placeholder independent of font downloads.

shadcn/ui was initialized with CLI 4.21.0, the `base-nova` preset, neutral colors, CSS variables, and the `@/*` alias. Its unused generated Button and related component/icon dependencies were removed. Add a component with `npx shadcn add <component>` when needed; the pinned CLI installs its required dependencies.

Tooling limitation: Next.js 16.3.6's lint plugins require ESLint 9 and TypeScript below 6.1. The scaffold pins compatible ESLint 9.39.5 and TypeScript 6.0.3 rather than overriding peer requirements. npm marks ESLint 9 as deprecated; revisit this pin when the Next.js lint dependency chain supports ESLint 10.

The native import resolver uses npm's optional platform binaries. Its fallback postinstall script is explicitly denied in `package.json`; installs do not need that script on the supported Windows/Linux platforms. Keep optional dependencies enabled.

Supabase, Stripe, authentication, communities, and other product features are intentionally deferred. Resolve the Phase 1 access decisions in [PRODUCT.md](docs/PRODUCT.md) before schema or authentication implementation.

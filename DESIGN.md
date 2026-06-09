# Leah-20260609-2 - Design Document

## Project Overview

This is the **starter scaffold** for an Aether app — no product brief has been
written yet. When you're ready to build a real application, replace this section
with a `## Vision` section describing what the app should do and who it's for,
then run `/build_my_app` to have the agent design and implement it.

The starter you're looking at right now is intentionally minimal: an Auth0 sign-in
flow, a welcome landing page that documents the next steps, a chat page wired to
`useAgentChat` for talking to deployed ADK agents, and the platform plumbing
(server status, settings dialog, preferences, theming) shared by every Aether app.

**Created:** 2026-06-09  
**App ID:** leah-20260609-2  
**Description:** Aether app: Leah-20260609-2  
**Last updated:** 2026-06-09

## Configuration

| Setting        | Value                                           |
| -------------- | ----------------------------------------------- |
| Authentication | Auth0                                           |
| Query Server   | https://query.pip.prod.g.lovelace.ai            |
| UI hosting     | GKE (BC 2.0, `hosting: gcp`)                    |
| Agent hosting  | GKE (`agent.hosting: gke`)                      |
| Live URL       | https://ui.leah-20260609-2.tenant.g.lovelace.ai |

## Cross-Cutting Concepts

Nothing app-specific yet. Common platform primitives in use:

- **Auth & user state** — `useUserState()` reads the Auth0 session; `/login`,
  `/a0callback`, `/logout`, and `/pending` bypass the standard app shell in
  `app.vue`.
- **Theming** — `useLovelaceTheme()` and `theme-brand` class on `<v-app>` apply
  the Lovelace dark theme; the brand colors come from
  `.agents/skills/lovelace-branding/`.
- **Server status** — `<ServerStatus />` and `<ServerStatusFooter />` surface
  Query Server / agent / KV health via `usePlatformStatus`.
- **Preferences** — `useAppFeaturePrefs` / `useGlobalFeaturePrefs` (and the
  top-level `useAppPrefs` / `useGlobalPrefs`) persist UI state to per-tenant
  Firestore, with a transparent Upstash KV fallback on legacy BC 1.0 tenants.
  See [`pref.md`](.agents/skills/aether/pref.md).

When a real vision is added, document app-wide concepts (entity score
computations, shared composables, data-shape contracts, etc.) here.

## Pages

The starter ships these pages. Treat them as replaceable scaffolding once a
real product brief lands — anything that isn't auth/system plumbing should be
swapped for the app's actual UX.

### Home

Name: Home  
Route: `/`  
Description: Welcome landing with "Getting Started" steps that point the user
back at `DESIGN.md` and `/build_my_app`.  
Implementation status: Starter placeholder — replace once a vision is provided.  
Details: See `pages/index.vue`. Uses `useAppInfo()` for the app name.

### Agent Chat

Name: Agent Chat  
Route: `/chat`  
Description: Streaming chat UI that talks to any agent deployed to this tenant.  
Implementation status: Working starter — keep, evolve, or remove based on need.  
Details: See `pages/chat.vue` and `composables/useAgentChat.ts`. Agents are
discovered via `/api/agents`, which resolves the hosting backend (in-cluster
GKE vs Agent Engine) server-side so the page is hosting-agnostic.

### Auth & System Routes

`/login`, `/a0callback`, `/logout`, `/pending` are the Auth0 plumbing.
`/prefs-demo` and `/tenancy-probe` are diagnostic pages useful while
developing — safe to delete once the real app is built.

## Next Steps

1. Edit this file: replace **Project Overview** with a `## Vision` section
   describing what to build.
2. (Optional) Drop design screenshots into `design/references/`.
3. Re-run `/build_my_app`. The agent will read the vision, plan the UX, and
   implement it.

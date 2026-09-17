# Youbot logo

The approved logo is the minimal, monochrome two-stroke y from concept v2. Its vector geometry is maintained in `youbot-core/branding/mark.json`; the app component and website generator read that same source. In page content the mark inherits the existing theme color. Browser and home-screen icons use black on white for contrast.

Regenerate the standalone SVG and icon files after changing the geometry:

```sh
node youbot-core/branding/build.mjs
node youbot-core/webchat-relay/website/build.mjs
npm --prefix youbot-core/web-ui run build
```

The icon generator uses the app's existing Sharp dependency. The app's static output is `youbot-core/web-ui/out`; the local launcher publishes it to `youbot-core/web`. Tenant-supplied logos and favicon overrides remain configurable.

Approved reference: `output/branding/youbot-logo-concept-v2.png`.

Factory task: `youbot-logo-concept-20260914`. Spacecrew work: `work_df239d4b-0653-4d9a-a826-d3ee8bf4e9cf`.

## Applied release — 2026-09-14

- App: Next.js production build passed and the exported files were copied to the running local app's `youbot-core/web` directory. Browser inspection at 1280px and 390px confirmed the new login mark. Sidebar and overview use the same shared component; authenticated sidebar rendering was not separately inspected.
- Website: homepage, all eight docs pages, 404 page, favicon and relay icons were released in Cloud Run revision `youbot-00005-phv`, serving 100% of traffic. Cloud Build `aa66e5f0-3ef1-46d8-9b07-a164a2329b7c` used the prior deployed image as its base and changed only logo markup, favicon cache version and three icons. Live bytes matched all 13 staged assets, and health returned 200. Desktop and mobile previews and the live homepage were visually inspected.
- Checks: all five existing website/service-worker checks passed. The initial sandboxed route test could not bind localhost; the permitted rerun passed. Evidence: `output/branding/verification/website-tests.txt` and `output/branding/verification/live-release.json`.
- No commit or push was made; unrelated source changes were preserved.

## Pending fikr-studio handoff

No callable fikr-studio MCP integration was available. Retained summary: Applied the approved minimal two-stroke Youbot logo through shared vector geometry, website and app branding, and browser/home-screen icons. Local app rebuilt and visually verified; isolated website release is live as `youbot-00005-phv`. Five website checks and exact live asset readback passed. User approval came from the instruction to apply concept v2 to the website and app.

# Project Home for Hermes Desktop

A Cowork-style project workspace: a stable **Projects** navigation item, a projects hub, and a project home showing the work and its context together.

## Features

- Projects hub with search, creation, recent activity, and project shortcuts.
- Project page with breadcrumbs, a new-session composer, recent conversations, and project notes.
- **Project notes:** a visible text area for objectives, considerations, and high-level direction—not a detailed/exhaustive plan or standing instructions. Explicit Save, saved/unsaved indicators, and conflict detection. Stored in `PROJECT_NOTES.md`.
- **Instructions:** edit the effective project-root context file; ancestor sources are reported read-only.
- **Context:** add text notes or upload reference files into `context/`.
- **Memory:** view/edit `MEMORY.md`, with a preview on the project page.
- **Scheduled:** create, pause/resume, and remove project-scoped tasks.
- Pin sessions in Hermes' native Pinned section. Pin projects as navigation shortcuts under Projects (the SDK cannot add projects to the native Pinned section).

## Install in the Mac app

Connect Hermes Desktop to your backend and select the intended profile.

1. Open **Capabilities → Plugins → Install from Git**.
2. Enter `https://github.com/jamahr/hermes-project-home` and choose **Review repository**.
3. Select **Desktop UI**. If the backend is already installed, uncheck **Agent plugin**; do not force-reinstall an existing backend installation.
4. Install, then enable **Project Home** in the Desktop UI column if it is off.
5. Click **Projects** in the sidebar.

For a fresh backend, also select the Agent plugin target and enable it for the intended profile. The Python backend must be enabled before its API can execute. Desktop files are installed on the Mac; project folders and the backend run on the connected server. Installing the backend on a VPS alone does not install the Mac UI.

Tested against Hermes Desktop renderer v0.22.7. Uses the current SDK's `host.openSession`, `host.sessions.pin`, `useGatewayActivationEpoch`, and plugin REST transport; older versions may require an update.

## Notes and agent awareness

Saving notes deliberately enables a small, marked reference in the effective root instructions file without replacing existing content. It tells project sessions to read `PROJECT_NOTES.md` as user-authored direction, not an exhaustive plan, and not to rewrite it without a request. Viewing a project does not modify files. New projects scaffold only missing files.

If ancestor or higher-priority instructions prevent safe root-level activation, the UI reports that notes were saved but agent awareness could not be enabled. A new session was live-tested reading a test objective from saved notes. Already-running chats may need to read notes again after changes.

## Remote access and safety

`ctx.rest` uses the active connection's profile-scoped `/api/plugins/project-home/` API. Native Desktop SSH mode forwards the server dashboard over a loopback tunnel. Public dashboard exposure and the browser Webapp are not required for normal use.

File operations use no-follow directory handles and descriptor-relative reads/writes within the registered project folder. Upload bodies are bounded before multipart parsing. Saves check expected existence and modification time. This is not an atomic compare-and-swap against external writers; a change in the final check-to-rename window can still be overwritten.

## Known limitations

- Project shortcuts are separate navigation rows, not entries inside native Pinned.
- The SDK exposes session pin mutation but no reactive pin-state reader. Pins changed elsewhere may show stale state on the project page; native Pinned remains authoritative.
- The file-browser action opens the existing files pane without changing its working directory.
- The 10 MiB upload cap includes multipart overhead. OAuth-remote uploads depend on the core transport and may be unavailable; SSH is the target.
- Reload can return the app to its default route; reopen Projects. Notes persist independently of navigation.
- The browser-rendered desktop interface was exercised on Linux. Native Mac installation still needs a user-side check.

## Verification

Backend tests cover file/context routes, folder confinement, no-follow operations, upload bounds, existence/mtime conflicts, instruction discovery, and notes activation. Latest run: **11 passed**.

Live renderer checks covered project creation; Instructions, Context, and Memory edits; scheduled-task creation/removal; starting a session with a real response; Recents; project/session pinning; notes persistence across reload; and a new session correctly reading the saved objective. Test projects/sessions were archived and temporary folders/tasks removed.

`tests/live-*.cjs` are development smoke tests, not portable installers. They assume a loopback Webapp and a local Chromium/Playwright installation. Screenshots and authentication material are excluded from the repository.

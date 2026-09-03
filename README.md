# Postal WebMCP Lab

A web page that hands an agent fourteen tools over the signed-in
user's music catalogue on [Postal](https://postal.music) — search the library,
match a brief against it, read a track, create a playlist, fill it, and mint a
private share link — plus up to five more that appear and disappear with
what is on screen and what is playing — and
narrates every step in a small corner box as it happens. There is no chat
input on the page: you talk to your agent where you already talk to it, and
the page shows what it did.

Built for the WebMCP hackathon. MIT licensed — except the bundled
[Inter](https://github.com/rsms/inter) font, which is SIL OFL 1.1
(`public/fonts/inter/OFL.txt`).

- **Live demo:** https://lab.postal.music
- **Reviewer access code:** provided on the submission form
- **Demo video:** _add your YouTube link here_

Open the page in ChatGPT's in-app browser, or in Chrome with WebMCP enabled,
sign in, and ask for what you want — for example *"Build a playlist of my
latest 5 tracks and give me the link so I can send it to my manager."* Three
tool calls later the link is in the corner box with a Copy button, and the
playlist drawer shows the picks so you can play them before you send it.

### Browsers without WebMCP

Most browsers do not expose `document.modelContext` yet. Rather than showing a
dead page, the Lab installs a small same-page polyfill
([`src/webmcp/polyfill.ts`](src/webmcp/polyfill.ts)) implementing the three
methods this project uses. The tool panel labels which is live — **Native
WebMCP** or **Polyfill** — and they differ in an important way:

| | Native | Polyfill |
| --- | --- | --- |
| Tools callable from this page (console, tests) | yes | yes |
| Discoverable by an outside agent | yes | no |

The polyfill is a local registry, not a fake agent: the same registration,
discovery and execution path runs, but only this page can call the tools. When
the browser has a real implementation, the polyfill steps aside entirely.

### Signing in

Postal accounts are passwordless: enter your email, Postal sends a six-digit
code, the code becomes a session. Reviewers who cannot read the demo account's
inbox enter the shared access code from the submission form instead, which
opens a session on the demo catalogue. That door only exists when the Worker is
configured with both `DEMO_ACCESS_CODE` and `DEMO_ACCESS_TOKEN`.

---

## Why this use case fits WebMCP

Music catalogues are the awkward middle case for agents. The data is private
(it is someone's unreleased work), the actions are consequential (playlists get
sent to labels and supervisors), and the selection criteria are hopelessly
subjective — "the melodic ones", "the stuff that sounds like the Ibiza set",
"nothing with vocals". Today an artist or sync agent solves this by clicking
through a library for an hour.

A server-side MCP integration would need its own OAuth client, its own copy of
Postal's permission model, and a long-lived token sitting on a server that the
user cannot see. WebMCP removes all of that: the tools live in the page the
user already has open and already signed into. The session in the browser *is*
the authorization. Nothing is delegated, nothing is stored, and closing the tab
revokes access.

That fit is why every tool here refuses a `userId` parameter. The agent cannot
name a user to act as; it can only act as whoever is looking at the page, and
the Postal backend re-checks ownership on every call regardless.

## How it makes for a better experience

The slow part of catalogue work was never any single click — it is that
"assemble a shortlist and share it" spans search, curation, playlist creation,
and link permissions, four screens that do not know about each other. Stating
the outcome once and watching it happen collapses that.

The page stays a page. Tool executions stream into a small activity box in
the corner — minimised to one line that narrates the current step
("Creating playlist “Ibiza Shortlist”…", "Waiting for your approval…",
"Link ready — Copy link"), expandable to every step with timings and typed
error codes — so the user watches the agent work rather than trusting a
summary of it. When those calls add up to a playlist,
the page reassembles it from the tool results and opens a playlist drawer —
a side panel that shows the playlist filling up live, then ends on the
deliverable: playable tracks, the private share link, and the picks
highlighted in the catalogue. The human validates the deliverable by ear,
not by reading the agent's claim of it; closing the drawer leaves a pill to
reopen it. Writes are reversible and narrow — a
playlist is created private, a share link is unlisted and rotatable — so the
worst outcome of a misunderstood prompt is a playlist you delete.

## What people and agents can do together that was hard before

- **Turn taste into a shortlist.** "Five melodic electronic tracks I uploaded
  recently, as a playlist called Ibiza Shortlist, with a private link" is one
  sentence and four permissioned writes against a private catalogue.
- **Hand over a link without handing over the library.** The agent produces an
  unlisted link to exactly the tracks chosen — no account access, no export.
- **Pitch a brief from wherever it arrived.** Because the tools are registered
  by the page, an agent can read a sync brief in Gmail, Disco or Notion in
  another tab, hand its text to `match_brief` here, and get back the tracks
  that fit — ranked by Postal's audio analysis, each with a one-sentence
  reason — without any of those services integrating with Postal. The page
  lays the picks out as a shortlist with inline play, so the person auditions
  them, unticks what does not fit, and presses **Create playlist**; the agent
  then mints the link and drafts the reply back in the tab the brief came
  from. Two services that never met, glued together by the agent.
- **Keep the audit trail.** Every execution is visible, timed, and attributable
  in the log, which is the thing catalogue owners actually ask for before
  letting software touch their unreleased material.

## How WebMCP is implemented

Tools are registered with the browser on mount and torn down with an
`AbortSignal` on unmount ([`src/webmcp/register-postal-tools.ts`](src/webmcp/register-postal-tools.ts)):

```ts
document.modelContext.registerTool({
  name: "search_tracks",
  description: "Search the signed-in user's Postal music library…",
  inputSchema: { /* JSON Schema — no userId, by design */ },
  execute: async (input) => { /* authenticated Postal capability */ },
});
```

The fourteen tools are `search_tracks`, `match_brief`, `get_track`, `list_playlists`,
`get_selected_tracks`, `get_brief`, `control_playback`, `create_playlist`,
`update_playlist`, `add_tracks_to_playlist`, `remove_tracks_from_playlist`,
`reorder_playlist`, `delete_playlist` and `create_share_link` — searches and
reads compose
with the writes, so an agent can resolve titles to ids, rediscover an existing
playlist's id, and assemble any custom selection. Each one:

- validates its input with `zod` before touching the network;
- calls a capability adapter in [`src/capabilities/`](src/capabilities) that
  talks to Postal's existing product endpoints — no new backend was written for
  this;
- resolves to a **JSON string**, which is what the imperative API hands the
  agent — failures included, as `{ success: false, error: { code, message } }`
  carrying a typed code (`TRACK_NOT_FOUND`, `ACCESS_DENIED`,
  `UNAUTHENTICATED`, …) rather than a thrown exception an agent cannot reason
  about;
- emits a `postal:webmcp-activity` event that drives the on-page log.

Two programmatic drivers live alongside the tools, exercised by the test
suite rather than wired into the page: a deterministic runner
([`src/webmcp/demo-workflow.ts`](src/webmcp/demo-workflow.ts)) that walks the
documented scenarios through `document.modelContext.getTools()` and
`executeTool()`, and an on-device planner (below). The page itself has no
composer any more — the agent is the caller — so the UI never fills in a
prompt or downloads a model; it only shows what the agent did.

`create_playlist` accepts an optional `trackIds` array, so "make me a
playlist of these" is one call instead of two. Each round trip through an
agent costs seconds; removing one is the difference between the link
arriving while the user is still watching and after they have looked away.

Two contract details worth knowing if you build on this: `executeTool(tool,
inputJson)` takes its arguments as a **JSON string** — passing an object fails
with "Failed to parse input arguments" — and it takes the tool object returned
by `getTools()`, not the name you registered.

### The tool list follows the screen

A server-side integration describes its tools once. This page re-registers
them as the person works, because WebMCP gives it the two primitives that
need: registration with an `AbortSignal`, and a `toolchange` event agents
listen to. [`src/webmcp/contextual-tools.ts`](src/webmcp/contextual-tools.ts)
builds the tool set for the current page state and
[`src/webmcp/dynamic-tools.ts`](src/webmcp/dynamic-tools.ts) reconciles the
browser towards it — new names register, gone names abort, and a tool whose
*description* changed is aborted and registered again, because the
description is what the agent reads to decide what to call.

- **`get_selected_tracks` says what is selected.** Its description is
  rewritten on every click: "Right now 3 tracks are selected: “Sunrise”,
  “Ember”, “Drift”". An agent can act on the selection without spending a
  call to look at it.
- **`remove_from_open_playlist` and `reorder_open_playlist` exist only while
  the playlist dialog is open**, and their descriptions name the playlist and
  its tracks. No `playlistId` in their schema — the thing on screen is the
  target. Close the dialog and they are gone; calling a stale handle returns a
  typed error pointing at the id-taking tools.
- **`create_playlist_from_shortlist` exists only while a brief shortlist is
  showing**, and uses exactly the picks the person kept after unticking. The
  agent has no other way to see those unticks: the human's pruning reaches
  the agent as a tool that appears, not as a message they have to type.

- **`get_now_playing` exists only while audio plays**, and its description
  names the track: "The page is playing “Ember” through the user's speakers
  right now". The result carries the live position. 'This one', 'the one
  playing', 'skip this' resolve without the person naming anything — the
  agent knows what the user's ears are on, which nothing outside the page can
  know.
- **`remove_now_playing` exists only while the playing track is in the
  current playlist.** "Not this one" drops it from the playlist and moves
  playback on to the next track, so auditioning a pitch is a conversation
  rather than a form.

### A player that knows where the good bit is

Once anything plays, a fixed player appears along the bottom
([`src/lab/bottom-player.tsx`](src/lab/bottom-player.tsx)): Postal's
precomputed waveform with the analysis markers laid over it — sections as
shaded bands you can click into, and point highlights ("Best hook", "Biggest
lift", "First vocal") as chips that jump straight there. Previous / next
walk the list the track belongs to — the playlist being built, else the
brief shortlist, else the catalogue as shown — and a finished track advances
to the next one on its own; the OS media keys do the same. Auditioning a
pitch means hearing the moment that matters, not thirty seconds of intro.

The same markers reach the agent: `get_now_playing` returns the track's
sections and highlights with their times and which section is playing now,
and `control_playback` accepts `action: "seek"` with either `positionSec` or
a spoken `section` ("drop", "hook", "chorus", "first vocal") resolved against
those markers, plus `next` and `previous` over the same queue the bar uses.
"Play me the drop" lands on the same spot a click on the chip would, and
"next" goes where the arrow would.

The agent manifest carries a `dynamic` note telling DOM-reading agents to
re-list after they act, and the tool status panel in the box footer shows the
live extras under "For what is on screen now". The polyfill fires
`toolchange` too, so the behaviour is identical without a native browser.

### What only a page can offer an agent

Three of the tools are capabilities a server-side MCP integration cannot
provide, because they live in the page the human is looking at:

- **`get_selected_tracks`** reads the checkboxes the user has ticked in the
  catalogue — a shared workspace. "Add the ones I selected, plus three that
  fit" needs the human's pointing and the agent's reach in one place. Its
  description already names the selection (see above).
- **`get_brief`** reads the PDF brief the user dropped onto the page. Tool
  calls carry JSON, never files — so the page extracts the text in-browser
  (lazy-loaded pdf.js, embedded scripts inert) and the agent reads the
  extraction: drop the document on the workspace, then tell the agent to
  "handle the brief on this page".
- **`match_brief`** turns a brief into ranked picks — and, with
  `playlistName`, into a playlist in the same call, so the dialog and the
  player become the workspace: the agent refines it with removes and adds
  while the person listens, instead of proposing a list nobody can hear.
  Hard filters the brief states ("100–115 BPM", "instrumental only") are
  read from the text and enforced even when Postal's brief parser is down,
  and the agent can pass `bpmRange` / `instrumental` to override. Without
  `playlistName` its result is a *proposal the page renders*, not a write. The shortlist panel shows each
  pick with the ranker's reason and a score bar, plays it inline, and lets the
  person drop the misses before anything is created. Its **Create playlist**
  button runs the very same `create_playlist` tool an agent would, so the
  handover from agent proposal to human decision to agent follow-through
  (share link, reply) happens in one activity stream. Without `brief` it
  reads the PDF dropped on the page, so "pitch the brief on this page" is one
  call. It is metered (one Postal credit per call, `INSUFFICIENT_CREDITS` when
  the account is dry), which is why it is the one read that the tool
  description tells agents not to spam.
- **`control_playback`** plays audio through the page's player — out of the
  user's actual speakers, in the tab they are watching. An agent can DJ its
  own shortlist.
- **`create_share_link` pauses for in-page approval.** The page interrupts
  the tool call, the activity box opens itself with Approve / Always approve /
  Deny (or, when the playlist drawer is open, the same choice inside the
  drawer); the link is only minted after a human click. Every caller hits the
  same gate, and a decline or a two-minute timeout comes back as a typed
  `USER_DENIED` error the agent can reason about. Authorization by presence:
  the human is in the loop because the tools physically run where the human
  is. The human can also lift the gate: "Always approve" (or the Auto-approve
  toggle in the box's footer) is a standing grant stored in this browser
  profile, so a trusted agent can run the whole workflow unattended. The grant
  is the page's — set and revoked by the user, never by the agent — and
  auto-approved calls are labelled as such in the steps and history.

### An on-device planner, kept off the page

[`src/webmcp/prompt-planner.ts`](src/webmcp/prompt-planner.ts) is a small
planning loop over Chrome's built-in [Prompt API](https://developer.chrome.com/docs/ai/prompt-api):
it hands the on-device model the registered tool descriptions, asks for the
next step as schema-constrained JSON (`responseConstraint`), executes the tool
it names through the same `document.modelContext.executeTool()` path an
outside agent uses, feeds the result back, and stops when the model reports it
is done. It proves the "one contract, any caller" property — an outside agent
and the page's own model drive identical tool calls — and it is tested, but it
is not wired into the UI. Earlier builds put a composer on the page that ran
it; that meant a second conversation next to the agent's, and a fresh model
session (with its download progress) on every prompt. The agent is the caller
now, and the page only shows what it did.

### Three doors for agents that cannot see the API

Extension- and automation-driven agents (Claude in Chrome, Playwright-style
content scripts, most "browser agent" products) run their scripts in an
*isolated world*: the same DOM, but separate `window` and `document` wrappers
that do not expose new platform APIs like `document.modelContext`. Such an
agent sees a page that talks about WebMCP and finds nothing to call. So once
the tools are registered, [`src/webmcp/agent-bridge.ts`](src/webmcp/agent-bridge.ts)
publishes two things into the DOM, which every world shares:

- **A manifest.** `<script type="application/json" id="postal-webmcp-manifest">`
  in `<head>` lists every tool with its description and input schema, plus the
  exact calling instructions for all three paths below. `<html data-webmcp-tools="N">` (the count moves with the screen)
  flags it, and a visually-hidden section (`#postal-webmcp-agent-note`) in the
  rendered text and accessibility tree tells a DOM-reading agent that the
  tools have no buttons and where the manifest is.
- **A bridge.** A same-origin `window.postMessage` protocol. Post
  `{ type: "postal:webmcp", id, action: "call", tool, input }` (or
  `action: "list"`) and listen for a `message` whose data is
  `{ type: "postal:webmcp:result", id, ok, result | error }`. The page runs
  the tool in its main world through the same
  `document.modelContext.executeTool()` path a native agent uses, so the
  activity box, the history and the share-link approval gate behave
  identically. Only messages from this window and this origin are honoured —
  otherwise a cross-origin frame could use the bridge to bypass WebMCP's own
  `exposedTo` policy.

- **A URL door.** Some agents can do exactly two things with a browser: open
  a URL and read the page's text. No JavaScript, no clicks, no
  `postMessage`. For them, a tool call can travel in the hash:
  `/#tool=search_tracks&input=%7B%22limit%22%3A5%7D` (optionally `&id=…`).
  [`src/webmcp/url-door.ts`](src/webmcp/url-door.ts) parses it, runs the
  named tool through the same instrumented definition a WebMCP agent would
  call — static or contextual — and the page renders the outcome as plain
  text in a "Tool call from URL" section (with the full JSON in
  `<script id="postal-url-door-result">`) that a text-reading agent picks
  up on its next read. Links are something anyone can put in front of a
  signed-in person, so the door is gated: free read-only tools run on
  arrival; anything that writes, or costs credits (`match_brief`), shows a
  card and waits for the person to press **Run**. After a call the hash is
  replaced with `#done=…` so a reload cannot repeat it. A call that arrives
  in a *new* tab — an agent's shell `open`, an OS URL handler — is handed
  over a same-origin `BroadcastChannel` to the Lab tab that is already open
  ([`src/webmcp/url-door-relay.ts`](src/webmcp/url-door-relay.ts)), so the
  result appears in the tab the agent is actually reading, and the new tab
  says so. It is the least capable door and the manifest says so, but it
  means the poorest agent in the room can still search, match, play and
  build a playlist here.

Agents that *can* evaluate in the main world (CDP `Runtime.evaluate`, Chrome
extensions with `world: "MAIN"`, Playwright's `page.evaluate`) should call
`document.modelContext` directly; the manifest tells them so.

### Where the credentials live

The page never holds a Postal access token. A small Cloudflare Worker
([`worker/index.ts`](worker/index.ts)) turns a sign-in into an httpOnly, signed
session cookie, then proxies calls to the Postal API with the token attached
server-side. Either way in — emailed code or reviewer access code — the token is
verified against `GET /users/me` before a session is sealed, so a session always
matches a real Postal account. The proxy is allow-listed to the six endpoints
the tools need; without that, it would be an open credential-bearing relay
to the whole API for any script on the page.

```
browser (tools) → /api/postal/*  →  Worker (adds bearer token) → api.postal.ac
```

Three further controls, because this repo is public and the endpoints' shapes
are therefore known:

- **Per-IP rate limits** on both unauthenticated endpoints — 10/min on sign-in,
  5/min on the reviewer door ([`wrangler.jsonc`](wrangler.jsonc)). Requesting a
  sign-in code creates a Postal account for an unrecognised address, so an
  unthrottled relay would be an account-creation and mail-spam tool. Where no
  rate-limit binding exists, a weaker per-isolate counter takes over.
- **The client's IP and user agent are forwarded** to Postal. Otherwise every
  request arrives from a Cloudflare address, blinding Postal's own per-IP
  throttling and request logging.
- **A minimum access-code length** of 20 characters. Below that the reviewer
  door refuses to open at all, rather than trusting rate limiting alone to hold
  off guessing.

## Running it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in SESSION_SECRET
npm run dev
```

`.dev.vars` holds the Worker's secrets:

| Variable | Meaning |
| --- | --- |
| `POSTAL_API_URL` | Postal backend base URL (`https://api.postal.ac`) |
| `POSTAL_API_KEY` | Postal API key header value |
| `SESSION_SECRET` | HMAC key for the session cookie (`openssl rand -hex 32`) |
| `DEMO_ACCESS_CODE` | Optional. Shared code that opens the demo account — 20+ chars (`openssl rand -base64 24`) |
| `DEMO_ACCESS_TOKEN` | Optional. Postal access token for that account |

#### Issuing the demo token

Postal tokens last 30 days and are revocable from the account's sessions, so
mint one shortly before submitting and revoke it when judging closes.
[`demo/mint-demo-token.mjs`](demo/mint-demo-token.mjs) walks the whole
ceremony — requests the sign-in code, verifies it into a token, generates a
strong access code, and prints the exact secrets to set:

```bash
node demo/mint-demo-token.mjs demo@yourdomain
```

Anyone holding the access code can act as that account through the tools,
so point it at a demo catalogue, not a real one.

Tests and types:

```bash
npm test
npm run typecheck
```

The suite covers tool composition, unauthenticated access, invalid track and
playlist IDs, playlists the user cannot write to, backend failure, unsupported
browsers, duplicate registration, and `AbortSignal` cleanup.

## Deploying

```bash
npx wrangler secret put POSTAL_API_KEY
npx wrangler secret put SESSION_SECRET
npx wrangler secret put DEMO_ACCESS_CODE    # optional, for reviewers
npx wrangler secret put DEMO_ACCESS_TOKEN   # optional, for reviewers
npm run deploy
```

`POSTAL_API_URL` and `POSTAL_APP_URL` are plain vars in
[`wrangler.jsonc`](wrangler.jsonc). Because all Postal traffic goes through the
Worker on the Lab's own origin, no CORS changes are needed on the Postal side.

## Project layout

```text
worker/index.ts        Session cookie + allow-listed Postal proxy
src/postal/            The only place that knows how to reach Postal
src/capabilities/      Validated, authenticated capability adapters
src/webmcp/            Tool contracts, registration, contextual (live) tools, agent manifest + bridge, demo chain, planner
src/lab/               Catalogue, agent activity box, playlist drawer, history
```

## Scope and honesty about limits

- The page has no prompt input of its own: it needs a WebMCP-capable agent
  driving the tools. The deterministic runner and on-device planner exist as
  tested modules, not as UI.
- `search_tracks` ranks Postal's existing metadata (title, artist, tags,
  genres, moods). Audio-based matching lives in `match_brief`, which needs the
  tracks to have been analysed by Postal first — freshly uploaded tracks are
  invisible to it until their analysis lands.
- Writes are limited to creating, editing, reordering and deleting the user's
  own playlists, playing audio, and minting a private link — the link only
  after in-page human approval, deletion always. Nothing publishes, emails,
  or sells.

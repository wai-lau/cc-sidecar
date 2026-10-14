# claude-box — archaeology

Sidecar-side history, moved from exec-fn's ARCHAEOLOGY.md §7 on 2026-10-14. These are the incidents behind the rules in [ARCHITECTURE.md](ARCHITECTURE.md); the current design lives there. A bare "§N" means exec-fn's ARCHITECTURE.md/ARCHAEOLOGY.md. The panel/page-side history stayed in exec-fn's ARCHAEOLOGY.md §7.

## It became a full agent on 2026-09-13

It shipped as a deliberately tools-light chat page ("no filesystem, never offer to run anything", two web tools). That framing is historical: `Read`, `Write`, `Edit`, `Bash`, `Glob` and `Grep` are on, at Wai's request, because she wants the working surface of a terminal session without the terminal. The old justification — "with no `Read` there is no local untrusted content to inject THROUGH, and with no `Bash`/`Write` an injected instruction reaches nothing it could act on" — **is no longer true and must not be quoted back as if it were.** What the decision bought and what it costs is ARCHITECTURE S-4.

The web tools were added 2026-09-11 after the page answered "search news" with its training cutoff, which is broken behaviour for a chat assistant; the system prompt now tells it to search first and never cite its cutoff on a dated question.

## The 2026-09-10 session's worst finding: connectors ride the login

Signing cc-agent into claude.ai attached that ACCOUNT's connectors — a probe found Gmail, Google Calendar and Google Drive all `"connected"`, exposing `send_message`, `trash_thread`, `share_file`, `download_file_content` and `delete_event` through a public-internet page behind one cookie (plus `CronCreate`, `RemoteTrigger`, `PushNotification`). They are server-side capability riding the OAuth identity, so the mount namespace, `settingSources: []` and a built-in-tool blocklist ALL missed them. **Any subscription login inherits whatever connectors the account has** — `strictMcpConfig` is what drops them; re-probe after enabling a new one.

## Denylist to allowlist (2026-09-13)

It was a **denylist** until then (`disallowedTools`, every name by hand), and that is a losing game: every name added after the fact is one that already reached a user once. **`AskUserQuestion` is how this was found** — nothing listed it, so it rode in on the login, the model called it mid-answer, and the page printed a raw `AskUserQuestion is not available in the sandbox` at Wai. Measured on the pre-fix config the same day: **8 tools reached the model, not 5** — also `EnterPlanMode` and `ExitPlanMode`, unnoticed because the model never happened to call them. With `tools` set: exactly the allowlist.

**`canUseTool` is NOT the gate and must never be described as one.** Measured 2026-09-10 with a deny-everything callback and `ToolSearch`/`CronList` left visible: both EXECUTED (`CronList` returned "No scheduled jobs") and the callback was never invoked. It does not see harness tools. The code said "the actual gate" in a comment for months, which is most of why the denylist was treated as cosmetic and left to rot.

**The probe was referenced in the docs for months without existing as a file** (`probe-tools.mjs`), which is most of how a tool reached a user: nothing was re-run because there was nothing to run. It imports `sandboxOptions()` from `server.mjs` rather than rebuilding it, and that import is why `server.listen` is guarded by `RUN_AS_MAIN`.

Doc-count drift: the tool count was documented as 5 (`TOOL COUNT: 5`) long after the page became a full agent, then 12, then 14; the source said 11 + 3, and since the Exec merge it is 11 + 3 + 10 = 24 (22 on a cold probe).

## `/etc` was bound wholesale

The one place the mount allowlist went coarse. Once `Bash` was on that mattered: `/etc/cron.d/exec-fn-security` carries `SECURITY_OWNER_IP` — Wai's home IP, precisely the owner-identifying data `/security` never renders — and `/etc/nginx` exposed the topology. Now only `ssl` / `ca-certificates`, `passwd` / `group`, `nsswitch.conf` / `hosts` / `resolv.conf` and `localtime` are bound. Verified in the live namespace: `/etc/cron.d`, `/etc/nginx`, `/etc/shadow` and `/exec-fn` are absent. Earlier (2026-09-10): `ProtectSystem=strict` alone made the filesystem read-only but hid nothing — the agent could `ls /exec-fn` and read `/exec-fn/.env` — and combined with `TemporaryFileSystem=/` it silently won and brought the real root back (checked in `/proc/<pid>/mountinfo`), so it is absent from the unit on purpose.

## Probe runs filed a conversation

`/sessions` lists every session whose cwd is the sandbox, so a probe sharing the sandbox put `probe` in Wai's picker. `probeOptions()` now runs in `TITLE_SANDBOX`. Four transcripts from before that existed were moved to `~cc-agent/.cc-probe-junk/` (not deleted) on 2026-09-14.

## The session pointer

The session id used to be a JS variable on the page, so every page load silently began a new conversation: five sessions came out of a handful of messages. Moving it into `~cc-agent/.cc-session` also means the thread survives a phone locking and a move between devices.

## The titler: scratch sessions in the picker, twice

- **Tool exposure (2026-09-13).** The titler was reaching the model with `WebSearch` and `WebFetch` — a call whose job is naming a conversation, holding an outbound-request tool while fed that conversation's text. It carried `allowedTools: []`, which is not a restriction, and no `tools` option. Now `tools: []`.
- **Its own cwd (2026-09-13).** Sharing the sandbox meant each rolling title (writer + judge, twice on a retry) left 2-4 throwaway sessions in the `/list` picker; "Zekoa physical mitigation" appeared three times, seconds apart, and 20 of 61 listed sessions were titler scratch. The 20 were MOVED to `~cc-agent/.cc-titler-scratch/`.
- **The `limit` layer (2026-09-21).** `listSessions()` is ACCOUNT-wide and its `limit` applies BEFORE any cwd filter, so `{limit:100}` then `.filter(cwd === SANDBOX)` kept whichever of the newest 100 happened to be conversations: **94 of 100 were titler scratch, 6 real**, bottoming out six days back. Every older conversation was invisible to `/list` AND `/listall`; it looked like a 7-day retention policy that did not exist (transcripts were on disk back to 2026-09-08). Fix: `sandboxSessions()` = `listSessions({ dir: SANDBOX, limit: 500 })` — 6 listed → 50.
- Why generation is on the plan: it used to call the Anthropic API with the per-token key. The SDK's own `summary` was tried first for titles and is not enough (on a live conversation it is usually just the opening prompt); the good titles in Wai's terminal come from her recap hook (`~/.claude/hooks/session-recap-gen.js`), which this mirrors.

## The hangup listener was on `req` for eighteen months (fixed 2026-09-21)

`handleQuery` runs AFTER `readBody()` has consumed the request to `end`, and a fully-read `IncomingMessage` never emits `close` again — measured on node v22 with a stub server built exactly like this one: a client that hangs up mid-stream fires `close` on the **response** at the moment of the hangup and **nothing at all, ever**, on the request. So the abort never fired. Nothing downstream noticed because every other link worked: the browser aborted, nginx dropped the upstream, Starlette cancelled, httpx closed the socket — and node, holding no listener that could hear any of it, went on awaiting an SDK run whose reader had left. `active` stayed at 1 and **every later send answered `busy`** until the run finished or the 10-minute `IDLE_TIMEOUT_MS` abort fired (the idle abort is the same `controller`; a CLI subprocess gone quiet held the slot the full ten). Seen from the page as two consecutive `[ busy — one run at a time (memory ceiling); try again shortly ]` lines. On the fix (listener on `res`), a hangup freed the slot in **2–3s** and the CLI child exited with it.

**Superseded 2026-10-14:** the hangup abort was removed altogether — a run now outlives its caller and `POST /interrupt` is the only way to stop one (ARCHITECTURE S-11). Hanging up used to be the interrupt, which also killed Exec mid-answer whenever the phone backgrounded the page.

## Tool results that vanished

The web tools return structured blocks with no `text` field, which `resultText()` joined to `""`, so the page dropped the result whole and a WebFetch line had nothing folded under it (reported as unexpandable, fixed 2026-09-15). `resultText()` now falls back to the block's JSON, an `[image]` marker instead of a megabyte of base64, and a 20 000-char cap so one unbounded result cannot cross the relay whole. (The page-side half of this story is in exec-fn's ARCHAEOLOGY.md §7.)

## Files setup.sh forgot

`archive-tools.mjs` and `usage.mjs` were missing from `setup.sh`'s install list until 2026-09-13 (they had been copied in by hand), so a fresh run deployed a `server.mjs` whose imports did not exist and the unit would not boot. Comment in `setup.sh`: every module `server.mjs` imports has to be listed.

## Live-credentials and the sign-in (2026-10-09/10)

On 2026-10-09 the CLI's OAuth refresh failed (the credentials file was rewritten with `expiresAt: 0`, refresh token still present) and every Exec turn became `Failed to authenticate: OAuth session expired and could not be refreshed`. The ssh recovery was miserable from a phone, and the TUI hard-wraps the sign-in URL to the terminal width — the copied, wrapped URL was refused by claude.com as `Invalid request format`. `login.mjs` (2026-10-10) moved the whole flow into the panel.

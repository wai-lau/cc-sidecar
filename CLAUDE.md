# claude-box

The host-side Claude Code sidecar behind the Exec panel (`server.mjs` on the Agent SDK, run as `cc-agent` by `cc-sidecar.service`). Design: **ARCHITECTURE.md** here (S-N sections); incidents: **ARCHAEOLOGY.md**; install/ops: **README.md**. The exec-fn side (routes, `cc_client.py`, the Exec panel UI) is exec-fn's ARCHITECTURE.md §7.

---

## RULES — READ FIRST

**This is a git SUBMODULE of exec-fn** at `claude-box/` (repo `wai-lau/cc-sidecar`). Commit HERE: from exec-fn, `git -C claude-box commit ...`. exec-fn's push hook pushes this repo first, then bumps and pushes exec-fn's submodule pointer. A bare "§N" in these docs means exec-fn's ARCHITECTURE.md.

**Editing the repo changes NOTHING live.** The sidecar runs from `/srv/cc-agent/` (root-owned copies). After a change: `sudo bash /exec-fn/claude-box/setup.sh` (idempotent; copies every module + `cc-context.md`, installs the unit and the probe cron, `daemon-reload`) and then `sudo systemctl restart cc-sidecar`. **A new module `server.mjs` imports must be added to `setup.sh`'s install list** or the unit will not boot. **ARCHITECTURE.md S-1**.

**`cc-context.md` is read per run from `/srv/cc-agent/`** — no restart, but the repo copy alone does nothing: `sudo install -o root -g cc-agent -m 0640 claude-box/cc-context.md /srv/cc-agent/`. It is Wai's personal context; **if the owner-only tier is ever widened, pull it first**. **S-9**.

**OWNER-ONLY MUST NEVER CHANGE.** The sidecar hands whoever reaches it a shell on the droplet as `cc-agent` plus the subscription's rate budget. The exec-fn routes stay on `protected`, never `guest_protected` (pinned by exec-fn's `tests/test_cc_admin_only.py`). **S-4**.

**THE TOOL SURFACE IS AN ALLOWLIST.** The SDK `tools` option (`BUILTIN_TOOLS`) + hand-written `EXEC_TOOLS`; never a denylist, and `canUseTool` is NOT a gate for harness tools. Every `query()` call site must set `tools` explicitly (three today: `server.mjs`, `title-gen.mjs`, `probe-tools.mjs`). **S-3, S-6**.

**RE-PROBE after any `@anthropic-ai/claude-agent-sdk` bump** or when an account connector is enabled: `scripts/cc-probe-daily.sh` does it nightly (5:20 cron, keyed on the INSTALLED version); by hand `sudo /exec-fn/scripts/cc-probe-daily.sh --force`. Expect no `UNEXPECTED` (cold probe lists 22 of the 24 allowed names). **S-6**.

**The sandbox stays sealed**: no bind for `/exec-fn`, `data/` or the docker socket. Verify any unit change from INSIDE the namespace (`nsenter`, S-3), not as `cc-agent` alone. Accepted risks (Bash reaching `/home/cc-agent`, credential exfil via WebFetch) are decided — don't re-litigate (S-4, S-5).

**A run outlives its caller.** No hangup abort: the only ways to stop a run are finishing, the 10-min idle timeout and `POST /interrupt`. **S-11**.

**The session pointer is server-side** (`~cc-agent/.cc-session`) and `/new` archives BEFORE dropping it; a failed archive must keep aborting the clear. List sessions only through `sandboxSessions()`. Probes and the titler run in `TITLE_SANDBOX` so they never file a conversation. **S-10**.

**The system prompt must stay byte-stable** (cacheable): nothing dated or per-board in it; the board rides in the user message's `<exec-context>` block. **S-9**.

**Never put `CC_SIDECAR_TOKEN` in the CLI's env** (`childEnv()` strips it). **S-7**.

**TESTS**: `node --test *.test.mjs` from this directory (login, sandbox-paths, uploads). NEVER `node --test .` / a bare directory — it would execute `server.mjs` (binds the port) and `probe-tools.mjs` (spends an API call). exec-fn's `tests/test_cc_node_suites.py` runs every `*.test.mjs` inside its pytest (discovered, so a new suite is covered the day it lands; it FAILS if the login or sandbox-paths suite goes missing).

**Lints, hooks and checks are exec-fn's, not this repo's.** `scripts/pre-commit` here is a SHIM (verbatim copy of exec-fn's `scripts/subrepo-pre-commit`; git runs it via `core.hooksPath=scripts`, which exec-fn's session hook sets). Inside exec-fn it runs exec-fn's `scripts/pre-commit`; cloned on its own it sparse-pulls ONLY the lint files (exec-fn `scripts/tooling-paths.txt`) into the gitignored `.exec-fn/` and runs that (lints only; tests need exec-fn). Never edit the shim here — change checks in exec-fn. A standalone clone: `git config core.hooksPath scripts` once. exec-fn ARCHITECTURE.md §1e. For this repo exec-fn's hook runs: `node --check` on staged `.mjs`, every suite, shellcheck.

---

## Index

| What | Where |
|---|---|
| Topology, endpoints, install, limits | ARCHITECTURE.md S-1 |
| Panel sign-in (`login.mjs`) | S-2 |
| Sandbox: mount namespace, MCP allowlist, tools allowlist | S-3 |
| Blast radius (accepted) | S-4 |
| Path gate (`sandbox-paths.mjs`) | S-5 |
| Tool allowlist, counts, probe | S-6 |
| Exec card-tool relay + token (`exec-tools.mjs`) | S-7 |
| Archive tools | S-8 |
| Persona assembly (`buildSystemPrompt`, `cc-context.md`) | S-9 |
| Session pointer, history, `/new` archive, listing | S-10 |
| Interrupt / run outlives caller | S-11 |
| Rolling titles (`title-gen.mjs`) | S-12 |
| Images + dropped files (`uploads.mjs`) | S-13 |
| Usage / limits (`usage.mjs`) | S-14 |
| Ops cheat sheet | S-15 |

**Docs rule**: keep this file an INDEX (one short line + pointer). Measurements, traps, incident stories go in ARCHITECTURE.md / ARCHAEOLOGY.md. Count tools from `server.mjs`, never from a doc.

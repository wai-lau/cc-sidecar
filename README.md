# claude-box — sandboxed Claude Code sidecar

**Repo:** `wai-lau/cc-sidecar`, consumed by exec-fn as the git submodule
`claude-box/` (since 2026-10-14; history split out of exec-fn). Commit HERE —
from exec-fn, `git -C claude-box commit ...` — and exec-fn's push hook pushes
this repo first, then bumps and pushes exec-fn's pointer. The live sidecar runs
from `/srv/cc-agent/`, so a commit changes nothing until `setup.sh` reinstalls.

Serves the Exec panel on the site (the `/api/cc/*` routes). The api container is `python:3.12-slim` with no node,
no `claude` binary and no credentials, so Claude Code runs **host-side** as its
own unprivileged user and the container talks to it over the docker bridge —
the same shape as the hosaka / emet / printer upstreams, minus the SSH tunnel
(this one is already on the same box).

```
browser ──HTTPS──▶ nginx ──▶ api container ──172.17.0.1:8129──▶ cc-sidecar
                             (routes_cc.py)                     (cc-agent)
                                                                    │
                                                                cwd=/srv/cc-sandbox
```

## Blast radius

`cc-agent` has no sudo, no docker group, and no read access to `/exec-fn`. Its
cwd — `/srv/cc-sandbox` — is the working area. It has `Bash` and the web tools,
so the honest boundary is the mount namespace plus a path gate, not "no tools"
(ARCHITECTURE.md S-3 to S-5). The layers, strongest first:

1. **systemd** (`TemporaryFileSystem=/:ro` + named binds) — `/exec-fn`, `.env`,
   `data/` and `docker.sock` are not merely unreadable by uid, they are absent
   from the mount namespace. `/home/cc-agent` (OAuth token) IS in it; that risk
   is accepted (S-4).
2. **The tool allowlist** — the SDK `tools` option (`BUILTIN_TOOLS` in
   `server.mjs`) keeps anything unnamed out of the model's context.
3. **`canUseTool`** — denies names outside `ALLOWED_TOOLS` and confines the
   path argument of `Read/Write/Edit/NotebookEdit/Glob/Grep` to the sandbox
   dir (`sandbox-paths.mjs`, resolved-path check; `Glob`'s `pattern` and
   `Grep`'s `glob` are not checked). It does NOT see harness tools and does
   not cover `Bash`.
4. **`settingSources: []`** — no settings file is read, so a `settings.json` the
   agent wrote itself cannot come back as policy.

`/srv/cc-agent` (the sidecar code) is root-owned and group-readable, so the
agent cannot rewrite the server that constrains it.

## Install

```bash
sudo bash /exec-fn/claude-box/setup.sh
```

Idempotent. Creates `cc-agent`, `/srv/cc-sandbox`, installs the SDK into
`/srv/cc-agent`, generates `/etc/cc-sidecar.env` (shared secret — the bridge
port is host-only, but *any* container on the box can reach it), and installs
the unit and the nightly probe cron.

## One-time login

The sidecar authenticates as **cc-agent's own** subscription login. Do not copy
`~wai-root/.claude/.credentials.json` into it: two processes on one OAuth
refresh token race, and the loser — usually the interactive session — is logged
out mid-refresh.

```bash
sudo -u cc-agent -H /usr/bin/claude     # then: /login, then /exit
```

`cc-agent`'s shell is `nologin`; `sudo -u` execs the binary directly, so this
works anyway. Verify:

```bash
sudo systemctl restart cc-sidecar
TOK=$(sudo grep -oP '(?<=^CC_SIDECAR_TOKEN=).*' /etc/cc-sidecar.env)
curl -sN -H "x-cc-token: $TOK" -H 'content-type: application/json' \
  -d '{"prompt":"reply with exactly: PONG"}' http://172.17.0.1:8129/query
```

A logged-out sidecar answers `{"type":"text","text":"Not logged in · Please run
/login"}` and then a `done` — it is a clean per-request failure, not a crash, so
the page degrades rather than 500s.

**Re-login after that is normally done from the Exec panel, not here**
(`login.mjs`). A signed-out turn ends with a sign-in link. Approve it, paste
the code back into the panel, and the sidecar finishes `claude auth login`
itself. ARCHITECTURE.md S-2.

## Endpoints (bridge-only, `x-cc-token` required)

`/health`, `/query`, `/interrupt`, `/new`, `/history`, `/sessions`, `/resume`,
`/title`, `/title-gen`, `/limits` — the table is ARCHITECTURE.md S-1. The
sidecar owns which conversation is current (`~cc-agent/.cc-session`); `/query`
takes no session id.

## Limits

`MAX_CONCURRENT` is 1. That is a memory ceiling expressed as a queue depth: the
droplet has ~930MB free and each run spawns a CLI subprocess, so the unit also
carries `MemoryMax=700M`. A second concurrent request gets a 429; exec-fn's `cc_client.py` polls and waits up to `CC_BUSY_WAIT` (300 s) for the slot, and only a slot held past that surfaces as a "busy" frame.

Subscription rate limits are **per account** — wrapper traffic shares the same
budget as interactive `claude` sessions on this box.

## Ops

```bash
sudo systemctl status cc-sidecar
sudo journalctl -u cc-sidecar -f
sudo systemctl restart cc-sidecar        # after setup.sh has copied a changed server.mjs
```

`setup.sh` copies every module into `/srv/cc-agent`; editing the repo copy alone
changes nothing until you re-run it (then restart the unit). Tests:
`node --test *.test.mjs` (never a bare directory).

## The persona

`cc-context.md` is the second half of the system prompt — who Wai is, how she
wants to be spoken to. `server.mjs` holds the operating rules; this holds the
person, so changing her context is not a code change.

It is read **per run**, so an edit needs no restart — but it is read from
`/srv/cc-agent/`, so reinstall it:

```bash
sudo install -o root -g cc-agent -m 0640 claude-box/cc-context.md /srv/cc-agent/
```

Root-owned on purpose: the agent must not be able to rewrite its own
instructions the way it could a file in the sandbox.

It deliberately carries no repo or project detail: the sandbox is not a
checkout, so that would be tokens on every turn buying nothing. The personal
detail it does carry is safe only while the `/api/cc/*` routes stay owner-only — widening that
tier means pulling this file first. Docs: ARCHITECTURE.md, ARCHAEOLOGY.md, CLAUDE.md here.

Testing a prompt change costs a turn in the ONE live conversation, so park the
pointer rather than writing into it:

```bash
sudo mv /home/cc-agent/.cc-session /tmp/cc-session.bak   # test, then move it back
```

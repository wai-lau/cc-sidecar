/* The subscription's 5h / 7d windows — the numbers the CLI's own status line
 * shows, from the place the CLI gets them.
 *
 * The SDK does not carry them: `rate_limit_event` is declared in its .d.ts but
 * appears ZERO times in the shipped runtime (0.3.265), and nothing the CLI
 * writes to disk holds them either. What the CLI actually does is read
 * `anthropic-ratelimit-unified-*` response headers, and ask
 * `GET /api/oauth/usage` — both strings are in its binary. The endpoint is the
 * one reachable from outside a request, so that is what this uses.
 *
 * THE TOKEN NEVER LEAVES THIS PROCESS. cc-agent's own OAuth access token is
 * read here and exchanged for two percentages; the page is handed the
 * percentages. It is also never refreshed here -- two processes on one refresh
 * token race, which is the whole reason this account has its own login, so an
 * expired token degrades to "no numbers" and the CLI fixes it on its next run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const PREPAID_URL = (org) => `https://api.anthropic.com/api/oauth/organizations/${org}/prepaid/credits`;
const CREDS = path.join(os.homedir(), ".claude", ".credentials.json");
const ACCOUNT = path.join(os.homedir(), ".claude.json");
// The windows move in percent-points per hour, so a minute of staleness is
// invisible -- and this way a page left open all night is not a poller.
const TTL_MS = 60000;
const TIMEOUT_MS = 6000;

let cache = { at: 0, data: null };
// A refusal (429 above all) is remembered for a TTL too: the panel asks once a
// minute, and asking again straight after a 429 only extends it. Until then the
// last good numbers stand, else the failure.
let failed = { at: 0, data: null };

function token() {
  try {
    const raw = JSON.parse(fs.readFileSync(CREDS, "utf8"));
    return (raw.claudeAiOauth && raw.claudeAiOauth.accessToken) || null;
  } catch {
    return null;   // not logged in yet: no numbers, not an error
  }
}

function orgId() {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNT, "utf8"));
    return (raw.oauthAccount && raw.oauthAccount.organizationUuid) || null;
  } catch {
    return null;
  }
}

function amount(m) {
  return m && typeof m.amount_minor === "number" ? m.amount_minor / 10 ** (m.exponent ?? 2) : null;
}

/** Usage credits left, as the terminal status line words it (Wai's
 *  ~/.claude/statusline-command.sh): the prepaid balance, else the monthly
 *  limit less what is used, else what is used this month ("12.34used"). Null
 *  while credits are off. The page shows it only while a window is at 100%,
 *  i.e. while the credits are what is being spent. */
export function creditsText(spend, balance) {
  if (!spend || !spend.enabled) return null;
  const used = amount(spend.used) ?? 0;
  const bal = amount(balance && balance.money);
  if (bal) return bal.toFixed(2);
  const limit = amount(spend.limit);
  if (limit != null) return Math.max(0, limit - used).toFixed(2);
  return used.toFixed(2) + "used";
}

async function prepaidBalance(tok, signal) {
  const org = orgId();
  if (!org) return null;
  try {
    const r = await fetch(PREPAID_URL(org), { headers: authHeaders(tok), signal });
    return r.ok ? (await r.json()).balance || null : null;
  } catch {
    return null;
  }
}

function authHeaders(tok) {
  return {
    authorization: "Bearer " + tok,
    "anthropic-beta": "oauth-2025-04-20",
    accept: "application/json",
  };
}

/** One window, flattened to what a status line needs. */
function win(w) {
  if (!w || w.utilization == null) return null;
  const resets = w.resets_at ? Date.parse(w.resets_at) : null;
  return { pct: w.utilization, resetsAt: Number.isFinite(resets) ? Math.floor(resets / 1000) : null };
}

export async function usage() {
  if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;
  if (failed.data && Date.now() - failed.at < TTL_MS) return cache.data || failed.data;
  const tok = token();
  if (!tok) return { ok: false };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(USAGE_URL, { headers: authHeaders(tok), signal: ctl.signal });
    if (!r.ok) {
      failed = { at: Date.now(), data: { ok: false, status: r.status } };
      return cache.data || failed.data;
    }
    const j = await r.json();
    const data = {
      ok: true,
      five_hour: win(j.five_hour),
      seven_day: win(j.seven_day),
      seven_day_opus: win(j.seven_day_opus),
      // The balance is a second call, made only while credits are on.
      credits: creditsText(j.spend, j.spend && j.spend.enabled ? await prepaidBalance(tok, ctl.signal) : null),
    };
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return { ok: false };     // offline, slow, or refused: the bar just omits it
  } finally {
    clearTimeout(timer);
  }
}

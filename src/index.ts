interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * Was this failure OUR OWN web service? — the other half of `internal-db-class.ts`.
 *
 * fleet #1089 pulled failures from our own Postgres out of `upstream_down` by
 * keying on the SQLSTATE inside PostgREST's four-key error envelope. That
 * covered the majority and structurally could not cover the rest: the rest
 * never reach Postgres, so they carry no SQLSTATE. What was left, measured over
 * the 24h to 2026-09-02T15:00Z (fleet #1096):
 *
 *     5  pipeworx-catalog  get_pack_tools     Pipeworx catalog error: 522 — error code: 522
 *     3  fleet             fleet_list_open …  upstream_down: Fleet task queue did not respond within 25s
 *
 * 521/522/523/526 are Cloudflare saying its edge could not reach an ORIGIN, and
 * in both of those rows the origin is ours — `gateway.pipeworx.io` for the
 * catalog pack (it self-fetches when the gateway hasn't injected a manifest),
 * our own Supabase for fleet. There is no third party anywhere in either call.
 * Same defect as #1089: our own outage filed under `upstream_down`, the one
 * class that means "the source is unreachable and there is nothing for us to
 * fix", which is why the problem-tools triage skips it.
 *
 * WHY NOT A WORDING RULE. The obvious fix is to match `fleet db error:` and
 * `Pipeworx catalog error:` in classifyToolError. Each is emitted from exactly
 * one site today, so it would work today. It would also rot the first time
 * somebody rewords a label — silently, and in the direction of hiding our own
 * outage, which is worse than the bug being fixed. Every prose rule in
 * error-class.ts has needed widening as packs invented new wording (#409/#450/
 * #584); that history is most of that file's comment budget.
 *
 * WHAT THIS KEYS ON INSTEAD: **the host the call actually reached.** A URL's
 * hostname is a fact about the call, not a guess about its prose. Two
 * consequences that a pack-level flag could not give us, and the reason the
 * flag was rejected:
 *
 *   - It describes the CALL, not the pack. `govcon-intel` fans out to our own
 *     Supabase AND to genuine third parties; `court-listener` holds our cache
 *     in Supabase and fetches courtlistener.com. An `internallyHosted: true` on
 *     either pack would relabel a real third-party outage as ours — inventing
 *     work, which is the same class of error in the opposite direction.
 *   - It covers every future internal pack for free, instead of one declared
 *     slug at a time.
 *
 * WHY IT SURVIVES A REWORD. The marker below is not matched as a literal by two
 * separate files. `markInternalOrigin()` writes it and `internalHostMetricsClass()`
 * reads it, both from the single exported `INTERNAL_ORIGIN_MARKER` constant in
 * this module — so changing the wording changes both sides in the same edit and
 * cannot desynchronise them. The pack's own label (`fleet db error:`,
 * `Pipeworx catalog error:`) is not read at all: reword it freely, the class is
 * unaffected. That is the property `stripClassPrefix` lacked when it drifted
 * from its own classifier three times and needed a CI gate to hold them
 * together.
 *
 * WHERE THE 5xx TEST LIVES. `markInternalOrigin` is called from the places that
 * hold the real `Response` — `httpError`/`httpErrorMessage` and the timeout
 * branch of `fetchWithTimeout` in `shared/src/http.ts` — so "is this an
 * availability failure" is decided from the actual status code, never re-derived
 * by scraping a number out of a sentence. A 404 from our own registry for a slug
 * that does not exist is a caller's bad argument and is deliberately NOT marked.
 */

/**
 * OUR OWN web service was unreachable — not an upstream, and never `upstream_down`.
 *
 * ONE value, not three, unlike `internal_db_*`. That split existed because a
 * slow query, an exhausted pool and an unknown SQLSTATE have different owners
 * and different fixes. Here there is only one story to tell — an origin we run
 * did not answer the edge — and one owner. A bucket with no distinct owner per
 * value is decoration; #724 is what happens when a class holds several
 * situations, and inventing sub-values ahead of a reason to act on them
 * differently is the same mistake with the sign flipped.
 *
 * METRICS ONLY, exactly like PLATFORM_KEY_ERROR_CLASS and the internal_db
 * values. `classifyToolError` still answers `upstream_down` for the retry and
 * hint paths, which only care whether retrying or a sibling tool might work —
 * and it might. Nothing a caller sees or is charged changes here.
 *
 * READ SIDE: this value is in BROKEN_TOOL_CLASSES, FAULT_CLASSES and
 * ALL_ERROR_CLASSES in `workers/registry-api/src/index.ts`. All three, or it
 * lands on no dashboard — fleet #721 is the warning, where the #719 split
 * worked on the write side and was invisible for weeks.
 */
const INTERNAL_SERVICE_UNREACHABLE_CLASS = 'internal_service_unreachable';

/**
 * The token that carries "this origin is ours" from the call site to the
 * classifier.
 *
 * Appended to the error message rather than attached to the Error object,
 * because the object does not survive the trip: 275 packs return `{ error:
 * string }` instead of throwing, the gateway reads `observedError` as a string,
 * and the fleet pack rebuilds its error from a captured status + body across a
 * retry loop. A property on an Error would be dropped by every one of those
 * paths and the class would work in tests and vanish in production.
 *
 * WORDING IS LOAD-BEARING, same rule as labelAge's note in authority.ts. This
 * string is appended to a pack's thrown Error message (shared/src/http.ts),
 * and a thrown Error's message is exactly what the gateway hands back to the
 * caller as `content[0].text` when nothing rewrites it (workers/gateway/src
 * catches the throw and sets `rawResult.message = stripClassPrefix(error)`,
 * which does not touch this suffix) — so the original wording,
 * " [pipeworx-hosted origin — our own service, not a third party]", was not a
 * theoretical leak: it shipped live on pipeworx-catalog's 522s, 7 times in 6
 * hours on 2026-09-02 (see tests/golden-internal-service.test.ts), verbatim
 * naming Pipeworx as the host. check:hosting-claims never caught it because it
 * did not scan shared/ at all (task #2009). Reworded to describe the
 * OBSERVATION (the origin did not answer) without a claim about who runs it —
 * the identical fix labelAge got: drop the possessive, keep the fact.
 */
const INTERNAL_ORIGIN_MARKER = ' [origin did not respond — retry before concluding the named source is down]';

/**
 * Supabase's data plane for a project is `<ref>.supabase.co`, where the ref is
 * exactly twenty lowercase letters (ours is `pqauisounztsgdgfkhke`).
 *
 * Matching the shape rather than listing the ref keeps this correct when we add
 * a project — `supabaseEnv` on a pack entry already points some packs at a
 * second one — while still excluding `status.supabase.co`, which is Supabase's
 * own status page and emphatically not our database. Verified 2026-09-02 by
 * `grep -rhoE '[a-z0-9-]+\.supabase\.(co|in)' mcps shared workers scripts`: the
 * only real project ref anywhere in the tree is ours, the rest are doc
 * placeholders (`abc`, `xyz`, `example`) which this pattern also excludes. Same
 * finding internal-db-class.ts relies on for the PostgREST envelope being ours
 * by construction.
 */
const SUPABASE_PROJECT_HOST = /^[a-z]{20}\.supabase\.(co|in)$/;

/**
 * Is this a host WE run?
 *
 * Deliberately NOT including `*.workers.dev`: plenty of third-party APIs are
 * hosted on workers.dev, so the suffix says where something runs and not who
 * owns it. Every internal call we actually make goes to a `pipeworx.io`
 * hostname or to our Supabase project, both of which are ownership facts.
 *
 * `workers/gateway/src/provenance.ts`'s `OUR_HOSTS` answers the same
 * question and DOES include `workers.dev` — a documented divergence
 * (task #2051), not a bug to converge. That list decides what a response may
 * cite as a data SOURCE, where a false negative (citing our own worker as an
 * external source) is the hosting-disclosure leak this whole file exists to
 * prevent, so it errs broad. This one decides who gets BLAMED for a 5xx in
 * outage metrics read by on-call, where a false positive (crediting our own
 * infra with a third party's outage) hides the real failure, so it errs
 * narrow. Same suffix, opposite direction, because they are never called for
 * the same reason.
 *
 * Returns false on anything unparseable rather than throwing — this runs inside
 * an error path, and an error path that can itself throw turns a diagnosable
 * failure into a mystery.
 */
function isPipeworxOrigin(url: string | URL | undefined | null): boolean {
  if (!url) return false;
  let host: string;
  try {
    host = new URL(url instanceof URL ? url.href : url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'pipeworx.io' || host.endsWith('.pipeworx.io')) return true;
  return SUPABASE_PROJECT_HOST.test(host);
}

/**
 * Append the marker when this failure was OUR origin failing to answer.
 *
 * `status` is the HTTP status when there is one, and omitted for a timeout —
 * where there is no response at all, and "the origin did not answer" is the
 * whole observation. Statuses below 500 are left alone: a 404 from our own
 * registry for a slug that does not exist is the caller's argument, not our
 * outage, and marking it would put ordinary 404s on the incident dashboard.
 *
 * Idempotent, so a message that is wrapped and re-marked on the way up (the
 * fleet pack's retry loop re-throws through two layers) carries the marker once.
 */
function markInternalOrigin(
  message: string,
  url: string | URL | undefined | null,
  status?: number,
): string {
  if (status !== undefined && status < 500) return message;
  if (!isPipeworxOrigin(url)) return message;
  if (message.includes(INTERNAL_ORIGIN_MARKER)) return message;
  return message + INTERNAL_ORIGIN_MARKER;
}

/**
 * Which blob4 value a failure from our own web services books as, or undefined
 * if this is not one.
 *
 * Ordered AFTER `internalDbMetricsClass` at the call site: a PostgREST envelope
 * from our own Supabase is a strictly more specific statement about the same
 * row (which of our services, and why), and the two cannot disagree about
 * whether the failure is ours.
 */
function internalHostMetricsClass(error: string): string | undefined {
  return error.includes(INTERNAL_ORIGIN_MARKER) ? INTERNAL_SERVICE_UNREACHABLE_CLASS : undefined;
}


/**
 * One place to turn a failed `fetch` into an error a caller can act on.
 *
 * Nearly every pack was written the same way:
 *
 *     if (!res.ok) throw new Error(`Unsplash: ${res.status}`);
 *
 * which discards the response body — and the body is usually where the upstream
 * says what was actually wrong ("**symbol** not found: GBP", "parameter `year`
 * out of range", "unknown taxonomy id"). The caller gets a number, cannot
 * self-correct, and retries the same broken call. A 2026-07-31 sweep found this
 * shape in 481 of 1,400 packs, 47 of them PLATFORM-keyed.
 *
 * It also hides bugs one level down. Two of the first three packs audited had a
 * second defect that only existed because of this line: unsplash's rate-limit
 * branch sat BELOW a catch-all and was unreachable, and bea-gov parsed
 * `BEAAPI.Error.APIErrorDescription` below a `!res.ok` throw that made the
 * parsing dead code for every non-200.
 *
 * DELIBERATELY NOT A CLASSIFIER. It does not add `user_error:` /
 * `upstream_down:` prefixes. Those decide which tier a failure lands in, and the
 * `error` tier is what the daily problem-tools list is built from — it means
 * "Pipeworx has a defect". A 400 is genuinely ambiguous: often a caller's bad
 * argument, but sometimes a query WE built wrong (ted-eu comma-joined its CPV
 * values into something TED rejected, and that bug was found only because it sat
 * in `error`). Blanket-classifying 400s as caller mistakes would have hidden it.
 * A pack that KNOWS which it is should keep saying so explicitly; this helper is
 * for the 481 that say nothing at all.
 */

/** Longest upstream explanation we'll pass through. Enough for a real message,
 *  short enough that an HTML page or a stack trace can't swamp the error. */

const MAX_DETAIL = 300;

/**
 * Default bound for `fetchWithTimeout` when a pack doesn't state its own.
 *
 * 25s mirrors the number `epo-ops` landed on after measuring the real failure:
 * a degraded upstream that doesn't error, it just never answers, and a Worker
 * sits in `await fetch()` until ITS OWN execution budget kills the request —
 * which can take minutes, not seconds (epo_ops_search_patents measured 4-8
 * MINUTE hangs before this existed). 25s is short enough that a caller gets a
 * fast, actionable error instead of holding the connection, and long enough
 * that it doesn't false-trip on a merely-slow-but-alive upstream.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 25_000;

/**
 * Read the body of a failed response and fold it into a throwable Error.
 *
 * Usage — note the `await`, which is the one thing that makes this a mechanical
 * change rather than a drop-in:
 *
 *     if (!res.ok) throw await httpError(res, 'Unsplash');
 *
 * Safe to call on any non-ok response: a body that is missing, empty, unreadable
 * or HTML degrades to exactly the old `Name: 404` string rather than throwing
 * something new from inside the error path.
 */
async function httpError(res: Response, name: string): Promise<Error> {
  return new Error(await httpErrorMessage(res, name));
}

/** The message text without constructing an Error — for packs that need to wrap
 *  it in their own envelope or add an explicit classification prefix. */
async function httpErrorMessage(res: Response, name: string): Promise<string> {
  // The one place a 5xx from a host WE run gets stamped as ours. `res.url` is
  // the URL the fetch actually resolved to (after redirects), so this is a fact
  // about the call rather than a guess from the `name` the pack passed in —
  // reword that label freely, the class does not move. See
  // internal-host-class.ts; no-op for every third-party upstream, which is why
  // this touches 481 packs' error text and changes none of it.
  return markInternalOrigin(
    `${name}: ${res.status}${detailSuffix(await readDetail(res))}`,
    res.url,
    res.status,
  );
}

/**
 * Just the upstream's own explanation — no name, no status.
 *
 * For a pack that has already said both in its own sentence. epo-ops reads
 * `EPO rejected this search as too large (HTTP 413) — ${httpErrorMessage(…)}`,
 * which rendered as `… (HTTP 413) — EPO: 413.` once the XML detail was being
 * dropped: the upstream named twice, the status twice, and the one thing EPO
 * actually said ("Not enough characters before truncation character") nowhere
 * (fleet #712). Returns '' when the body carries nothing readable, so a caller
 * can fall back to its own wording.
 */
async function upstreamDetail(res: Response): Promise<string> {
  return readDetail(res);
}

/**
 * Read a SUCCESSFUL response as JSON, failing loudly when it isn't JSON.
 *
 * `httpError` above only ever runs on `!res.ok`, which leaves the nastier half
 * of the problem unhandled: an upstream that answers **HTTP 200 with an HTML
 * page**. A bot wall, a login redirect, a maintenance interstitial and a CDN
 * error page are all 200s, so `res.ok` is true, and `res.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.
 *
 * That string is the problem. It names no upstream, carries no status, and
 * reads like a parser bug in Pipeworx — so it lands in the `error` tier, which
 * means "we have a defect", and the caller is told nothing they can act on.
 * data.govt.nz sat dead behind an Imperva challenge this way and every
 * status-code health check we own reported it green (7889a845). A zero-length
 * body has the same shape: `Unexpected end of JSON input`, seen this week on
 * uk-gazette (83% of external calls) and census.
 *
 * UNLIKE `httpError`, this one DOES classify, and the asymmetry is deliberate.
 * A 400 is genuinely ambiguous — often the caller's bad argument, sometimes a
 * query we built wrong — so blanket-classifying it would hide our own bugs.
 * There is no such ambiguity here: **no argument a caller can pass makes a JSON
 * API return an HTML page.** It is always the upstream, so `upstream_down:` is
 * a statement of fact rather than a guess, and it keeps these out of the
 * problem-tools list where they crowd out real defects.
 *
 *     const data = await parseJson<Feed>(res, 'UK Gazette');
 *
 * Call it only after the `!res.ok` check — on a failed response you want
 * `httpError`, which mines the body for the upstream's own explanation.
 */
async function parseJson<T>(res: Response, name: string): Promise<T> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    throw new Error(
      `upstream_down: ${name} returned a body that could not be read (HTTP ${res.status}). ` +
        'The connection most likely dropped mid-response; retrying is reasonable.',
    );
  }

  const type = res.headers.get('content-type') ?? 'no content-type';

  if (!raw.trim()) {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with an EMPTY body where JSON was expected (${type}). ` +
        'Nothing about the request can cause this — it is an upstream fault, and the same call may well work on retry.',
    );
  }

  // Checked before parsing rather than in the catch, because knowing it is
  // markup is what turns "we failed to parse something" into "they served a
  // web page" — the second is diagnosable, the first is not.
  const head = raw.slice(0, 200).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml')) {
    const kind = head.startsWith('<?xml') ? 'an XML document' : 'an HTML page';
    // The summary, not the source. Pasting the first 120 characters of a web
    // page handed the agent `<!DOCTYPE html><html lang="en"…` — the same leak
    // this branch exists to describe (fleet #712).
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with ${kind} instead of JSON (${type}). ` +
        'That is typically a bot wall, a login redirect or a maintenance page — it is returned as a SUCCESS, ' +
        `so status-code health checks read it as fine. No argument change will get past it. ` +
        `The page says: ${summarizeErrorBody(raw) || 'nothing readable'}`,
    );
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(
      `upstream_down: ${name} answered HTTP ${res.status} with a body that is not valid JSON (${type}). ` +
        `It begins: ${stripMarkup(raw).slice(0, 120) || '(unreadable)'}`,
    );
  }
}

/**
 * `fetch`, but bounded — the fix for a systemic gap found 2026-08-30: a grep
 * audit of every pack's `mcps/*\/src/index.ts` found 1,339 of ~1,500 call
 * `fetch()` with NO timeout guard anywhere in the file. Two of those
 * (epo-ops, statcan) were confirmed live-hanging for 4-8 minutes before this
 * existed — every unguarded call carries the same risk, just unconfirmed.
 *
 * Mirrors the `epoFetch` wrapper `mcps/epo-ops/src/index.ts` shipped first:
 * bound the request with `AbortSignal.timeout`, and on a timeout/abort throw
 * an `upstream_down:` error that names the upstream and the bound rather than
 * letting the raw `TimeoutError`/`AbortError` (which names neither) propagate.
 * `upstream_down:` is deliberate, same reasoning as `parseJson` above — no
 * argument a caller passes can make an upstream hang, so it is always the
 * upstream's fault, and marking it that way keeps a slow API off the
 * problem-tools list where it would crowd out our own defects.
 *
 * Usage — a mechanical swap for a bare `fetch(url, init)`:
 *
 *     const res = await fetchWithTimeout(url, init, 'Some API');
 *
 * Pass `timeoutMs` as a fourth argument to override the default for a pack
 * with a known-slower upstream; the label should be the same short name you'd
 * pass to `httpError`/`httpErrorMessage` for that call.
 */
async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  name: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      // States the OBSERVATION (no response in N seconds), not a diagnosis.
      // "appears to be degraded" is an inference about the vendor that we have
      // not checked, and it is wrong in a way that misdirects whoever reads it:
      // a timeout from a Worker can equally mean OUR egress is blocked.
      //
      // Measured today (2026-09-01, fleet #1047): every call to
      // mainnet.base.org failed from the x402 facilitator while the identical
      // request from a laptop returned 200. Base was entirely healthy; the
      // public RPC refuses Cloudflare Worker egress. Had this message fired
      // there it would have blamed Base by name, and the next person would have
      // waited for a vendor outage to clear that did not exist.
      // A timeout has no status to test — there is no response at all — so
      // `markInternalOrigin` is called without one: an origin we run that never
      // answered is an availability failure by definition. This is the half of
      // fleet #1096 with neither a SQLSTATE nor a status code to key on.
      throw new Error(
        markInternalOrigin(
          `upstream_down: ${name} did not respond within ${timeoutMs / 1000}s. ` +
            `That can be ${name} being slow or down, or this environment being unable to reach it ` +
            `(some hosts refuse datacenter/Worker egress) — retry shortly, and check reachability ` +
            `from elsewhere before concluding ${name} is down.`,
          url,
        ),
      );
    }
    throw err;
  }
}

function detailSuffix(detail: string): string {
  return detail ? ` — ${detail}` : '';
}

async function readDetail(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    // Body already consumed, or the connection died mid-read. The status alone
    // is still worth throwing — never let the error path throw its own error.
    return '';
  }
  return summarizeErrorBody(raw);
}

/**
 * Turn ANY error body — JSON, HTML, XML or plain text — into one short phrase
 * that never contains markup.
 *
 * This used to just drop an HTML or XML body on the floor, on the reasoning
 * that markup crowds out the status. That was half right. Dropping it loses the
 * one sentence a caller could have acted on: an `Access Denied` title, an SDMX
 * `<message:Error>` text, an OPS fault string. A 2026-08-30 support sweep
 * measured 13 of 291 caller-facing error rows carrying a raw page or document
 * verbatim, across 11 packs, and in every one of them the useful content —
 * "Access Denied", "Invalid country code", "SCRAPE_TIMEOUT" — was in there,
 * buried in markup the agent had to parse out of a string (fleet #712).
 *
 * So: extract the meaning, discard the markup. The output is passed through
 * `stripMarkup` unconditionally, which is what lets `check:error-body-leak`
 * assert mechanically that no caller-facing message can contain `<?xml`,
 * `<!DOCTYPE` or `<html`.
 */
function summarizeErrorBody(raw: string): string {
  if (!raw || !raw.trim()) return '';

  const head = raw.slice(0, 400).trimStart().toLowerCase();

  // An HTML error page (Cloudflare interstitial, nginx default, a login
  // redirect) says what it is in its <title>, and almost nowhere else.
  if (head.startsWith('<!doctype') || head.startsWith('<html')) {
    const title = htmlTitle(raw);
    return title
      ? `${title} (upstream returned an HTML error page, not an API response)`
      : 'upstream returned an HTML error page, not an API response';
  }

  // XML fault documents — EPO OPS, SDMX (`<message:Error>`), SOAP faults. The
  // human sentence sits in a child element whose tag name says what it is.
  if (head.startsWith('<?xml') || head.startsWith('<')) {
    const fault = xmlFaultText(raw);
    return fault
      ? `${stripMarkup(fault).slice(0, MAX_DETAIL)} (from the upstream's XML error document)`
      : 'upstream returned an XML error document with no readable message';
  }

  // Most JSON error bodies bury one human sentence among ids and echoed request
  // params. Prefer that sentence; fall back to the whole body when the shape is
  // unfamiliar, since an unfamiliar shape is exactly when we can least afford to
  // guess wrong and show nothing.
  const fromJson = messageFromJson(raw);
  return stripMarkup(fromJson ?? raw).slice(0, MAX_DETAIL);
}

/** The `<title>` of an HTML error page, or its first `<h1>` — the two places a
 *  bot wall, a 502 and an "Access Denied" all state what happened. */
function htmlTitle(raw: string): string | null {
  const head = raw.slice(0, 4000);
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(head);
    const text = m ? stripMarkup(m[1]) : '';
    if (text) return text.slice(0, 160);
  }
  return null;
}

/** Tag names that carry the explanation in an XML fault document, namespace
 *  prefix optional (`<message:Error>`, `<com:Text>`, `<faultstring>`). */
const XML_FAULT_TAG_RE =
  /<(?:[A-Za-z0-9_.-]+:)?(?:text|message|description|faultstring|reason|detail|title|errormessage|error)\b[^>]*>([^<]{2,400})</i;

function xmlFaultText(raw: string): string | null {
  const head = raw.slice(0, 8000);
  const tagged = XML_FAULT_TAG_RE.exec(head);
  if (tagged && tagged[1].trim()) return tagged[1];

  // Nothing conventionally named — take the longest text node instead. A fault
  // document with one sentence in an oddly named element is still readable;
  // returning nothing at all is not.
  let best = '';
  for (const m of head.matchAll(/>([^<>]{8,400})</g)) {
    const text = m[1].trim();
    if (text.length > best.length) best = text;
  }
  return best || null;
}

/**
 * Remove every tag and stray angle bracket, then collapse whitespace.
 *
 * Applied to everything on the way out, including the JSON and plain-text
 * paths, because an upstream is free to embed markup in a JSON string field —
 * and a leak is a leak regardless of which branch produced it.
 */
function stripMarkup(s: string): string {
  return collapse(decodeEntities$shared(s.replace(/<[^>]*>/g, ' ')).replace(/[<>]/g, ' '));
}

/** The handful of entities that show up in error-page titles. Decoded AFTER
 *  tags are stripped and BEFORE the angle-bracket sweep, so `&lt;script&gt;`
 *  in a title cannot decode into markup that survives — EMBL-EBI's ChEMBL 500
 *  page renders as `500 Internal Server Error &lt; EMBL-EBI` otherwise. */
function decodeEntities$shared(s: string): string {
  return s
    .replace(/&(?:amp|#0*38);/gi, '&')
    .replace(/&(?:lt|#0*60);/gi, '<')
    .replace(/&(?:gt|#0*62);/gi, '>')
    .replace(/&(?:quot|#0*34);/gi, '"')
    .replace(/&(?:#0*39|apos|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

/** The conventional "what went wrong" field, under any of the names upstreams
 *  actually use. Checked in order; first non-empty string wins. */
const MESSAGE_KEYS = [
  'message', 'error_message', 'errorMessage', 'detail', 'details',
  'description', 'error_description', 'reason', 'title', 'fault',
];

function messageFromJson(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return pickMessage(parsed, 0);
}

function pickMessage(node: unknown, depth: number): string | null {
  // Two levels covers `{error: {message}}` and `{errors: [{detail}]}`, the two
  // shapes that account for nearly all of them, without walking a large payload.
  if (depth > 2 || node == null) return null;

  if (typeof node === 'string') return node.trim() || null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = pickMessage(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;

  for (const key of MESSAGE_KEYS) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // `{error: …}` where error is itself an object or a string — the single most
  // common wrapper, so it is worth descending into by name rather than scanning
  // every key and risking picking up an echoed request parameter.
  for (const key of ['error', 'errors', 'fault', 'Error', 'data']) {
    if (key in obj) {
      const found = pickMessage(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** Errors are read in a single line of log output; newlines and runs of
 *  whitespace make a multi-line body unreadable there. */
function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
/**
 * EUR-Lex MCP — official EU law, article-level.
 *
 * Keyless. Two upstreams, both run by the EU Publications Office:
 *  - CELLAR content negotiation (publications.europa.eu/resource/celex/<CELEX>)
 *    returns the authentic XHTML of any act → article-level text + citations.
 *  - The CELLAR SPARQL endpoint (webapi/rdf/sparql) → search + metadata.
 *
 * Built for grounded compliance Q&A: resolve a regulation (GDPR, NIS2, DORA,
 * the EU AI Act, DSA/DMA, eIDAS, the Cyber Resilience Act …) to its CELEX id,
 * then quote a specific Article with a verifiable EUR-Lex citation URL.
 */


// Bound every fetch() in this pack to a fixed timeout — an upstream that
// degrades without erroring would otherwise hold the Worker in `await fetch()`
// until its own execution budget kills the request (minutes, not seconds).
// Mirrors the epoFetch / usaspending retryFetch pattern (fleet #685).
async function pwFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  return fetchWithTimeout(url, init ?? {}, 'EUR-Lex');
}

const CELLAR = 'http://publications.europa.eu/resource/celex';
const SPARQL = 'http://publications.europa.eu/webapi/rdf/sparql';
const RT = 'http://publications.europa.eu/resource/authority/resource-type';
const UA = 'pipeworx-mcp-eur-lex/1.0 (+https://pipeworx.io)';

/** Curated map of the EU digital/compliance corpus → CELEX. Lets an LLM resolve
 *  a common name to an id without knowing CELEX. Source of truth for aliases. */
const INDEX: Array<{
  alias: string;
  name: string;
  celex: string;
  type: string;
  date: string;
  summary: string;
}> = [
  { alias: 'GDPR', name: 'General Data Protection Regulation', celex: '32016R0679', type: 'Regulation', date: '2016-04-27', summary: 'EU-wide rules on processing of personal data and free movement of such data.' },
  { alias: 'NIS2', name: 'NIS2 Directive', celex: '32022L2555', type: 'Directive', date: '2022-12-14', summary: 'Measures for a high common level of cybersecurity across the Union; repeals NIS1.' },
  { alias: 'DORA', name: 'Digital Operational Resilience Act', celex: '32022R2554', type: 'Regulation', date: '2022-12-14', summary: 'Digital operational resilience for the financial sector (ICT risk, incident reporting, third-party risk).' },
  { alias: 'AI Act', name: 'Artificial Intelligence Act', celex: '32024R1689', type: 'Regulation', date: '2024-06-13', summary: 'Harmonised rules on artificial intelligence; risk-based obligations for AI systems and GPAI models.' },
  { alias: 'DSA', name: 'Digital Services Act', celex: '32022R2065', type: 'Regulation', date: '2022-10-19', summary: 'Single market for digital services; obligations for intermediaries and very large online platforms.' },
  { alias: 'DMA', name: 'Digital Markets Act', celex: '32022R1925', type: 'Regulation', date: '2022-09-14', summary: 'Contestable and fair markets in the digital sector; obligations for gatekeepers.' },
  { alias: 'eIDAS', name: 'eIDAS Regulation', celex: '32014R0910', type: 'Regulation', date: '2014-07-23', summary: 'Electronic identification and trust services for electronic transactions in the internal market.' },
  { alias: 'eIDAS 2.0', name: 'European Digital Identity Framework', celex: '32024R1183', type: 'Regulation', date: '2024-04-11', summary: 'Amends eIDAS to establish the European Digital Identity Wallet framework.' },
  { alias: 'Cyber Resilience Act', name: 'Cyber Resilience Act', celex: '32024R2847', type: 'Regulation', date: '2024-10-23', summary: 'Horizontal cybersecurity requirements for products with digital elements.' },
  { alias: 'Cybersecurity Act', name: 'Cybersecurity Act', celex: '32019R0881', type: 'Regulation', date: '2019-04-17', summary: 'ENISA mandate and an EU cybersecurity certification framework for ICT products/services.' },
  { alias: 'Data Act', name: 'Data Act', celex: '32023R2854', type: 'Regulation', date: '2023-12-13', summary: 'Harmonised rules on fair access to and use of data generated by connected products.' },
  { alias: 'Data Governance Act', name: 'Data Governance Act', celex: '32022R0868', type: 'Regulation', date: '2022-05-30', summary: 'Framework for data sharing, data intermediation services and data altruism.' },
  { alias: 'ePrivacy', name: 'ePrivacy Directive', celex: '32002L0058', type: 'Directive', date: '2002-07-12', summary: 'Privacy and electronic communications (cookies, confidentiality, traffic data).' },
  { alias: 'Machinery Regulation', name: 'Machinery Regulation', celex: '32023R1230', type: 'Regulation', date: '2023-06-14', summary: 'Health and safety requirements for machinery, including AI-related safety components.' },
];

const tools: McpToolExport['tools'] = [
  {
    name: 'compliance_index',
    description:
      'Resolve a common EU regulation name to its CELEX id. Returns the curated map of the EU digital/compliance corpus (GDPR, NIS2, DORA, AI Act, DSA, DMA, eIDAS, Cyber Resilience Act, Data Act, …) with CELEX ids, types, dates and one-line summaries. Use this first to turn a name like "GDPR" into the CELEX id the other tools need.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional filter — name/alias/keyword (e.g. "AI Act", "data"). Omit to list the whole corpus.' },
      },
    },
  },
  {
    name: 'search_legislation',
    description:
      'Full-text search of EU legislation titles via the EUR-Lex SPARQL endpoint. Returns CELEX id, English title and document date. Use when the act is not in compliance_index, or to find related/amending acts.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Keyword(s) that must appear in the English title, e.g. "cybersecurity certification".' },
        type: { type: 'string', enum: ['regulation', 'directive', 'decision'], description: 'Optional: restrict to a legal act type.' },
        limit: { type: 'number', description: 'Max results (default 10, max 25).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_metadata',
    description:
      'Fetch title, document date, legal type, in-force status hint, and EUR-Lex citation URL for one EU act by CELEX id (e.g. "32016R0679") or alias (e.g. "GDPR"); does not download full text.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        celex: { type: 'string', description: 'CELEX id, e.g. "32016R0679", or a known alias like "GDPR".' },
        lang: { type: 'string', description: 'ISO 639-2/B language code for the title (default "eng": eng, fra, deu, spa, ita, …).' },
      },
      required: ['celex'],
    },
  },
  {
    name: 'list_articles',
    description:
      'Table of contents for an act: every Article number and its heading. Use to discover which Article to quote before calling get_article.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        celex: { type: 'string', description: 'CELEX id or a known alias (e.g. "DORA").' },
        lang: { type: 'string', description: 'ISO 639-2/B language code (default "eng").' },
      },
      required: ['celex'],
    },
  },
  {
    name: 'get_article',
    description:
      'Full text of one or more Articles of an act, with a verifiable EUR-Lex citation URL for each. THE article-level grounding tool: quote GDPR Art. 17, AI Act Art. 6, etc. Accepts a single number ("17"), a comma list ("5,6,17") or a range ("5-9").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        celex: { type: 'string', description: 'CELEX id or a known alias (e.g. "GDPR").' },
        article: { type: 'string', description: 'Article selector: "17", "5,6,17", or "5-9". Suffixed numbers like "9a" are supported.' },
        lang: { type: 'string', description: 'ISO 639-2/B language code (default "eng").' },
      },
      required: ['celex', 'article'],
    },
  },
  {
    name: 'get_document',
    description:
      'Plain-text of a whole act (recitals + enacting terms), paged. Use for short acts or to read recitals/definitions; for a specific Article prefer get_article. Returns up to max_chars from offset.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        celex: { type: 'string', description: 'CELEX id or a known alias.' },
        lang: { type: 'string', description: 'ISO 639-2/B language code (default "eng").' },
        max_chars: { type: 'number', description: 'Max characters to return (default 8000, max 40000).' },
        offset: { type: 'number', description: 'Character offset to start from, for paging (default 0).' },
      },
      required: ['celex'],
    },
  },
  {
    name: 'cjeu_search',
    description:
      'Search EU COURT JUDGMENTS — the case law of the Court of Justice (CJEU) and the General Court — by subject. Returns the case, the court, the date and the CELEX id to read it with. Use for "what has the CJEU said about data protection", "EU court rulings on gatekeepers", or to find the judgment interpreting a Regulation. This is case law; search_legislation covers the Regulations and Directives themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words appearing in the case title, e.g. "data protection", "state aid", "trade mark".' },
        court: { type: 'string', description: 'Limit to a court: "cjeu" (Court of Justice) or "general" (General Court). Default: both.' },
        include_notices: { type: 'boolean', description: 'Include short Official Journal notices about judgments as well as the judgments themselves (default false).' },
        limit: { type: 'number', description: 'Maximum results (1-25, default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'cjeu_judgment',
    description:
      'Get the FULL TEXT of an EU court judgment from its case number — "C-97/23", "T-144/25" — or its CELEX id. Resolves the case number people actually cite into the document. Use after cjeu_search, or whenever a case number appears in a filing or article.',
    inputSchema: {
      type: 'object',
      properties: {
        case_number: { type: 'string', description: 'As cited, e.g. "C-97/23" (Court of Justice) or "T-144/25" (General Court). A CELEX id like "62023CJ0097" also works.' },
        max_chars: { type: 'number', description: 'Max characters to return (default 12000, max 40000).' },
        offset: { type: 'number', description: 'Character offset, for paging through a long judgment (default 0).' },
      },
      required: ['case_number'],
    },
  },
];

/* ---------- helpers ---------- */

function resolveCelex(input: string): string {
  const raw = String(input ?? '').trim();
  const hit = INDEX.find(
    (e) => e.alias.toLowerCase() === raw.toLowerCase() || e.name.toLowerCase() === raw.toLowerCase(),
  );
  if (hit) return hit.celex;
  return raw.toUpperCase().replace(/\s+/g, '');
}

function langCode(input: unknown): string {
  const l = String(input ?? 'eng').trim().toLowerCase();
  return /^[a-z]{3}$/.test(l) ? l : 'eng';
}

function celexUrl(celex: string, anchor?: string): string {
  const base = `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${celex}`;
  return anchor ? `${base}#${anchor}` : base;
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&mdash;': '—', '&ndash;': '–', '&laquo;': '«', '&raquo;': '»',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m] ?? m);
}

/** Convert a slice of EUR-Lex XHTML to readable plain text. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
      .replace(/<\/td>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n'),
  ).trim();
}

// Bounded module-level cache so list→get on the same act doesn't refetch ~800KB.
const docCache = new Map<string, string>();

async function fetchDocument(celex: string, lang: string): Promise<string> {
  const key = `${celex}:${lang}`;
  const cached = docCache.get(key);
  if (cached) return cached;
  const res = await pwFetch(`${CELLAR}/${celex}`, {
    headers: { Accept: 'application/xhtml+xml', 'Accept-Language': lang, 'User-Agent': UA },
  });
  if (res.status === 404) throw new Error(`EUR-Lex: no document for CELEX ${celex} (lang ${lang}). Check the id with search_legislation.`);
  if (!res.ok) throw new Error(`EUR-Lex CELLAR: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const html = await res.text();
  if (docCache.size > 4) docCache.clear();
  docCache.set(key, html);
  return html;
}

/** Index article divs by their start offset. Matches id="art_<n>" exactly,
 *  excluding the sub-anchors like id="art_5.tit_1". `start` points just past
 *  the enclosing tag's `>` so a slice never carries a dangling attribute. */
function articleSpans(html: string): Array<{ num: string; start: number }> {
  const re = /id="art_([0-9]+[a-z]*)"/gi;
  const spans: Array<{ num: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const gt = html.indexOf('>', m.index);
    spans.push({ num: m[1], start: gt === -1 ? m.index : gt + 1 });
  }
  return spans;
}

function articleTitle(block: string): string {
  const m = block.match(/class="oj-sti-art"[^>]*>([\s\S]*?)<\/p>/i);
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : '';
}

function expandSelector(sel: string): string[] {
  const out: string[] = [];
  for (const part of String(sel).split(',').map((s) => s.trim()).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
      for (let i = a; i <= b && i - a < 50; i++) out.push(String(i));
    } else {
      out.push(part.toLowerCase());
    }
  }
  return [...new Set(out)];
}

/* ---------- CJEU case law (CELEX sector 6) ----------
 *
 * Case law lives in CELEX sector 6: 6 + year + a two-letter document code +
 * a four-digit number. The document code is what distinguishes a judgment
 * from the paperwork around it, and getting it wrong returns the wrong thing
 * rather than nothing:
 *
 *   62023CJ0097  the judgment itself
 *   62023CA0097  the Official Journal NOTICE about that judgment — a
 *                paragraph-long summary, not the ruling
 *
 * Both match a title search for the same case, so notices are filtered out by
 * default. A caller who asks for "the WhatsApp judgment" and silently gets a
 * summary has been given the wrong document with no way to tell.
 *
 * Separately, the SPARQL store returns some works twice: once bare and once
 * with a _RES suffix (the consolidated/"resource" expression). Same case, same
 * date, same title. Deduped on the base id.
 */
const DOC_TYPES: Record<string, { label: string; court: string; notice?: boolean }> = {
  CJ: { label: 'Judgment', court: 'Court of Justice' },
  CO: { label: 'Order', court: 'Court of Justice' },
  CC: { label: 'Advocate General opinion', court: 'Court of Justice' },
  CV: { label: 'Opinion of the Court', court: 'Court of Justice' },
  CA: { label: 'Official Journal notice', court: 'Court of Justice', notice: true },
  TJ: { label: 'Judgment', court: 'General Court' },
  TO: { label: 'Order', court: 'General Court' },
  TA: { label: 'Official Journal notice', court: 'General Court', notice: true },
  FJ: { label: 'Judgment', court: 'Civil Service Tribunal' },
};

/** Split "6 2023 CJ 0097" out of a sector-6 CELEX id. */
function parseCaseCelex(celex: string): { year: string; code: string; num: string } | null {
  const m = /^6(\d{4})([A-Z]{2})(\d{4})/.exec(celex.toUpperCase());
  return m ? { year: m[1], code: m[2], num: m[3] } : null;
}

/**
 * Turn a cited case number into candidate CELEX ids.
 *
 * "C-97/23" is Court of Justice case 97 of 2023 -> 62023CJ0097. The year is
 * two digits in the citation, so 97/23 is 2023 while 6/64 is 1964: a two-digit
 * year above the current one must belong to the last century. Hard-coding a
 * "20" prefix would silently relocate every case decided before 2000.
 *
 * The document code is not recoverable from the citation — the same case
 * number is a judgment, an order or an AG opinion depending on what the court
 * produced — so candidates are returned in order and tried in turn.
 */
function celexCandidates(input: string): string[] {
  const raw = input.trim().toUpperCase().replace(/\s+/g, '');
  if (/^6\d{4}[A-Z]{2}\d{4}/.test(raw)) return [raw];

  const m = /^([CTF])[-‐-―]?(\d{1,4})\/(\d{2,4})/.exec(raw);
  if (!m) return [];
  const [, series, number, yr] = m;

  let year: number;
  if (yr.length === 4) {
    year = Number(yr);
  } else {
    const two = Number(yr);
    const currentTwo = new Date().getUTCFullYear() % 100;
    year = two > currentTwo ? 1900 + two : 2000 + two;
  }

  const codes = series === 'T' ? ['TJ', 'TO'] : series === 'F' ? ['FJ'] : ['CJ', 'CO', 'CC'];
  const num = number.padStart(4, '0');
  return codes.map((c) => `6${year}${c}${num}`);
}

async function sparql(query: string): Promise<any> {
  const res = await pwFetch(SPARQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
    body: new URLSearchParams({ query, format: 'application/sparql-results+json' }).toString(),
  });
  if (!res.ok) throw new Error(`EUR-Lex SPARQL: ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

/* ---------- tool dispatch ---------- */

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'compliance_index': {
      const q = String(args.query ?? '').trim().toLowerCase();
      const rows = q
        ? INDEX.filter((e) =>
            (e.alias + ' ' + e.name + ' ' + e.summary).toLowerCase().includes(q),
          )
        : INDEX;
      return {
        count: rows.length,
        regulations: rows.map((e) => ({ ...e, citation_url: celexUrl(e.celex) })),
        note: 'Pass a CELEX id (or these aliases) to get_article / list_articles / get_document.',
      };
    }

    case 'search_legislation': {
      const q = String(args.query ?? '').trim().toLowerCase().replace(/["\\]/g, '');
      if (!q) throw new Error('query is required.');
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      const typeMap: Record<string, string> = { regulation: 'REG', directive: 'DIR', decision: 'DEC' };
      const typeStr = typeMap[String(args.type ?? '').toLowerCase()];
      const typeFilter = typeStr ? `?w <http://publications.europa.eu/ontology/cdm#work_has_resource-type> <${RT}/${typeStr}> .` : '';
      const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?title ?date WHERE {
  ?w cdm:resource_legal_id_celex ?celex .
  ?expr cdm:expression_belongs_to_work ?w ;
        cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
        cdm:expression_title ?title .
  OPTIONAL { ?w cdm:work_date_document ?date . }
  ${typeFilter}
  FILTER(CONTAINS(LCASE(STR(?title)), "${q}"))
} ORDER BY DESC(?date) LIMIT ${limit}`;
      const json = await sparql(query);
      const results = (json?.results?.bindings ?? []).map((b: any) => ({
        celex: b.celex?.value,
        title: b.title?.value,
        date: b.date?.value ?? null,
        citation_url: celexUrl(b.celex?.value),
      }));
      return { query: q, count: results.length, results };
    }

    case 'get_metadata': {
      const celex = resolveCelex(String(args.celex ?? ''));
      const lang = langCode(args.lang);
      const res = await pwFetch(`${CELLAR}/${celex}`, {
        headers: { Accept: 'application/xml;notice=object', 'Accept-Language': lang, 'User-Agent': UA },
      });
      if (res.status === 404) throw new Error(`EUR-Lex: no act for CELEX ${celex}. Try search_legislation.`);
      if (!res.ok) throw new Error(`EUR-Lex: ${res.status} ${(await res.text()).slice(0, 160)}`);
      const xml = await res.text();
      const pick = (tag: string) => {
        const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
        return m ? decodeEntities(m[1].replace(/<[^>]+>/g, '').trim()) : null;
      };
      const indexed = INDEX.find((e) => e.celex === celex);
      return {
        celex,
        title: pick('EXPRESSION_TITLE') ?? pick('TITLE') ?? indexed?.name ?? null,
        date_document: pick('WORK_DATE_DOCUMENT') ?? indexed?.date ?? null,
        type: indexed?.type ?? pick('WORK_HAS_RESOURCE-TYPE') ?? null,
        alias: indexed?.alias ?? null,
        summary: indexed?.summary ?? null,
        citation_url: celexUrl(celex),
      };
    }

    case 'list_articles': {
      const celex = resolveCelex(String(args.celex ?? ''));
      const lang = langCode(args.lang);
      const html = await fetchDocument(celex, lang);
      const spans = articleSpans(html);
      const articles = spans.map((s, i) => {
        const block = html.slice(s.start, spans[i + 1]?.start ?? html.length);
        return { article: s.num, heading: articleTitle(block), citation_url: celexUrl(celex, `art_${s.num}`) };
      });
      if (!articles.length) throw new Error(`EUR-Lex: no Articles parsed for CELEX ${celex} — the act may have a non-standard structure or wrong id.`);
      return { celex, count: articles.length, articles };
    }

    case 'get_article': {
      const celex = resolveCelex(String(args.celex ?? ''));
      const lang = langCode(args.lang);
      const wanted = expandSelector(String(args.article ?? ''));
      if (!wanted.length) throw new Error('article is required, e.g. "17", "5,6,17" or "5-9".');
      const html = await fetchDocument(celex, lang);
      const spans = articleSpans(html);
      const byNum = new Map(spans.map((s, i) => [s.num.toLowerCase(), { ...s, end: spans[i + 1]?.start ?? html.length }]));
      const articles = wanted.map((num) => {
        const span = byNum.get(num);
        if (!span) return { article: num, found: false, text: null, heading: null, citation_url: celexUrl(celex, `art_${num}`) };
        const block = html.slice(span.start, span.end);
        return {
          article: num,
          found: true,
          heading: articleTitle(block),
          text: htmlToText(block),
          citation_url: celexUrl(celex, `art_${num}`),
        };
      });
      return { celex, requested: wanted, articles };
    }

    case 'get_document': {
      const celex = resolveCelex(String(args.celex ?? ''));
      const lang = langCode(args.lang);
      const maxChars = Math.min(Math.max(Number(args.max_chars) || 8000, 500), 40000);
      const offset = Math.max(Number(args.offset) || 0, 0);
      const html = await fetchDocument(celex, lang);
      // Strip the masthead/script noise, keep the enacting body.
      const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
      const text = htmlToText(body);
      const slice = text.slice(offset, offset + maxChars);
      return {
        celex,
        total_chars: text.length,
        offset,
        returned_chars: slice.length,
        has_more: offset + maxChars < text.length,
        next_offset: offset + maxChars < text.length ? offset + maxChars : null,
        citation_url: celexUrl(celex),
        text: slice,
      };
    }

    case 'cjeu_search': {
      const q = String(args.query ?? '').trim().toLowerCase().replace(/["\\]/g, '');
      if (!q) throw new Error('query is required.');
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
      const includeNotices = args.include_notices === true;
      const court = String(args.court ?? '').trim().toLowerCase();

      // Over-fetch: _RES duplicates and filtered-out notices both consume rows
      // before the caller's limit is applied, so asking for exactly `limit`
      // would quietly under-deliver.
      const query = `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?celex ?title ?date WHERE {
  ?w cdm:resource_legal_id_celex ?celex .
  ?expr cdm:expression_belongs_to_work ?w ;
        cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/ENG> ;
        cdm:expression_title ?title .
  OPTIONAL { ?w cdm:work_date_document ?date . }
  FILTER(STRSTARTS(STR(?celex), "6"))
  FILTER(CONTAINS(LCASE(STR(?title)), "${q}"))
} ORDER BY DESC(?date) LIMIT ${limit * 6}`;
      const json = await sparql(query);

      const seen = new Set<string>();
      const rows: any[] = [];
      for (const b of json?.results?.bindings ?? []) {
        const celexRaw: string = b.celex?.value ?? '';
        const base = celexRaw.replace(/_RES$/, '');
        if (seen.has(base)) continue;
        const parsed = parseCaseCelex(base);
        if (!parsed) continue;
        const meta = DOC_TYPES[parsed.code];
        if (!meta) continue;
        if (meta.notice && !includeNotices) continue;
        if (court === 'cjeu' && meta.court !== 'Court of Justice') continue;
        if (court === 'general' && meta.court !== 'General Court') continue;
        seen.add(base);

        // Titles arrive as "Judgment of the Court...#Party v Party#..." — the
        // hash-separated segments are distinct fields glued together upstream.
        const parts = String(b.title?.value ?? '').split('#').map((s) => s.trim()).filter(Boolean);
        rows.push({
          celex: base,
          case_name: parts[1] ?? parts[0] ?? null,
          description: parts[0] ?? null,
          document_type: meta.label,
          court: meta.court,
          date: b.date?.value ?? null,
          is_official_journal_notice: meta.notice === true,
          citation_url: celexUrl(base),
          read_with: `cjeu_judgment({case_number: "${base}"})`,
        });
        if (rows.length >= limit) break;
      }

      return {
        query: q,
        count: rows.length,
        results: rows,
        ...(rows.length === 0
          ? { note: 'No case law matched. cjeu_search matches words in the case TITLE, which for CJEU judgments names the parties and the subject — try a broader term, or search_legislation if you want the Regulation rather than a ruling on it.' }
          : {}),
        note: 'Official Journal notices (CELEX ...CA.../...TA...) are short summaries of a judgment, not the ruling; they are excluded unless include_notices is true.',
        source: 'EU Publications Office SPARQL endpoint (CELEX sector 6)',
      };
    }

    case 'cjeu_judgment': {
      const input = String(args.case_number ?? '').trim();
      const candidates = celexCandidates(input);
      if (!candidates.length) {
        return {
          found: false,
          reason: 'unparsed_case_number',
          message: `"${input}" is not a recognisable EU case number or CELEX id.`,
          hint: 'Cite it as the court does: "C-97/23" for the Court of Justice, "T-144/25" for the General Court. A CELEX id like "62023CJ0097" also works.',
        };
      }
      const maxChars = Math.min(Math.max(Number(args.max_chars) || 12000, 500), 40000);
      const offset = Math.max(Number(args.offset) || 0, 0);

      // The citation does not say whether the case produced a judgment, an
      // order or an AG opinion, so the candidates are tried in turn.
      const tried: string[] = [];
      for (const celex of candidates) {
        tried.push(celex);
        let html: string;
        try {
          html = await fetchDocument(celex, 'eng');
        } catch {
          continue;
        }
        const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<script[\s\S]*?<\/script>/gi, '');
        const text = htmlToText(body);
        if (text.length < 200) continue;
        const parsed = parseCaseCelex(celex);
        const meta = parsed ? DOC_TYPES[parsed.code] : undefined;
        const slice = text.slice(offset, offset + maxChars);
        return {
          case_number: input,
          celex,
          document_type: meta?.label ?? null,
          court: meta?.court ?? null,
          total_chars: text.length,
          offset,
          returned_chars: slice.length,
          has_more: offset + maxChars < text.length,
          next_offset: offset + maxChars < text.length ? offset + maxChars : null,
          citation_url: celexUrl(celex),
          text: slice,
          // The candidates are tried judgment-first, so anything else means the
          // judgment had no English expression. Say so: an Advocate General's
          // opinion is persuasive, not binding, and a caller who asked for the
          // ruling must not mistake one for the other. Common in pre-1973 cases,
          // where English was not yet an official language and only some
          // documents were translated retrospectively.
          ...(meta && meta.label !== 'Judgment'
            ? {
                substituted: true,
                note: `No English text exists for the judgment in ${input}; this is the ${meta.label.toLowerCase()} instead. An Advocate General's opinion is a recommendation to the Court, not the Court's ruling.`,
              }
            : {}),
          source: 'EUR-Lex CELLAR, English expression',
        };
      }
      return {
        found: false,
        reason: 'not_found',
        case_number: input,
        tried,
        message: `No English text found for ${input}. Tried ${tried.join(', ')}.`,
        hint: 'Very recent cases can take weeks to appear in English, and not every case number has a published judgment. cjeu_search will show what exists.',
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

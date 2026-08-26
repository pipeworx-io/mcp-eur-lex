# EUR-Lex — EU legislation and Court of Justice case law

The Regulations and Directives themselves, article by article, plus the
judgments interpreting them.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Auth

None. Everything here is keyless.

## Two halves

**Legislation** — `compliance_index`, `search_legislation`, `get_metadata`,
`list_articles`, `get_article`, `get_document`. Named acts resolve by alias, so
`get_article({celex: "GDPR", article: "17"})` returns the right to erasure
without anyone knowing that GDPR is `32016R0679`.

**Case law** — `cjeu_search`, `cjeu_judgment`. The Court of Justice and the
General Court.

```
cjeu_search({query: "data protection"})
  → 62023CJ0097  Court of Justice  Judgment  2026-02-10
    WhatsApp Ireland Ltd v European Data Protection Board

cjeu_judgment({case_number: "C-97/23"})
  → 87,178 characters of the Grand Chamber judgment
```

## Caveats worth passing on

- **An Official Journal notice is not a judgment.** `62023CA0097` is a
  paragraph-long summary of the ruling in `62023CJ0097`. Both match a title
  search for the same case, so notices are excluded unless you pass
  `include_notices: true`.
- **A case number does not say what the court produced.** "C-97/23" might be a
  judgment, an order, or an Advocate General's opinion. `cjeu_judgment` tries
  them in that order, and if it ends up returning something other than the
  judgment it sets `substituted: true` and says so — an AG's opinion is a
  recommendation to the Court, not the Court's ruling.
- **Old cases may have no English judgment.** English became an EU language in
  1973, so for a 1964 case the judgment often has no English expression even
  though a later-translated AG opinion does. That is the main way
  `substituted` shows up in practice.
- **Two-digit years mean what the court means.** `6/64` is 1964 and `97/23` is
  2023; a two-digit year above the current one belongs to the last century.
- **Search matches the title, not the full text.** CJEU titles name the parties
  and the subject matter, which is usually enough — but a doctrine discussed
  only in the reasoning will not be found by title.

## Related

- `us-code`, `court-listener` — the US equivalents, statutes and case law
- `ted-eu` — EU public procurement notices

## Data sources

- EUR-Lex CELLAR (`publications.europa.eu`) — document text
- EU Publications Office SPARQL endpoint — search over CELEX metadata

© European Union, 1998–2026. Reuse authorised under the Commission's reuse
policy; EUR-Lex data is not covered by the Court's own copyright.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "eur-lex": {
      "url": "https://gateway.pipeworx.io/eur-lex/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/eur-lex/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Eur Lex data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

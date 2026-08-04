# mcp-eur-lex

EUR-Lex MCP — official EU law, article-level.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `compliance_index` | Resolve a common EU regulation name to its CELEX id. Returns the curated map of the EU digital/compliance corpus (GDPR, NIS2, DORA, AI Act, DSA, DMA, eIDAS, Cyber Resilience Act, Data Act, …) with CELEX ids, types, dates and one-line summaries. Use this first to turn a name like "GDPR" into the CELEX id the other tools need. |
| `search_legislation` | Full-text search of EU legislation titles via the EUR-Lex SPARQL endpoint. Returns CELEX id, English title and document date. Use when the act is not in compliance_index, or to find related/amending acts. |
| `get_metadata` | Fetch title, document date, legal type, in-force status hint, and EUR-Lex citation URL for one EU act by CELEX id (e.g. "32016R0679") or alias (e.g. "GDPR"); does not download full text. |
| `list_articles` | Table of contents for an act: every Article number and its heading. Use to discover which Article to quote before calling get_article. |
| `get_article` | Full text of one or more Articles of an act, with a verifiable EUR-Lex citation URL for each. THE article-level grounding tool: quote GDPR Art. 17, AI Act Art. 6, etc. Accepts a single number ("17"), a comma list ("5,6,17") or a range ("5-9"). |
| `get_document` | Plain-text of a whole act (recitals + enacting terms), paged. Use for short acts or to read recitals/definitions; for a specific Article prefer get_article. Returns up to max_chars from offset. |

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

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Eur Lex data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

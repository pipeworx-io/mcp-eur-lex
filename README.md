# mcp-eur-lex

Official EU law, article-level: search EU legislation and quote GDPR, NIS2, DORA, the EU AI Act, DSA/DMA, eIDAS, the Cyber Resilience Act and the rest of the EU digital/compliance corpus with verifiable EUR-Lex citations. Keyless, via the EU Publications Office (CELLAR + SPARQL).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 882+ live data sources.

## Tools

| Tool | Description |
|------|-------------|

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

Or connect to the full Pipeworx gateway for access to all 882+ data sources:

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

- [All tools and guides](https://github.com/pipeworx-io/examples)
- [pipeworx.io](https://pipeworx.io)

## License

MIT

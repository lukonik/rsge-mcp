# Use @prefecthq/fastmcp-ts directly as the MCP framework

Rather than building on raw `@modelcontextprotocol/sdk` or maintaining an extra abstraction layer to stay framework-agnostic, we commit directly to `@prefecthq/fastmcp-ts` for server setup, tool/resource registration, and schema validation. This reduces boilerplate and lets us lean directly into FastMCP's ergonomics and capabilities (including MCP Apps if needed later).

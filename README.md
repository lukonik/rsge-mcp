# rsge-mcp

Local, single-Taxpayer Model Context Protocol (MCP) server over `stdio` for the Revenue Service of Georgia (RS.ge) electronic Waybill SOAP service (`WayBillService.asmx`), built with `@prefecthq/fastmcp-ts`.

- **Bilingual output:** ASCII English tool names and JSON keys; Georgian primary with English secondary across tool descriptions, confirmation summaries, and translated RS.ge errors.
- **Security-first writes:** Server-enforced two-step confirmation tokens ([ADR-0002](docs/adr/0002-two-step-confirmation-for-binding-writes.md)) protect every legally binding or destructive mutation.
- **Server-side math:** `save_waybill_draft` validates inputs with Zod and computes Line Item subtotals and `FULL_AMOUNT` using exact decimal arithmetic.
- **Stateless on disk:** Credentials are read exclusively from environment variables and redacted from all error responses and `stderr` logs.

Requires **Node.js >= 22**.

---

## 1. RS.ge Service User & IP Allowlisting Prerequisites

RS.ge requires programmatic `WayBillService` calls to authenticate with a dedicated **Service User** (`სერვისის მომხმარებელი`)—separate from your primary Taxpayer portal credentials—and enforces **outbound IP allowlisting** per Service User:

1. Sign in to the Taxpayer's RS.ge portal (`eservices.rs.ge`).
2. Create a **Service User** (`სერვისის მომხმარებელი`) with `WayBillService` permissions (usernames typically use the `username:TIN` format).
3. Add your machine's current public outbound IPv4 address to that Service User's **IP allowlist** in RS.ge settings.
   - If your ISP rotates your public IP or you switch networks/VPNs, RS.ge will reject requests (`connected: false`, `unId: -3`, or error `-100`) until the new IP is allowlisted.
4. After configuring your MCP client, run `check_connection` to verify both credentials and IP allowlisting.

---

## 2. Installation & Running

### Run directly with `npx`

```bash
RSGE_SERVICE_USER="your_user:206322102" \
RSGE_SERVICE_PASSWORD="your_service_password" \
npx -y rsge-mcp
```

### Build and run locally from source

```bash
pnpm install
pnpm build
RSGE_SERVICE_USER="your_user:206322102" \
RSGE_SERVICE_PASSWORD="your_service_password" \
node dist/cli.js
```

You can also install globally (`npm install -g rsge-mcp`) and invoke the `rsge-mcp` binary directly.

---

## 3. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `RSGE_SERVICE_USER` | Yes | — | RS.ge Service User username (for example `user:206322102`). |
| `RSGE_SERVICE_PASSWORD` | Yes | — | RS.ge Service User password. |
| `RSGE_ENDPOINT` | No | `https://services.rs.ge/WayBillService/WayBillService.asmx` | SOAP 1.1 endpoint URL (`http` or `https`). |
| `FASTMCP_LOG_LEVEL` | No | `info` | Structured JSON `stderr` log level (`debug`, `info`, `warn`, `error`, `silent`). `stdout` is strictly reserved for MCP JSON-RPC. |
| `RSGE_LIVE_TESTS` | Live tests only | unset | Set to `1` to opt into the live `services.rs.ge` Vitest integration suite. |
| `RSGE_LIVE_TEST_TIN` | Live tests only | `206322102` | Counterparty 9-digit or 11-digit TIN used by live `lookup_taxpayer` and Draft Waybill tests. |

---

## 4. MCP Client Configuration

All MCP clients launch `rsge-mcp` over `stdio` and pass credentials via `env`. Replace `"command": "npx", "args": ["-y", "rsge-mcp"]` with `"command": "node", "args": ["/absolute/path/to/rsge-mcp/dist/cli.js"]` if running from a local source build.

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "rsge": {
      "command": "npx",
      "args": ["-y", "rsge-mcp"],
      "env": {
        "RSGE_SERVICE_USER": "your_user:206322102",
        "RSGE_SERVICE_PASSWORD": "your_service_password"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "rsge": {
      "command": "npx",
      "args": ["-y", "rsge-mcp"],
      "env": {
        "RSGE_SERVICE_USER": "your_user:206322102",
        "RSGE_SERVICE_PASSWORD": "your_service_password"
      }
    }
  }
}
```

### Antigravity

Add to your Antigravity MCP servers configuration (`mcp_config.json` via **MCP Servers → Manage MCP Servers → View raw config**):

```json
{
  "mcpServers": {
    "rsge": {
      "command": "npx",
      "args": ["-y", "rsge-mcp"],
      "env": {
        "RSGE_SERVICE_USER": "your_user:206322102",
        "RSGE_SERVICE_PASSWORD": "your_service_password"
      }
    }
  }
}
```

---

## 5. MCP Tools & Resources

### MCP Tools (13)

| Tool | RS.ge SOAP Operation(s) | Guardrail | Purpose |
|---|---|---|---|
| `check_connection` | `chek_service_user` | Read-only | Verify Service User credentials and outbound IP allowlisting. |
| `get_reference_data` | `get_waybill_types`, `get_waybill_units`, `get_trans_types`, `get_error_codes` | Read-only | Session-cached fallback tool for MCP clients that do not read MCP Resources. |
| `lookup_taxpayer` | `get_name_from_tin`, `is_vat_payer_tin` | Read-only | Look up a counterparty Taxpayer's registered name and VAT payer status by 9-digit or 11-digit TIN. |
| `get_waybill` | `get_waybill`, `get_waybill_by_number` | Read-only | Fetch full details, Waybill Status, and Line Items for a single Waybill by ID or number. |
| `list_waybills` | `get_waybills`, `get_buyer_waybills` | Read-only | Query outgoing (Seller) or incoming (Buyer) Waybills by date range, Waybill Status, counterparty TIN, Waybill Type, and number. |
| `save_waybill_draft` | `save_waybill` | Direct write (Draft only) | Create or update an unactivated Draft Waybill (`STATUS=0`) with server-side Line Item arithmetic. |
| `send_waybill` | `send_waybill` | Two-step confirmation | Activate a Draft Waybill (`Active` / `1`) and assign an official RS.ge Waybill number. |
| `close_waybill` | `close_waybill` | Two-step confirmation | Complete an Active Waybill (`Completed` / `2`) to finalize goods delivery. |
| `delete_waybill_draft` | `del_waybill` | Two-step confirmation | Permanently delete an unactivated Draft Waybill (`Deleted` / `-1`). |
| `cancel_waybill` | `ref_waybill` | Two-step confirmation | Irreversibly cancel an Active Waybill (`Cancelled` / `-2`). |
| `confirm_waybill` | `confirm_waybill` | Two-step confirmation | Formally confirm an incoming Waybill as the Buyer (`1`). |
| `reject_waybill` | `reject_waybill` | Two-step confirmation | Formally reject an incoming Waybill as the Buyer (`-1`). |
| `create_waybill_invoice` | `save_invoice` | Two-step confirmation | Create a Waybill-linked Tax Invoice (`ანგარიშ-ფაქტურა`) as the Seller. |

### MCP Resources (4)

All Reference Data resources return `application/json` and share a single in-memory session cache with `get_reference_data`:

| Resource URI | RS.ge SOAP Operation | Contents |
|---|---|---|
| `rsge://reference/waybill-types` | `get_waybill_types` | Waybill Types (`ზედნადების ტიპები`) |
| `rsge://reference/units` | `get_waybill_units` | Measurement units (`ზომის ერთეულები`) for Line Items |
| `rsge://reference/transport-types` | `get_trans_types` | Transport Types (`ტრანსპორტირების ტიპები`) |
| `rsge://reference/error-codes` | `get_error_codes` | RS.ge error codes (`შეცდომის კოდები`) |

---

## 6. Two-Step Confirmation Safety Flow (ADR-0002)

Every legally binding or destructive mutation (`send_waybill`, `close_waybill`, `delete_waybill_draft`, `cancel_waybill`, `confirm_waybill`, `reject_waybill`, `create_waybill_invoice`) exposes `destructiveHint: true` and enforces a server-side two-step flow:

1. **Step 1 — Preview (no `confirmation_token`):**
   - Call the tool with `{ waybill_id }` only.
   - The server fetches the current Waybill via `get_waybill`, executes **no** RS.ge write operation, and returns `requiresConfirmation: true`, `executed: false`, a Georgian + English legal-effect summary (Waybill number/ID, Buyer/Seller TIN, total GEL amount, current Waybill Status), and an in-memory `confirmation_token`.
2. **Step 2 — Confirmed Execution (with `confirmation_token`):**
   - After explicit human approval, call the exact same tool with `{ waybill_id, confirmation_token }`.
   - Tokens are **single-use**, expire after **5 minutes**, and are bound to the **exact tool name** and **canonical SHA-256 hash of the arguments**. Replayed, expired, cross-tool, or modified-argument calls are rejected before contacting RS.ge.

Creating or editing an unactivated Draft Waybill via `save_waybill_draft` does not register a legally binding movement and executes directly without a confirmation token.

---

## 7. Testing

### Offline Test Suite (Default)

The default test suite runs strictly offline against recorded SOAP XML fixtures over the real MCP protocol boundary (no external network requests):

```bash
pnpm typecheck
pnpm build
pnpm test
```

`tests/live/**` is excluded by default in `vitest.config.ts` and additionally gated with `describe.skipIf(process.env.RSGE_LIVE_TESTS !== '1')`.

### Opt-In Live RS.ge Integration Suite (`RSGE_LIVE_TESTS=1`)

To verify end-to-end compatibility against real `services.rs.ge` SOAP XML responses using RS.ge test Service User credentials (from an IP-allowlisted machine):

```bash
RSGE_LIVE_TESTS=1 \
RSGE_SERVICE_USER="your_test_user:TIN" \
RSGE_SERVICE_PASSWORD="your_test_password" \
pnpm test:live
```

You can also run both offline and live suites together with `RSGE_LIVE_TESTS=1 pnpm test`, and optionally override `RSGE_LIVE_TEST_TIN` (default `206322102`) or `RSGE_ENDPOINT`.

The live suite verifies:
- `check_connection`
- All 4 Reference Data MCP Resources and `get_reference_data`
- `lookup_taxpayer`
- `list_waybills` (`outgoing` and `incoming`)
- Safe Draft Waybill lifecycle: `save_waybill_draft` → `get_waybill` → two-step `delete_waybill_draft` (with `finally` cleanup so no orphan Draft Waybills remain; never activates Waybills or issues Tax Invoices)

---

## 8. Domain Vocabulary & Architecture

- Canonical Georgian/English domain terms: [GLOSSARY.md](GLOSSARY.md)
- Architectural Decision Records: [docs/adr/](docs/adr/) (`0001`–`0004`)

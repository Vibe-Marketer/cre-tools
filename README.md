# cre-tools

Cross-platform installer for the **LoopNet** and **Reonomy** CRE CLI toolsets. One command installs four prebuilt Go binaries, wires them into Claude as MCP servers, and logs you into both services.

Works identically on **macOS, Linux, and Windows**.

---

## Install (recommended)

If Bun is not installed yet:

**macOS / Linux:**
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows (PowerShell):**
```powershell
irm https://bun.sh/install.ps1 | iex
```

Then install the CRE tools:

```bash
bun add -g github:Vibe-Marketer/cre-tools
cre setup
```

- `bun add -g` installs the wrapper commands. Bun may block package `postinstall` scripts by default, so the binaries also download lazily on first use.
- `cre setup` fetches the four binaries for your platform if needed, checks Chrome, logs you into LoopNet + Reonomy, wires the MCP servers, and verifies the connections.

## Install (no Node / no bun)

If you don't have Node or bun, use the self-contained installer scripts. They download the binaries directly, add them to your PATH, and run both logins.

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/Vibe-Marketer/cre-tools/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/Vibe-Marketer/cre-tools/main/install.ps1 | iex
```

These scripts install to `~/.local/bin` (macOS/Linux) or `%LOCALAPPDATA%\Programs\cre-tools` (Windows). They do **not** wire the MCP servers — install via bun/npm and run `cre mcp install` for that.

---

## Requirements

- **Google Chrome.** Both CLIs log in by driving a real Chrome window (via chromedp). Install it first: https://www.google.com/chrome
- **Your own paid LoopNet and Reonomy accounts.** This tool logs *you* into *your* accounts — it does not provide access.
- **Node 20+** for the bun/npm install path (global `fetch` and web-stream APIs). The standalone scripts need no Node.

---

## Re-authentication

Reonomy access tokens expire in **1–24 hours**. When Reonomy stops responding, refresh:

```bash
cre login
```

`cre login` re-runs both logins. LoopNet sessions last longer, but `cre login` refreshes both at once.

---

## Commands

| Command | What it does |
| --- | --- |
| `cre setup` | Verify Chrome → log into both → wire MCP → verify connections. The one command to run after install. |
| `cre login` | Re-run both logins. Use when a token expires. |
| `cre doctor` | Show a combined connection status for LoopNet + Reonomy. |
| `cre status` | Alias for `cre doctor`. |
| `cre mcp install` | (Re)wire the MCP servers into Claude Code + Claude Desktop. |
| `cre --version` | Print the installed version. |
| `cre help` | Show usage. |

The four native binaries are also exposed directly on your PATH after install: `loopnet-pp-cli`, `reonomy-pp-cli`, `loopnet-pp-mcp`, `reonomy-pp-mcp`.

---

## Where MCP configs are written

`cre setup` / `cre mcp install` merges two entries — `loopnet` and `reonomy` — into your existing config **without clobbering anything else**. Existing keys are preserved; a malformed config is backed up to `<file>.bak` before writing.

| Target | macOS / Linux | Windows |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` |

Claude Desktop is updated **only if it's already installed** (its config directory exists). The tool never creates Claude Desktop directories. Restart Claude after wiring to load the servers.

---

## For publishers: GitHub Release asset naming

The installer downloads **raw binaries** (not tar.gz/zip archives) as Release assets on `Vibe-Marketer/cre-tools`. The release tag must be `v<version>` matching `package.json` (currently `v0.1.0`).

**Canonical asset name:** `<tool>-pp-<kind>_<os>_<arch>[.exe]`

| Field | Allowed values |
| --- | --- |
| `tool` | `loopnet`, `reonomy` |
| `kind` | `cli`, `mcp` |
| `os` | `darwin`, `linux`, `windows` |
| `arch` | `amd64`, `arm64` |
| suffix | `.exe` on `windows` only |

Examples:

```
loopnet-pp-cli_darwin_arm64
loopnet-pp-mcp_linux_amd64
reonomy-pp-cli_darwin_amd64
reonomy-pp-mcp_windows_amd64.exe
```

A full release for one platform is four assets (cli + mcp × loopnet + reonomy). Upload assets for every platform you support; the installer requests only the four that match the user's `os`/`arch` and fails loudly with the exact missing URL if one is absent.

---

## Why plain Node, not TypeScript/bun

A `bun add -g github:...` / `npm i -g github:...` package must run on the end user's machine with **zero build step** across all three OSes. TypeScript would need a compile; bun-only APIs would break on plain Node. So this package is committed as plain CommonJS `.js` with **no dependencies** — Node built-ins only. (This is the one place the usual "TypeScript + bun" default doesn't apply.)

The binaries themselves are Go; this package only wraps and distributes them.

---

## Environment variables

- `CRE_TOOLS_SKIP_DOWNLOAD=1` — skip/prevent binary download during install or first use (CI/dev, or to install the wrapper before a release exists).
- `CRE_TOOLS_VERSION` — override the release tag the standalone `install.sh` / `install.ps1` scripts download from (defaults to `0.1.0`).

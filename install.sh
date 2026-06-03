#!/usr/bin/env bash
# cre-tools standalone installer (macOS / Linux) — LoopNet + Reonomy
# No Node required. Downloads prebuilt binaries from the GitHub Release.
# Usage:  curl -fsSL https://raw.githubusercontent.com/Vibe-Marketer/cre-tools/main/install.sh | bash
set -euo pipefail

REPO="Vibe-Marketer/cre-tools"
VERSION="${CRE_TOOLS_VERSION:-0.1.0}"
INSTALL_DIR="${HOME}/.local/bin"
BASE_URL="https://github.com/${REPO}/releases/download/v${VERSION}"

# --- Detect OS ----------------------------------------------------------------
OS_RAW="$(uname -s)"
case "$OS_RAW" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *) echo "cre-tools: unsupported OS \"$OS_RAW\" (use install.ps1 on Windows)." >&2; exit 1 ;;
esac

# --- Detect arch --------------------------------------------------------------
ARCH_RAW="$(uname -m)"
case "$ARCH_RAW" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="amd64" ;;
  *) echo "cre-tools: unsupported architecture \"$ARCH_RAW\"." >&2; exit 1 ;;
esac

echo "==> cre-tools installer"
echo "    Platform:  ${OS}_${ARCH}"
echo "    Release:   v${VERSION}"
echo "    Install to: ${INSTALL_DIR}"
echo ""

mkdir -p "$INSTALL_DIR"

# --- Download the four binaries ----------------------------------------------
BINARIES="loopnet-pp-cli loopnet-pp-mcp reonomy-pp-cli reonomy-pp-mcp"
echo "==> Downloading binaries..."
for name in $BINARIES; do
  asset="${name}_${OS}_${ARCH}"
  url="${BASE_URL}/${asset}"
  dest="${INSTALL_DIR}/${name}"
  printf '  ↓ %s ... ' "$asset"
  if ! curl -fSL --retry 2 -o "$dest" "$url"; then
    echo "FAILED"
    echo "cre-tools: download failed for ${url}" >&2
    echo "  If the release v${VERSION} does not exist yet, set CRE_TOOLS_VERSION to a published tag." >&2
    exit 1
  fi
  chmod +x "$dest"
  # macOS: strip the Gatekeeper quarantine flag so the binary runs without a prompt.
  if [ "$OS" = "darwin" ]; then
    xattr -d com.apple.quarantine "$dest" 2>/dev/null || true
  fi
  echo "done"
done

# --- PATH check ---------------------------------------------------------------
echo ""
echo "==> PATH check"
case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    echo "  ✓ ${INSTALL_DIR} is already on your PATH."
    ;;
  *)
    echo "  ! ${INSTALL_DIR} is not on your PATH yet. Add this line to your shell rc:"
    echo ""
    echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo ""
    echo "    Then open a new terminal (or 'source' your rc) before logging in."
    ;;
esac

# --- Auth logins --------------------------------------------------------------
echo ""
echo "==> Logging in to LoopNet + Reonomy"
echo "    (A Chrome window will open for each — log in normally; it captures automatically.)"
echo ""
echo "Opening Chrome for LoopNet..."
"${INSTALL_DIR}/loopnet-pp-cli" auth login || echo "  ! LoopNet login did not complete — re-run: loopnet-pp-cli auth login"
echo "Opening Chrome for Reonomy..."
"${INSTALL_DIR}/reonomy-pp-cli" auth login || echo "  ! Reonomy login did not complete — re-run: reonomy-pp-cli auth login"

echo ""
echo "═════════════════════════════════════════════════════════════"
echo "  ✓ cre-tools installed."
echo ""
echo "  Verify connections:  loopnet-pp-cli doctor  &&  reonomy-pp-cli doctor"
echo "  Re-auth (Reonomy expires in 1–24h):  reonomy-pp-cli auth login"
echo "═════════════════════════════════════════════════════════════"

#!/usr/bin/env bash
# Generates TSIG and RNDC keys for INFOdns.
# Run once before first `docker compose up`.
# Requires: bind9-utils (tsig-keygen, rndc-confgen) to be installed locally,
# OR run inside the bind9 Docker image:
#   docker run --rm -v $(pwd)/bind:/out internetsystemsconsortium/bind9:9.18 bash /out/../scripts/init-keys.sh

set -euo pipefail

BIND_DIR="$(cd "$(dirname "$0")/../bind" && pwd)"
KEYS_DIR="$BIND_DIR/keys"
mkdir -p "$KEYS_DIR"

# ── TSIG key (shared between primary and secondaries) ────────
if [[ -f "$KEYS_DIR/tsig.key" ]]; then
  echo "tsig.key already exists — skipping"
else
  echo "Generating TSIG key..."
  TSIG_SECRET=$(openssl rand -base64 32)
  cat > "$KEYS_DIR/tsig.key" <<EOF
key "tsig-secondary" {
	algorithm hmac-sha256;
	secret "$TSIG_SECRET";
};
EOF
  echo "Written: $KEYS_DIR/tsig.key"
fi

# ── RNDC key (used by Worker to issue rndc commands) ─────────
if [[ -f "$KEYS_DIR/rndc.key" ]]; then
  echo "rndc.key already exists — skipping"
else
  echo "Generating RNDC key..."
  RNDC_SECRET=$(openssl rand -base64 32)
  cat > "$KEYS_DIR/rndc.key" <<EOF
key "rndc-key" {
	algorithm hmac-sha256;
	secret "$RNDC_SECRET";
};
EOF
  echo "Written: $KEYS_DIR/rndc.key"
fi

echo ""
echo "Keys ready. Contents:"
echo ""
echo "=== tsig.key ==="
cat "$KEYS_DIR/tsig.key"
echo ""
echo "=== rndc.key ==="
cat "$KEYS_DIR/rndc.key"
echo ""
echo "IMPORTANT: Do NOT commit these files to version control."
echo "Add bind/tsig.key and bind/rndc.key to .gitignore."

#!/usr/bin/env bash
# Generates TSIG and RNDC keys for INFOdns.
# Run once before first `docker compose up`.
# Requires: bind9-utils (tsig-keygen, rndc-confgen) to be installed locally,
# OR run inside the bind9 Docker image:
#   docker run --rm -v $(pwd)/bind:/out internetsystemsconsortium/bind9:9.18 bash /out/../scripts/init-keys.sh

set -euo pipefail

BIND_DIR="$(cd "$(dirname "$0")/../bind" && pwd)"

# ── TSIG key (shared between primary and secondaries) ────────
if [[ -f "$BIND_DIR/tsig.key" ]]; then
  echo "tsig.key already exists — skipping"
else
  echo "Generating TSIG key..."
  tsig-keygen -a hmac-sha256 tsig-secondary > "$BIND_DIR/tsig.key"
  echo "Written: $BIND_DIR/tsig.key"
fi

# ── RNDC key (used by Worker to issue rndc commands) ─────────
if [[ -f "$BIND_DIR/rndc.key" ]]; then
  echo "rndc.key already exists — skipping"
else
  echo "Generating RNDC key..."
  RNDC_SECRET=$(openssl rand -base64 32)
  cat > "$BIND_DIR/rndc.key" <<EOF
key "rndc-key" {
	algorithm hmac-sha256;
	secret "$RNDC_SECRET";
};
EOF
  echo "Written: $BIND_DIR/rndc.key"
fi

echo ""
echo "Keys ready. Contents:"
echo ""
echo "=== tsig.key ==="
cat "$BIND_DIR/tsig.key"
echo ""
echo "=== rndc.key ==="
cat "$BIND_DIR/rndc.key"
echo ""
echo "IMPORTANT: Do NOT commit these files to version control."
echo "Add bind/tsig.key and bind/rndc.key to .gitignore."

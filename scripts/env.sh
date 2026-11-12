#!/usr/bin/env bash
# Shared settings for the testnet scripts. Keys are read from ~/.near-credentials (never from the repo).
set -euo pipefail

export NET=testnet
export ROOT="${SOKONIPAY_CONTRACT:-sokonipay.testnet}"   # main contract + parent of all demo accounts
export TOKEN="susd.$ROOT"                                # demo NEP-141 stablecoin
export SHOP="mama-mboga.$ROOT"
export SUPPLIER="supplier.$ROOT"
export PARTNER="partner.$ROOT"                           # revenue-split recipient (internal balance only)
export ALICE="alice.$ROOT"
export BOB="bob.$ROOT"
export CAROL="carol.$ROOT"

SIGN="network-config $NET sign-with-legacy-keychain send"

usd() { echo "$(( $1 * 1000000 ))"; }                    # whole sUSD -> 6-decimal units

# call <contract> <method> <json-args> <signer> [deposit]   (full-access key from the keychain)
call() {
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '100 Tgas' attached-deposit "${5:-0 NEAR}" sign-as "$4" $SIGN 2>&1 | show_tx
}

# Agent keys are stored outside the repo.
export AGENT_KEYS="${AGENT_KEYS:-$HOME/.near-credentials/sokonipay-agents}"

# agent_call <contract> <method> <json-args> <signer>
# Signs with the signer's *function-call access key* (see add_agent_key). Such a key cannot attach a deposit.
agent_call() {
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas '100 Tgas' attached-deposit "${5:-0 NEAR}" sign-as "$4" network-config $NET \
    sign-with-access-key-file "$AGENT_KEYS/$4.json" send 2>&1 | show_tx || true
}

# add_agent_key <account> '<method1>, <method2>'
# Generates a keypair locally, saves it to $AGENT_KEYS, and registers only its public key onchain
# as a function-call key limited to those SokoniPay methods.
add_agent_key() {
  mkdir -p "$AGENT_KEYS"; chmod 700 "$AGENT_KEYS"
  if [ -f "$AGENT_KEYS/$1.json" ]; then echo "agent key for $1 already exists"; return; fi
  local pub
  pub=$(node "$(dirname "${BASH_SOURCE[0]}")/gen-key.cjs" "$1" "$AGENT_KEYS/$1.json")
  near account add-key "$1" grant-function-call-access --allowance '0.25 NEAR' \
    --contract-account-id "$ROOT" --function-names "$2" use-manually-provided-public-key "$pub" \
    network-config $NET sign-with-legacy-keychain send 2>&1 | show_tx || true
  echo "agent key for $1: $pub  (methods: $2)"
}

view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" network-config $NET now 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' | sed -n '/^[[{"0-9tfn]/,$p' \
    | grep -vE '^(Here is|To update|`near` CLI)|^ +/|near contract call-function' | sed '/^$/d'
}

# Keep the outcome and the explorer link, drop the CLI chatter.
show_tx() {
  grep -E "Transaction ID|explorer|Error|error|panicked|Smart contract panicked|Failed|failed|succeeded" \
    | sed 's/\x1b\[[0-9;]*m//g; s/^[│ ]*//' | sort -u || true
}

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

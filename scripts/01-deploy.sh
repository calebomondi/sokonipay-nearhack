#!/usr/bin/env bash
# Build both contracts and deploy them to testnet. Safe to re-run: existing accounts are kept.
source "$(dirname "$0")/env.sh"
cd "$(dirname "$0")/.."

step "Build"
(cd contract && cargo near build non-reproducible-wasm --no-abi)
(cd token && cargo near build non-reproducible-wasm --no-abi)
MAIN_WASM=target/near/sokonipay/sokonipay.wasm
TOKEN_WASM=target/near/susd_token/susd_token.wasm
ls -la $MAIN_WASM $TOKEN_WASM

exists() { near account view-account-summary "$1" network-config $NET now >/dev/null 2>&1; }
create() {  # create <account> <NEAR>
  if exists "$1"; then echo "$1 already exists"; else
    near account create-account fund-myself "$1" "$2 NEAR" autogenerate-new-keypair \
      save-to-legacy-keychain sign-as "$ROOT" $SIGN 2>&1 | show_tx
  fi
}

step "Accounts"
create "$TOKEN" 2.2
for a in "$SHOP" "$SUPPLIER" "$ALICE" "$BOB" "$CAROL"; do create "$a" 0.3; done

step "Deploy token -> $TOKEN"
if view "$TOKEN" ft_metadata '{}' | grep -q sUSD; then echo "token already initialised: redeploying code only"
  near contract deploy "$TOKEN" use-file $TOKEN_WASM without-init-call $SIGN 2>&1 | show_tx
else
  near contract deploy "$TOKEN" use-file $TOKEN_WASM with-init-call new json-args '{}' \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' $SIGN 2>&1 | show_tx
fi

step "Deploy SokoniPay -> $ROOT"
if view "$ROOT" get_config '{}' | grep -q "$TOKEN"; then echo "contract already initialised: redeploying code only"
  near contract deploy "$ROOT" use-file $MAIN_WASM without-init-call $SIGN 2>&1 | show_tx
else
  near contract deploy "$ROOT" use-file $MAIN_WASM with-init-call new \
    json-args "{\"owner\":\"$ROOT\",\"token\":\"$TOKEN\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' $SIGN 2>&1 | show_tx
fi

step "Config"
view "$ROOT" get_config '{}'
view "$TOKEN" ft_metadata '{}'

#!/usr/bin/env bash
# End-to-end testnet run of every SokoniPay flow, using near-cli-rs only (no app, no LLM).
# Each step prints the transaction's explorer link. Run scripts/01-deploy.sh first.
source "$(dirname "$0")/env.sh"

RUN="${RUN:-$(date +%s)}"          # suffix so invoice ids are unique per run
J() { printf '{"account_id":"%s"}' "$1"; }

if [ -z "${SKIP_SETUP:-}" ]; then   # SKIP_SETUP=1 re-runs only the payment flows (steps 5-10)
step "1. Merchants register (wallet key) and the owner verifies them"
call "$ROOT" register_merchant '{"name":"Mama Mboga Kitchen"}' "$SHOP" '1 yoctoNEAR'
call "$ROOT" register_merchant '{"name":"Wholesale Greens"}' "$SUPPLIER" '1 yoctoNEAR'
call "$ROOT" set_verified "{\"merchant\":\"$SHOP\",\"verified\":true}" "$ROOT"
call "$ROOT" set_verified "{\"merchant\":\"$SUPPLIER\",\"verified\":true}" "$ROOT"
echo "is_verified($SHOP) = $(view "$ROOT" is_verified "$(J "$SHOP")")"

step "2. Shop owner sets revenue sharing: 20% savings, 10% partner, rest stays with the shop"
call "$ROOT" set_revenue_split "{\"splits\":[{\"account_id\":\"savings.$SHOP\",\"bps\":2000},{\"account_id\":\"$PARTNER\",\"bps\":1000}]}" "$SHOP" '1 yoctoNEAR'

step "3. Customers mint demo sUSD, deposit 50 into SokoniPay, set limits 20 per payment / 40 per day"
for u in "$ALICE" "$BOB" "$CAROL"; do
  call "$TOKEN" mint "{\"account_id\":\"$u\",\"amount\":\"$(usd 50)\"}" "$u"
  call "$TOKEN" ft_transfer_call "{\"receiver_id\":\"$ROOT\",\"amount\":\"$(usd 50)\",\"msg\":\"deposit\"}" "$u" '1 yoctoNEAR'
  call "$ROOT" set_limits "{\"per_payment\":\"$(usd 20)\",\"per_day\":\"$(usd 40)\"}" "$u" '1 yoctoNEAR'
  echo "balance($u) = $(view "$ROOT" get_balance "$(J "$u")")"
done

step "4. Each customer authorises a Personal Agent key: pay_invoice + contribute only"
for u in "$ALICE" "$BOB" "$CAROL"; do add_agent_key "$u" 'pay_invoice, contribute'; done
step "   The shop authorises its Merchant Agent key: create_invoice, pay_invoice, redeem"
add_agent_key "$SHOP" 'create_invoice, pay_invoice, redeem'
add_agent_key "$SUPPLIER" 'create_invoice, redeem'
call "$ROOT" set_limits "{\"per_payment\":\"$(usd 10)\",\"per_day\":\"$(usd 30)\"}" "$SHOP" '1 yoctoNEAR'

fi

step "5. ORDER: Merchant Agent invoices 8 sUSD, Alice's agent pays -> receipt + revenue split"
agent_call "$ROOT" create_invoice "{\"id\":\"order-$RUN\",\"amount\":\"$(usd 8)\",\"items_hash\":\"demo\",\"kind\":\"Single\",\"payer\":\"$ALICE\"}" "$SHOP"
agent_call "$ROOT" pay_invoice "{\"id\":\"order-$RUN\"}" "$ALICE"
echo "receipt:"; view "$ROOT" get_receipt "{\"id\":\"order-$RUN\"}" | grep -E '"(status|amount|paid_at_ms)"'
echo "shop=$(view "$ROOT" get_balance "$(J "$SHOP")") savings=$(view "$ROOT" get_balance "$(J "savings.$SHOP")") partner=$(view "$ROOT" get_balance "$(J "$PARTNER")")"

step "6. SECURITY: the agent key is refused when it tries to exceed its authority (all three must FAIL)"
agent_call "$ROOT" create_invoice "{\"id\":\"big-$RUN\",\"amount\":\"$(usd 25)\",\"items_hash\":\"demo\",\"kind\":\"Single\"}" "$SHOP"
echo "-- pay 25 sUSD with a 20 per-payment limit:"
agent_call "$ROOT" pay_invoice "{\"id\":\"big-$RUN\"}" "$ALICE"
echo "-- agent key tries to raise its own limits:"
agent_call "$ROOT" set_limits "{\"per_payment\":\"$(usd 1000)\",\"per_day\":\"$(usd 1000)\"}" "$ALICE" '1 yoctoNEAR'
echo "-- agent key tries to withdraw the user's funds:"
agent_call "$ROOT" withdraw "{\"amount\":\"$(usd 10)\"}" "$ALICE" '1 yoctoNEAR'
echo "balance($ALICE) still = $(view "$ROOT" get_balance "$(J "$ALICE")")"

step "7. GROUP: 18 sUSD meal, three agents contribute 6 each, merchant paid once"
agent_call "$ROOT" create_invoice "{\"id\":\"group-$RUN\",\"amount\":\"$(usd 18)\",\"items_hash\":\"demo\",\"kind\":\"Group\"}" "$SHOP"
for u in "$ALICE" "$BOB" "$CAROL"; do
  agent_call "$ROOT" contribute "{\"id\":\"group-$RUN\",\"amount\":\"$(usd 6)\"}" "$u"
  echo "   after $u: $(view "$ROOT" get_invoice "{\"id\":\"group-$RUN\"}" | grep -E '"(status|funded)"' | tr -d ' \n')"
done

step "8. TICKET: Bob's agent buys a 5 sUSD entry ticket, the merchant redeems it once"
agent_call "$ROOT" create_invoice "{\"id\":\"ticket-$RUN\",\"amount\":\"$(usd 5)\",\"items_hash\":\"demo\",\"kind\":\"Ticket\"}" "$SHOP"
agent_call "$ROOT" pay_invoice "{\"id\":\"ticket-$RUN\"}" "$BOB"
agent_call "$ROOT" redeem "{\"id\":\"ticket-$RUN\"}" "$SHOP"
echo "-- second redeem must FAIL:"
agent_call "$ROOT" redeem "{\"id\":\"ticket-$RUN\"}" "$SHOP"

step "9. TREASURY: the shop's agent restocks, paying the supplier 9 sUSD out of revenue"
agent_call "$ROOT" create_invoice "{\"id\":\"po-$RUN\",\"amount\":\"$(usd 9)\",\"items_hash\":\"demo\",\"kind\":\"Single\",\"payer\":\"$SHOP\"}" "$SUPPLIER"
agent_call "$ROOT" pay_invoice "{\"id\":\"po-$RUN\"}" "$SHOP"
echo "shop=$(view "$ROOT" get_balance "$(J "$SHOP")") supplier=$(view "$ROOT" get_balance "$(J "$SUPPLIER")")"

step "10. WITHDRAW: the shop owner (wallet key) withdraws 5 sUSD to their own account"
call "$ROOT" withdraw "{\"amount\":\"$(usd 5)\"}" "$SHOP" '1 yoctoNEAR'
echo "sUSD token balance($SHOP) = $(view "$TOKEN" ft_balance_of "$(J "$SHOP")")"

step "Done. Invoice ids used the suffix $RUN"

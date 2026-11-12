use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const USD: u128 = 1_000_000; // 6 decimals

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("sokonipay.testnet")
}
fn token() -> AccountId {
    acc("susd.sokonipay.testnet")
}
fn shop() -> AccountId {
    acc("mama-mboga.sokonipay.testnet")
}
fn supplier() -> AccountId {
    acc("supplier.sokonipay.testnet")
}
fn partner() -> AccountId {
    acc("partner.sokonipay.testnet")
}
fn alice() -> AccountId {
    acc("alice.testnet")
}
fn bob() -> AccountId {
    acc("bob.testnet")
}
fn carol() -> AccountId {
    acc("carol.testnet")
}

/// Set the calling account, attached yoctoNEAR and block time (ms).
fn ctx(who: &AccountId, yocto: u128, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(owner())
        .predecessor_account_id(who.clone())
        .attached_deposit(NearToken::from_yoctonear(yocto))
        .block_timestamp(now_ms * 1_000_000)
        .build());
}

fn deposit(c: &mut SokoniPay, who: &AccountId, amount: u128) {
    ctx(&token(), 0, 1);
    let _ = c.ft_on_transfer(who.clone(), U128(amount), "deposit".into());
}

fn register(c: &mut SokoniPay, who: &AccountId, name: &str) {
    ctx(who, 1, 1);
    c.register_merchant(name.into(), None);
    ctx(&owner(), 0, 1);
    c.set_verified(who.clone(), true);
}

/// Contract with a verified shop, and alice holding 50 sUSD with limits 20 / 40.
fn setup() -> SokoniPay {
    ctx(&owner(), 0, 1);
    let mut c = SokoniPay::new(owner(), token());
    register(&mut c, &shop(), "Mama Mboga");
    deposit(&mut c, &alice(), 50 * USD);
    ctx(&alice(), 1, 1);
    c.set_limits(U128(20 * USD), U128(40 * USD));
    c
}

fn invoice(c: &mut SokoniPay, merchant: &AccountId, id: &str, amount: u128, kind: InvoiceKind) {
    ctx(merchant, 0, 1);
    c.create_invoice(id.into(), U128(amount), "hash".into(), kind, None, None, None, None);
}

fn bal(c: &SokoniPay, who: &AccountId) -> u128 {
    c.get_balance(who.clone()).0
}

#[test]
fn deposit_credits_balance() {
    let c = setup();
    assert_eq!(bal(&c, &alice()), 50 * USD);
}

#[test]
#[should_panic(expected = "unsupported token")]
fn deposit_rejects_other_tokens() {
    let mut c = setup();
    ctx(&acc("fake-token.testnet"), 0, 1);
    let _ = c.ft_on_transfer(alice(), U128(USD), "deposit".into());
}

#[test]
fn agent_pays_within_limits_and_gets_receipt() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", 8 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2); // no deposit = agent key
    let inv = c.pay_invoice("inv-1".into());
    assert_eq!(inv.status, InvoiceStatus::Paid);
    assert_eq!(bal(&c, &alice()), 42 * USD);
    assert_eq!(bal(&c, &shop()), 8 * USD);
    let receipt = c.get_receipt("inv-1".into()).unwrap();
    assert_eq!(receipt.contributions[0].account_id, alice());
    assert_eq!(c.get_limits(alice()).unwrap().spent_in_window.0, 8 * USD);
    assert_eq!(c.get_invoices_for(alice(), None, None).len(), 1);
}

#[test]
#[should_panic(expected = "over the per-payment limit")]
fn agent_blocked_over_per_payment_limit() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", 25 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "over the daily limit")]
fn agent_blocked_over_daily_limit() {
    let mut c = setup();
    for (id, amt) in [("a", 15), ("b", 15), ("c", 15)] {
        invoice(&mut c, &shop(), id, amt * USD, InvoiceKind::Single);
    }
    ctx(&alice(), 0, 2);
    c.pay_invoice("a".into());
    c.pay_invoice("b".into());
    c.pay_invoice("c".into()); // 45 > 40
}

#[test]
fn daily_limit_resets_after_24h() {
    let mut c = setup();
    for id in ["a", "b", "c"] {
        ctx(&shop(), 0, 1);
        c.create_invoice(id.into(), U128(15 * USD), "h".into(), InvoiceKind::Single, None, Some(MAX_EXPIRY_SEC), None, None);
    }
    ctx(&alice(), 0, 2);
    c.pay_invoice("a".into());
    c.pay_invoice("b".into());
    ctx(&alice(), 0, 2 + DAY_MS);
    assert_eq!(c.get_limits(alice()).unwrap().spent_in_window.0, 0);
    c.pay_invoice("c".into());
    assert_eq!(bal(&c, &alice()), 5 * USD);
}

#[test]
#[should_panic(expected = "no spending limits set")]
fn agent_needs_limits_first() {
    let mut c = setup();
    deposit(&mut c, &bob(), 10 * USD);
    invoice(&mut c, &shop(), "inv-1", USD, InvoiceKind::Single);
    ctx(&bob(), 0, 2);
    c.pay_invoice("inv-1".into());
}

#[test]
fn human_wallet_skips_limits_with_one_yocto() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", 25 * USD, InvoiceKind::Single);
    ctx(&alice(), 1, 2);
    c.pay_invoice("inv-1".into());
    assert_eq!(bal(&c, &shop()), 25 * USD);
    assert_eq!(c.get_limits(alice()).unwrap().spent_in_window.0, 0);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn agent_key_cannot_raise_limits() {
    let mut c = setup();
    ctx(&alice(), 0, 2);
    c.set_limits(U128(1000 * USD), U128(1000 * USD));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn agent_key_cannot_withdraw() {
    let mut c = setup();
    ctx(&alice(), 0, 2);
    c.withdraw(U128(USD)).detach();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn agent_key_cannot_change_revenue_split() {
    let mut c = setup();
    ctx(&shop(), 0, 2);
    c.set_revenue_split(vec![Split { account_id: partner(), bps: 9000 }]);
}

#[test]
fn withdraw_debits_and_failed_transfer_restores() {
    let mut c = setup();
    ctx(&alice(), 1, 2);
    c.withdraw(U128(10 * USD)).detach();
    assert_eq!(bal(&c, &alice()), 40 * USD);
    ctx(&owner(), 0, 3);
    assert!(!c.on_withdraw(alice(), U128(10 * USD), Err(PromiseError::Failed)));
    assert_eq!(bal(&c, &alice()), 50 * USD);
}

#[test]
#[should_panic(expected = "insufficient SokoniPay balance")]
fn cannot_overspend_balance() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", 60 * USD, InvoiceKind::Single);
    ctx(&alice(), 1, 2);
    c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "merchant not verified")]
fn unverified_merchant_cannot_invoice() {
    let mut c = setup();
    ctx(&supplier(), 1, 1);
    c.register_merchant("Supplier".into(), None);
    invoice(&mut c, &supplier(), "inv-1", USD, InvoiceKind::Single);
}

#[test]
#[should_panic(expected = "owner only")]
fn only_owner_verifies() {
    let mut c = setup();
    ctx(&supplier(), 1, 1);
    c.register_merchant("Supplier".into(), None);
    ctx(&supplier(), 0, 1);
    c.set_verified(supplier(), true);
}

#[test]
#[should_panic(expected = "invoice is not open")]
fn invoice_cannot_be_paid_twice() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("inv-1".into());
    c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "invoice expired")]
fn expired_invoice_cannot_be_paid() {
    let mut c = setup();
    invoice(&mut c, &shop(), "inv-1", USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2 + DEFAULT_EXPIRY_SEC * 1000);
    c.pay_invoice("inv-1".into());
}

#[test]
#[should_panic(expected = "invoice is for another payer")]
fn pinned_payer_enforced() {
    let mut c = setup();
    deposit(&mut c, &bob(), 10 * USD);
    ctx(&shop(), 0, 1);
    c.create_invoice("inv-1".into(), U128(USD), "h".into(), InvoiceKind::Single, Some(alice()), None, None, None);
    ctx(&bob(), 1, 2);
    c.pay_invoice("inv-1".into());
}

#[test]
fn revenue_split_adds_up_exactly() {
    let mut c = setup();
    ctx(&shop(), 1, 1);
    c.set_revenue_split(vec![
        Split { account_id: acc("savings.mama-mboga.sokonipay.testnet"), bps: 2000 },
        Split { account_id: partner(), bps: 1000 },
    ]);
    // 10.000001 sUSD: not divisible, so there is rounding dust.
    let amount = 10 * USD + 1;
    invoice(&mut c, &shop(), "inv-1", amount, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("inv-1".into());
    let savings = bal(&c, &acc("savings.mama-mboga.sokonipay.testnet"));
    let part = bal(&c, &partner());
    let merchant = bal(&c, &shop());
    assert_eq!(savings, 2 * USD);
    assert_eq!(part, USD);
    assert_eq!(merchant, 7 * USD + 1);
    assert_eq!(savings + part + merchant, amount);
}

#[test]
#[should_panic(expected = "splits exceed 100%")]
fn revenue_split_capped() {
    let mut c = setup();
    ctx(&shop(), 1, 1);
    c.set_revenue_split(vec![
        Split { account_id: partner(), bps: 6000 },
        Split { account_id: supplier(), bps: 5000 },
    ]);
}

#[test]
fn group_purchase_settles_once_when_fully_funded() {
    let mut c = setup();
    for who in [bob(), carol()] {
        deposit(&mut c, &who, 20 * USD);
        ctx(&who, 1, 1);
        c.set_limits(U128(10 * USD), U128(10 * USD));
    }
    invoice(&mut c, &shop(), "grp-1", 18 * USD, InvoiceKind::Group);

    ctx(&alice(), 0, 2);
    let inv = c.contribute("grp-1".into(), U128(6 * USD));
    assert_eq!(inv.status, InvoiceStatus::Open);
    assert_eq!(bal(&c, &shop()), 0); // escrowed, merchant not paid yet

    ctx(&bob(), 0, 3);
    c.contribute("grp-1".into(), U128(6 * USD));
    assert_eq!(bal(&c, &shop()), 0);

    ctx(&carol(), 0, 4);
    let inv = c.contribute("grp-1".into(), U128(6 * USD));
    assert_eq!(inv.status, InvoiceStatus::Paid);
    assert_eq!(inv.contributions.len(), 3);
    assert_eq!(bal(&c, &shop()), 18 * USD);
    assert_eq!(bal(&c, &alice()), 44 * USD);
    assert_eq!(bal(&c, &bob()), 14 * USD);
}

#[test]
#[should_panic(expected = "amount must be between 1 and the remaining total")]
fn group_cannot_be_overfunded() {
    let mut c = setup();
    invoice(&mut c, &shop(), "grp-1", 10 * USD, InvoiceKind::Group);
    ctx(&alice(), 0, 2);
    c.contribute("grp-1".into(), U128(11 * USD));
}

#[test]
fn expired_group_invoice_refunds_everyone() {
    let mut c = setup();
    deposit(&mut c, &bob(), 20 * USD);
    invoice(&mut c, &shop(), "grp-1", 18 * USD, InvoiceKind::Group);
    ctx(&alice(), 0, 2);
    c.contribute("grp-1".into(), U128(6 * USD));
    ctx(&bob(), 1, 3);
    c.contribute("grp-1".into(), U128(6 * USD));

    ctx(&carol(), 0, 2 + DEFAULT_EXPIRY_SEC * 1000); // anyone can trigger
    let inv = c.refund_expired("grp-1".into());
    assert_eq!(inv.status, InvoiceStatus::Refunded);
    assert_eq!(bal(&c, &alice()), 50 * USD);
    assert_eq!(bal(&c, &bob()), 20 * USD);
    assert_eq!(bal(&c, &shop()), 0);
}

#[test]
#[should_panic(expected = "invoice has not expired")]
fn cannot_refund_before_expiry() {
    let mut c = setup();
    invoice(&mut c, &shop(), "grp-1", 18 * USD, InvoiceKind::Group);
    ctx(&alice(), 0, 2);
    c.contribute("grp-1".into(), U128(6 * USD));
    c.refund_expired("grp-1".into());
}

#[test]
fn ticket_redeems_once() {
    let mut c = setup();
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&alice(), 0, 2);
    c.pay_invoice("tkt-1".into());
    ctx(&shop(), 0, 3);
    let t = c.redeem("tkt-1".into(), None);
    assert_eq!((t.admits, t.admitted), (1, 1));
    assert!(c.get_invoice("tkt-1".into()).unwrap().redeemed);
}

#[test]
#[should_panic(expected = "ticket already redeemed")]
fn ticket_cannot_be_redeemed_twice() {
    let mut c = setup();
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&alice(), 0, 2);
    c.pay_invoice("tkt-1".into());
    ctx(&shop(), 0, 3);
    c.redeem("tkt-1".into(), None);
    c.redeem("tkt-1".into(), None);
}

#[test]
#[should_panic(expected = "ticket not paid")]
fn unpaid_ticket_cannot_be_redeemed() {
    let mut c = setup();
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&shop(), 0, 3);
    c.redeem("tkt-1".into(), None);
}

/// Autonomous-business path: the shop's agent restocks by paying a supplier's
/// invoice out of the revenue it earned, under the shop's own onchain limits.
#[test]
fn merchant_agent_pays_supplier_from_revenue() {
    let mut c = setup();
    register(&mut c, &supplier(), "Wholesale Greens");
    ctx(&shop(), 1, 1);
    c.set_limits(U128(10 * USD), U128(30 * USD));

    invoice(&mut c, &shop(), "inv-1", 15 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("inv-1".into());

    invoice(&mut c, &supplier(), "po-1", 9 * USD, InvoiceKind::Single);
    ctx(&shop(), 0, 3); // shop's agent key
    c.pay_invoice("po-1".into());
    assert_eq!(bal(&c, &shop()), 6 * USD);
    assert_eq!(bal(&c, &supplier()), 9 * USD);
}

#[test]
#[should_panic(expected = "over the per-payment limit")]
fn merchant_agent_is_bound_by_limits_too() {
    let mut c = setup();
    register(&mut c, &supplier(), "Wholesale Greens");
    ctx(&shop(), 1, 1);
    c.set_limits(U128(10 * USD), U128(30 * USD));
    deposit(&mut c, &shop(), 40 * USD);
    invoice(&mut c, &supplier(), "po-1", 12 * USD, InvoiceKind::Single);
    ctx(&shop(), 0, 3);
    c.pay_invoice("po-1".into());
}

#[test]
#[should_panic(expected = "too many contributors")]
fn group_contributors_are_capped() {
    let mut c = setup();
    invoice(&mut c, &shop(), "grp-1", 100 * USD, InvoiceKind::Group);
    for i in 0..=MAX_CONTRIBUTORS {
        let who = acc(&format!("friend-{i}.testnet"));
        deposit(&mut c, &who, USD);
        ctx(&who, 1, 2);
        c.contribute("grp-1".into(), U128(USD));
    }
}

/// A gate ticket for a family: admits three, valid until closing time.
fn family_ticket(c: &mut SokoniPay, closes_at_ms: u64) {
    ctx(&shop(), 0, 1);
    c.create_invoice("gate-1".into(), U128(6 * USD), "h".into(), InvoiceKind::Ticket, Some(alice()), None, Some(3), Some(closes_at_ms));
    ctx(&alice(), 0, 2);
    c.pay_invoice("gate-1".into());
}

#[test]
fn ticket_admits_several_people_in_any_grouping() {
    let mut c = setup();
    family_ticket(&mut c, 1_000_000);
    assert_eq!(c.get_ticket("gate-1".into()).unwrap(), TicketInfo { admits: 3, admitted: 0, valid_until_ms: 1_000_000 });
    ctx(&shop(), 0, 10);
    assert_eq!(c.redeem("gate-1".into(), Some(2)).admitted, 2);
    assert!(!c.get_invoice("gate-1".into()).unwrap().redeemed);
    assert_eq!(c.redeem("gate-1".into(), None).admitted, 3); // the last one
    assert!(c.get_invoice("gate-1".into()).unwrap().redeemed);
}

#[test]
#[should_panic(expected = "more people than the ticket still admits")]
fn ticket_cannot_admit_more_than_paid_for() {
    let mut c = setup();
    family_ticket(&mut c, 1_000_000);
    ctx(&shop(), 0, 10);
    c.redeem("gate-1".into(), Some(4));
}

#[test]
#[should_panic(expected = "ticket expired")]
fn ticket_stops_working_after_closing_time() {
    let mut c = setup();
    family_ticket(&mut c, 1_000_000);
    ctx(&shop(), 0, 1_000_001);
    c.redeem("gate-1".into(), None);
}

#[test]
#[should_panic(expected = "the ticket would already be expired")]
fn cannot_sell_a_ticket_after_closing_time() {
    let mut c = setup();
    ctx(&shop(), 0, 5_000);
    c.create_invoice("gate-1".into(), U128(USD), "h".into(), InvoiceKind::Ticket, None, None, Some(1), Some(4_000));
}

#[test]
#[should_panic(expected = "only tickets take admits")]
fn only_tickets_carry_entry_rights() {
    let mut c = setup();
    ctx(&shop(), 0, 1);
    c.create_invoice("ord-1".into(), U128(USD), "h".into(), InvoiceKind::Single, None, None, Some(2), None);
}

#[test]
fn merchant_refunds_a_paid_ticket_in_full() {
    let mut c = setup();
    let (before_alice, before_shop) = (bal(&c, &alice()), bal(&c, &shop()));
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&alice(), 0, 2);
    c.pay_invoice("tkt-1".into());
    ctx(&shop(), 1, 3);
    let inv = c.refund("tkt-1".into());
    assert_eq!(inv.status, InvoiceStatus::Refunded);
    assert_eq!((bal(&c, &alice()), bal(&c, &shop())), (before_alice, before_shop));
}

#[test]
#[should_panic(expected = "ticket not paid")]
fn refunded_ticket_no_longer_opens_the_gate() {
    let mut c = setup();
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&alice(), 0, 2);
    c.pay_invoice("tkt-1".into());
    ctx(&shop(), 1, 3);
    c.refund("tkt-1".into());
    ctx(&shop(), 0, 4);
    c.redeem("tkt-1".into(), None);
}

#[test]
#[should_panic(expected = "someone has already entered on this ticket")]
fn used_ticket_cannot_be_refunded() {
    let mut c = setup();
    invoice(&mut c, &shop(), "tkt-1", 5 * USD, InvoiceKind::Ticket);
    ctx(&alice(), 0, 2);
    c.pay_invoice("tkt-1".into());
    ctx(&shop(), 0, 3);
    c.redeem("tkt-1".into(), None);
    ctx(&shop(), 1, 4);
    c.refund("tkt-1".into());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn agent_key_cannot_refund() {
    let mut c = setup();
    invoice(&mut c, &shop(), "ord-1", 5 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("ord-1".into());
    ctx(&shop(), 0, 3);
    c.refund("ord-1".into());
}

#[test]
#[should_panic(expected = "merchant only")]
fn only_the_merchant_refunds() {
    let mut c = setup();
    invoice(&mut c, &shop(), "ord-1", 5 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("ord-1".into());
    ctx(&alice(), 1, 3);
    c.refund("ord-1".into());
}

#[test]
#[should_panic(expected = "only a paid invoice can be refunded")]
fn an_invoice_is_refunded_once() {
    let mut c = setup();
    invoice(&mut c, &shop(), "ord-1", 5 * USD, InvoiceKind::Single);
    ctx(&alice(), 0, 2);
    c.pay_invoice("ord-1".into());
    ctx(&shop(), 1, 3);
    c.refund("ord-1".into());
    c.refund("ord-1".into());
}

fn bill(c: &mut SokoniPay, id: &str, amount: u128, now: u64) {
    ctx(&shop(), 0, now);
    c.create_invoice(id.into(), U128(amount), "sub:pro".into(), InvoiceKind::Single, Some(alice()), None, None, None);
}

fn subscribed(period_ms: u64) -> SokoniPay {
    let mut c = setup();
    ctx(&alice(), 1, 1_000);
    c.subscribe(shop(), "pro".into(), U128(5 * USD), period_ms);
    c
}

#[test]
fn subscription_is_billed_once_per_period() {
    let mut c = subscribed(DAY_MS);
    let before = bal(&c, &alice());
    bill(&mut c, "sub-1", 5 * USD, 2_000);
    ctx(&alice(), 0, 3_000); // the agent's key
    c.pay_invoice("sub-1".into());
    assert_eq!(bal(&c, &alice()), before - 5 * USD);
    assert_eq!(c.get_subscription(alice(), shop(), "pro".into()).unwrap().next_due_ms, 3_000 + DAY_MS);
    // a day later the next bill goes through
    bill(&mut c, "sub-2", 5 * USD, 3_000 + DAY_MS);
    ctx(&alice(), 0, 3_001 + DAY_MS);
    c.pay_invoice("sub-2".into());
    assert_eq!(bal(&c, &alice()), before - 10 * USD);
}

#[test]
#[should_panic(expected = "subscription not due yet")]
fn merchant_cannot_bill_early() {
    let mut c = subscribed(DAY_MS);
    bill(&mut c, "sub-1", 5 * USD, 2_000);
    ctx(&alice(), 0, 3_000);
    c.pay_invoice("sub-1".into());
    bill(&mut c, "sub-2", 5 * USD, 4_000);
}

#[test]
#[should_panic(expected = "subscription already paid for this period")]
fn two_bills_for_one_period_pay_once() {
    let mut c = subscribed(DAY_MS);
    bill(&mut c, "sub-1", 5 * USD, 2_000);
    bill(&mut c, "sub-2", 5 * USD, 2_001);
    ctx(&alice(), 0, 3_000);
    c.pay_invoice("sub-1".into());
    c.pay_invoice("sub-2".into());
}

#[test]
#[should_panic(expected = "not the subscribed amount")]
fn merchant_cannot_bill_more_than_agreed() {
    let mut c = subscribed(DAY_MS);
    bill(&mut c, "sub-1", 6 * USD, 2_000);
}

#[test]
#[should_panic(expected = "not subscribed")]
fn merchant_cannot_bill_someone_who_never_subscribed() {
    let mut c = setup();
    bill(&mut c, "sub-1", 5 * USD, 2_000);
}

#[test]
#[should_panic(expected = "not subscribed")]
fn a_bill_cannot_be_paid_after_unsubscribing() {
    let mut c = subscribed(DAY_MS);
    bill(&mut c, "sub-1", 5 * USD, 2_000);
    ctx(&alice(), 1, 2_500);
    c.unsubscribe(shop(), "pro".into());
    ctx(&alice(), 0, 3_000);
    c.pay_invoice("sub-1".into());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn agent_key_cannot_subscribe() {
    let mut c = setup();
    ctx(&alice(), 0, 1_000);
    c.subscribe(shop(), "pro".into(), U128(5 * USD), DAY_MS);
}

#[test]
#[should_panic(expected = "over the per-payment limit")]
fn subscription_bills_still_obey_the_agent_limits() {
    let mut c = setup();
    ctx(&alice(), 1, 1_000);
    c.subscribe(shop(), "pro".into(), U128(25 * USD), DAY_MS);
    bill(&mut c, "sub-1", 25 * USD, 2_000);
    ctx(&alice(), 0, 3_000);
    c.pay_invoice("sub-1".into());
}

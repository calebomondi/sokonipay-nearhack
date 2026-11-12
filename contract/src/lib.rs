//! SokoniPay: agent-to-agent commerce on NEAR.
//!
//! One contract holds:
//! - a verified-merchant registry,
//! - internal stablecoin balances (deposited with NEP-141 `ft_transfer_call`),
//! - per-account spending limits that bind AI-agent keys,
//! - invoices (single, ticket, group) with escrow for group purchases,
//! - revenue splits applied at settlement,
//! - receipts as NEP-297 events plus view methods.
//!
//! Security model
//! --------------
//! An AI agent is given a NEAR *function-call access key* for this contract.
//! Such keys cannot attach a deposit. So:
//! - methods an agent may call (`pay_invoice`, `contribute`, `create_invoice`,
//!   `redeem`) take no deposit and are bound by the account's onchain limits;
//! - methods that change authority or move funds out (`set_limits`, `withdraw`,
//!   `set_revenue_split`, `register_merchant`) require exactly 1 yoctoNEAR,
//!   which only a full-access key (the human's wallet) can attach.
//!
//! A human paying with their own wallet attaches 1 yoctoNEAR to `pay_invoice` /
//! `contribute`, which skips the agent limits.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const DEFAULT_EXPIRY_SEC: u64 = 15 * 60;
const MAX_EXPIRY_SEC: u64 = 7 * 24 * 60 * 60;
const MAX_SPLITS: usize = 5;
const BPS: u128 = 10_000;
const MAX_ID_LEN: usize = 64;
const MAX_LIST: usize = 200;
/// Caps the refund loop of a group invoice so it always fits in one transaction's gas.
const MAX_CONTRIBUTORS: usize = 20;
const GAS_FT_TRANSFER: Gas = Gas::from_tgas(15);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Merchants,
    Balances,
    Limits,
    Invoices,
    ByAccount,
    Tickets,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Split {
    pub account_id: AccountId,
    /// Share in basis points (100 = 1%).
    pub bps: u16,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Merchant {
    pub name: String,
    pub verified: bool,
    /// If true, the Merchant Agent only accepts orders carrying a fresh presence QR token.
    pub presence_required: bool,
    /// Revenue shares paid to other accounts at settlement. The remainder stays with the merchant.
    pub splits: Vec<Split>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default)]
pub struct Limits {
    pub per_payment: U128,
    pub per_day: U128,
    pub spent_in_window: U128,
    pub window_start_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InvoiceKind {
    /// One payer pays the whole amount.
    Single,
    /// Like Single, but the receipt is a ticket the merchant redeems once.
    Ticket,
    /// Several payers contribute; the merchant is paid once, when fully funded.
    Group,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum InvoiceStatus {
    Open,
    Paid,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Contribution {
    pub account_id: AccountId,
    pub amount: U128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Invoice {
    pub id: String,
    pub merchant: AccountId,
    pub amount: U128,
    /// sha256 (hex) of the offchain itemised invoice JSON.
    pub items_hash: String,
    pub kind: InvoiceKind,
    /// If set, only this account may pay (Single / Ticket).
    pub payer: Option<AccountId>,
    pub status: InvoiceStatus,
    pub funded: U128,
    pub contributions: Vec<Contribution>,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
    pub paid_at_ms: Option<u64>,
    /// Ticket only: set once the merchant has admitted the holder.
    pub redeemed: bool,
}

/// A person's standing permission for one merchant to bill them a fixed amount once per period.
/// Kept under its own storage key (see `mandate_key`), outside the contract's main state.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Mandate {
    pub amount: U128,
    pub period_ms: u64,
    /// The next bill can be issued and paid from this moment.
    pub next_due_ms: u64,
}

/// An invoice whose `items_hash` is "sub:<plan>" bills a subscription and is checked against the mandate.
const SUB_PREFIX: &str = "sub:";
const MIN_PERIOD_MS: u64 = 60 * 1000;

fn mandate_key(payer: &AccountId, merchant: &AccountId, plan: &str) -> Vec<u8> {
    format!("sub|{payer}|{merchant}|{plan}").into_bytes()
}

fn read_mandate(payer: &AccountId, merchant: &AccountId, plan: &str) -> Option<Mandate> {
    env::storage_read(&mandate_key(payer, merchant, plan)).map(|raw| {
        near_sdk::borsh::from_slice(&raw).unwrap_or_else(|_| env::panic_str("corrupt subscription"))
    })
}

fn write_mandate(payer: &AccountId, merchant: &AccountId, plan: &str, m: &Mandate) {
    let raw = near_sdk::borsh::to_vec(m).unwrap_or_else(|_| env::panic_str("cannot store subscription"));
    env::storage_write(&mandate_key(payer, merchant, plan), &raw);
}

/// Entry rights attached to a paid Ticket invoice.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct TicketInfo {
    /// How many people this ticket admits.
    pub admits: u32,
    /// How many have already been let in.
    pub admitted: u32,
    /// The ticket stops working after this time (closing time). 0 means it does not expire.
    pub valid_until_ms: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct SokoniPay {
    owner: AccountId,
    /// The one NEP-141 stablecoin this contract accepts.
    token: AccountId,
    merchants: LookupMap<AccountId, Merchant>,
    balances: LookupMap<AccountId, u128>,
    limits: LookupMap<AccountId, Limits>,
    invoices: LookupMap<String, Invoice>,
    /// Invoice ids an account is involved in (as merchant or payer), newest last.
    by_account: LookupMap<AccountId, Vec<String>>,
    /// Entry rights of Ticket invoices, by invoice id.
    tickets: LookupMap<String, TicketInfo>,
}

/// The contract state before tickets could admit several people or expire.
#[near(serializers = [borsh])]
pub struct SokoniPayV1 {
    owner: AccountId,
    token: AccountId,
    merchants: LookupMap<AccountId, Merchant>,
    balances: LookupMap<AccountId, u128>,
    limits: LookupMap<AccountId, Limits>,
    invoices: LookupMap<String, Invoice>,
    by_account: LookupMap<AccountId, Vec<String>>,
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({
            "standard": "sokonipay",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        })
    ));
}

#[near]
impl SokoniPay {
    #[init]
    pub fn new(owner: AccountId, token: AccountId) -> Self {
        Self {
            owner,
            token,
            merchants: LookupMap::new(StorageKey::Merchants),
            balances: LookupMap::new(StorageKey::Balances),
            limits: LookupMap::new(StorageKey::Limits),
            invoices: LookupMap::new(StorageKey::Invoices),
            by_account: LookupMap::new(StorageKey::ByAccount),
            tickets: LookupMap::new(StorageKey::Tickets),
        }
    }

    /// One-off upgrade from the first deployed version. Keeps every balance, limit, invoice and receipt.
    #[private]
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: SokoniPayV1 = env::state_read().unwrap_or_else(|| env::panic_str("no v1 state to migrate"));
        Self {
            owner: old.owner,
            token: old.token,
            merchants: old.merchants,
            balances: old.balances,
            limits: old.limits,
            invoices: old.invoices,
            by_account: old.by_account,
            tickets: LookupMap::new(StorageKey::Tickets),
        }
    }

    // ---------------------------------------------------------------- deposits

    /// NEP-141 receiver. `msg` must be "deposit" (or empty): credits the sender's balance.
    /// Any other token or message panics, which makes the token refund the transfer.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.token, "unsupported token");
        require!(msg.is_empty() || msg == "deposit", "unknown msg, use \"deposit\"");
        self.credit(&sender_id, amount.0);
        emit("deposit", near_sdk::serde_json::json!({ "account_id": sender_id, "amount": amount }));
        PromiseOrValue::Value(U128(0))
    }

    /// Withdraw stablecoin from the internal balance to the caller's own account.
    /// Full-access key only (1 yoctoNEAR): an agent key cannot move funds out.
    #[payable]
    pub fn withdraw(&mut self, amount: U128) -> Promise {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        self.debit(&account_id, amount.0);
        ext_ft_core::ext(self.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(account_id.clone(), amount, Some("SokoniPay withdraw".to_string()))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_CALLBACK)
                    .on_withdraw(account_id, amount),
            )
    }

    #[private]
    pub fn on_withdraw(
        &mut self,
        account_id: AccountId,
        amount: U128,
        #[callback_result] result: Result<(), PromiseError>,
    ) -> bool {
        if result.is_ok() {
            emit("withdraw", near_sdk::serde_json::json!({ "account_id": account_id, "amount": amount }));
            true
        } else {
            self.credit(&account_id, amount.0);
            false
        }
    }

    // ------------------------------------------------------------------ limits

    /// Set the spending limits that bind this account's agent keys.
    /// Full-access key only (1 yoctoNEAR): an agent cannot raise its own limits.
    #[payable]
    pub fn set_limits(&mut self, per_payment: U128, per_day: U128) {
        assert_one_yocto();
        require!(per_payment.0 <= per_day.0, "per_payment must not exceed per_day");
        let account_id = env::predecessor_account_id();
        let mut l = self.limits.get(&account_id).cloned().unwrap_or_default();
        l.per_payment = per_payment;
        l.per_day = per_day;
        self.limits.insert(account_id.clone(), l);
        emit(
            "limits_set",
            near_sdk::serde_json::json!({ "account_id": account_id, "per_payment": per_payment, "per_day": per_day }),
        );
    }

    // --------------------------------------------------------------- merchants

    /// Register the caller as a merchant (unverified until the owner verifies it).
    #[payable]
    pub fn register_merchant(&mut self, name: String, presence_required: Option<bool>) {
        assert_one_yocto();
        require!(!name.is_empty() && name.len() <= 80, "name must be 1-80 characters");
        let account_id = env::predecessor_account_id();
        let mut m = self.merchants.get(&account_id).cloned().unwrap_or(Merchant {
            name: String::new(),
            verified: false,
            presence_required: false,
            splits: vec![],
        });
        m.name = name;
        m.presence_required = presence_required.unwrap_or(m.presence_required);
        self.merchants.insert(account_id.clone(), m);
        emit("merchant_registered", near_sdk::serde_json::json!({ "merchant": account_id }));
    }

    /// Owner marks a merchant as verified (or revokes it).
    pub fn set_verified(&mut self, merchant: AccountId, verified: bool) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        let mut m = self.merchants.get(&merchant).cloned().unwrap_or_else(|| env::panic_str("merchant not registered"));
        m.verified = verified;
        self.merchants.insert(merchant.clone(), m);
        emit("merchant_verified", near_sdk::serde_json::json!({ "merchant": merchant, "verified": verified }));
    }

    /// Configure revenue sharing: each paid invoice credits `bps/10000` of the amount
    /// to each listed account, the remainder to the merchant.
    /// Full-access key only (1 yoctoNEAR): the Merchant Agent cannot redirect revenue.
    #[payable]
    pub fn set_revenue_split(&mut self, splits: Vec<Split>) {
        assert_one_yocto();
        let account_id = env::predecessor_account_id();
        let mut m = self.merchants.get(&account_id).cloned().unwrap_or_else(|| env::panic_str("merchant not registered"));
        require!(splits.len() <= MAX_SPLITS, "too many splits");
        let total: u32 = splits.iter().map(|s| s.bps as u32).sum();
        require!(total <= BPS as u32, "splits exceed 100%");
        require!(splits.iter().all(|s| s.bps > 0 && s.account_id != account_id), "invalid split");
        m.splits = splits.clone();
        self.merchants.insert(account_id.clone(), m);
        emit("revenue_split_set", near_sdk::serde_json::json!({ "merchant": account_id, "splits": splits }));
    }

    // ---------------------------------------------------------------- invoices

    /// A verified merchant (or its agent key) issues an invoice.
    pub fn create_invoice(
        &mut self,
        id: String,
        amount: U128,
        items_hash: String,
        kind: InvoiceKind,
        payer: Option<AccountId>,
        expires_in_sec: Option<u64>,
        admits: Option<u32>,
        valid_until_ms: Option<u64>,
    ) -> Invoice {
        let merchant = env::predecessor_account_id();
        let m = self.merchants.get(&merchant).unwrap_or_else(|| env::panic_str("merchant not registered"));
        require!(m.verified, "merchant not verified");
        require!(!id.is_empty() && id.len() <= MAX_ID_LEN, "id must be 1-64 characters");
        require!(items_hash.len() <= 64, "items_hash too long");
        require!(amount.0 > 0, "amount must be positive");
        require!(self.invoices.get(&id).is_none(), "invoice id already used");
        require!(!(kind == InvoiceKind::Group && payer.is_some()), "group invoices cannot pin a payer");
        let expires_in = expires_in_sec.unwrap_or(DEFAULT_EXPIRY_SEC);
        require!(expires_in > 0 && expires_in <= MAX_EXPIRY_SEC, "expiry out of range");

        let now = env::block_timestamp_ms();
        if let Some(plan) = items_hash.strip_prefix(SUB_PREFIX) {
            // A subscription bill: only for someone who subscribed, for the amount they agreed, and only when due.
            require!(kind == InvoiceKind::Single, "a subscription bill is a single invoice");
            let who = payer.clone().unwrap_or_else(|| env::panic_str("a subscription bill names its payer"));
            let m = read_mandate(&who, &merchant, plan).unwrap_or_else(|| env::panic_str("not subscribed"));
            require!(m.amount == amount, "not the subscribed amount");
            require!(now >= m.next_due_ms, "subscription not due yet");
        }
        let invoice = Invoice {
            id: id.clone(),
            merchant: merchant.clone(),
            amount,
            items_hash,
            kind,
            payer,
            status: InvoiceStatus::Open,
            funded: U128(0),
            contributions: vec![],
            created_at_ms: now,
            expires_at_ms: now + expires_in * 1000,
            paid_at_ms: None,
            redeemed: false,
        };
        if kind == InvoiceKind::Ticket {
            let admits = admits.unwrap_or(1);
            let valid_until_ms = valid_until_ms.unwrap_or(0);
            require!((1..=100).contains(&admits), "a ticket admits 1 to 100 people");
            require!(valid_until_ms == 0 || valid_until_ms > now, "the ticket would already be expired");
            self.tickets.insert(id.clone(), TicketInfo { admits, admitted: 0, valid_until_ms });
        } else {
            require!(admits.is_none() && valid_until_ms.is_none(), "only tickets take admits and valid_until_ms");
        }
        self.invoices.insert(id.clone(), invoice.clone());
        self.index(&merchant, &id);
        emit(
            "invoice_created",
            near_sdk::serde_json::json!({
                "invoice_id": id, "merchant": merchant, "amount": amount,
                "kind": kind, "items_hash": invoice.items_hash, "expires_at_ms": invoice.expires_at_ms,
            }),
        );
        invoice
    }

    /// Pay a Single or Ticket invoice in full from the caller's balance.
    /// Without a deposit (agent key) the caller's limits apply.
    /// With 1 yoctoNEAR (the human's wallet) limits are skipped.
    #[payable]
    pub fn pay_invoice(&mut self, id: String) -> Invoice {
        let payer = env::predecessor_account_id();
        let mut inv = self.open_invoice(&id);
        require!(inv.kind != InvoiceKind::Group, "group invoice: use contribute");
        require!(payer != inv.merchant, "merchant cannot pay its own invoice");
        if let Some(pinned) = &inv.payer {
            require!(*pinned == payer, "invoice is for another payer");
        }
        let amount = inv.amount.0;
        if let Some(plan) = inv.items_hash.clone().strip_prefix(SUB_PREFIX) {
            // Checked again at payment: the person may have unsubscribed, or this period may be paid already.
            let mut m = read_mandate(&payer, &inv.merchant, plan).unwrap_or_else(|| env::panic_str("not subscribed"));
            require!(m.amount == inv.amount, "not the subscribed amount");
            let now = env::block_timestamp_ms();
            require!(now >= m.next_due_ms, "subscription already paid for this period");
            m.next_due_ms = now + m.period_ms;
            write_mandate(&payer, &inv.merchant, plan, &m);
        }
        self.authorize_spend(&payer, amount);
        self.debit(&payer, amount);

        inv.funded = inv.amount;
        inv.contributions.push(Contribution { account_id: payer.clone(), amount: inv.amount });
        self.index(&payer, &id);
        emit(
            "payment",
            near_sdk::serde_json::json!({
                "invoice_id": id, "merchant": inv.merchant, "payer": payer,
                "amount": inv.amount, "kind": inv.kind,
            }),
        );
        self.settle(&mut inv);
        self.invoices.insert(id, inv.clone());
        inv
    }

    /// Contribute to a Group invoice. Funds are held in escrow; the merchant is paid
    /// in this same call once the invoice is fully funded.
    #[payable]
    pub fn contribute(&mut self, id: String, amount: U128) -> Invoice {
        let payer = env::predecessor_account_id();
        let mut inv = self.open_invoice(&id);
        require!(inv.kind == InvoiceKind::Group, "not a group invoice: use pay_invoice");
        require!(payer != inv.merchant, "merchant cannot pay its own invoice");
        let remaining = inv.amount.0 - inv.funded.0;
        require!(amount.0 > 0 && amount.0 <= remaining, "amount must be between 1 and the remaining total");
        self.authorize_spend(&payer, amount.0);
        self.debit(&payer, amount.0);

        inv.funded = U128(inv.funded.0 + amount.0);
        match inv.contributions.iter_mut().find(|c| c.account_id == payer) {
            Some(c) => c.amount = U128(c.amount.0 + amount.0),
            None => {
                require!(inv.contributions.len() < MAX_CONTRIBUTORS, "too many contributors");
                inv.contributions.push(Contribution { account_id: payer.clone(), amount });
                self.index(&payer, &id);
            }
        }
        emit(
            "contribution",
            near_sdk::serde_json::json!({
                "invoice_id": id, "payer": payer, "amount": amount,
                "funded": inv.funded, "total": inv.amount,
            }),
        );
        if inv.funded.0 == inv.amount.0 {
            emit(
                "group_settled",
                near_sdk::serde_json::json!({
                    "invoice_id": id, "merchant": inv.merchant, "amount": inv.amount,
                    "payers": inv.contributions,
                }),
            );
            self.settle(&mut inv);
        }
        self.invoices.insert(id, inv.clone());
        inv
    }

    /// Anyone can trigger refunds for a Group invoice that expired before being fully funded.
    pub fn refund_expired(&mut self, id: String) -> Invoice {
        let mut inv = self.invoices.get(&id).cloned().unwrap_or_else(|| env::panic_str("invoice not found"));
        require!(inv.status == InvoiceStatus::Open, "invoice is not open");
        require!(env::block_timestamp_ms() > inv.expires_at_ms, "invoice has not expired");
        for c in inv.contributions.clone() {
            self.credit(&c.account_id, c.amount.0);
            emit(
                "refund",
                near_sdk::serde_json::json!({ "invoice_id": id, "account_id": c.account_id, "amount": c.amount }),
            );
        }
        inv.funded = U128(0);
        inv.status = InvoiceStatus::Refunded;
        self.invoices.insert(id, inv.clone());
        inv
    }

    // ------------------------------------------------------------------ subscriptions

    /// Allow `merchant` to bill the caller `amount` once every `period_ms` for `plan`. The first bill is due now.
    /// Requires exactly 1 yoctoNEAR: only the person can subscribe, never their agent.
    #[payable]
    pub fn subscribe(&mut self, merchant: AccountId, plan: String, amount: U128, period_ms: u64) -> Mandate {
        assert_one_yocto();
        let payer = env::predecessor_account_id();
        require!(self.is_verified(merchant.clone()), "merchant not verified");
        require!(!plan.is_empty() && plan.len() <= 40 && !plan.contains('|'), "plan must be 1-40 characters");
        require!(amount.0 > 0, "amount must be positive");
        require!(period_ms >= MIN_PERIOD_MS, "period too short");
        let m = Mandate { amount, period_ms, next_due_ms: env::block_timestamp_ms() };
        write_mandate(&payer, &merchant, &plan, &m);
        emit(
            "subscribe",
            near_sdk::serde_json::json!({ "payer": payer, "merchant": merchant, "plan": plan, "amount": amount, "period_ms": period_ms }),
        );
        m
    }

    /// End a subscription. Any bill already issued for it can no longer be paid.
    #[payable]
    pub fn unsubscribe(&mut self, merchant: AccountId, plan: String) {
        assert_one_yocto();
        let payer = env::predecessor_account_id();
        require!(env::storage_remove(&mandate_key(&payer, &merchant, &plan)), "not subscribed");
        emit("unsubscribe", near_sdk::serde_json::json!({ "payer": payer, "merchant": merchant, "plan": plan }));
    }

    pub fn get_subscription(&self, payer: AccountId, merchant: AccountId, plan: String) -> Option<Mandate> {
        read_mandate(&payer, &merchant, &plan)
    }

    /// The merchant gives a paid invoice back in full: each payer gets what they paid, out of the
    /// merchant's own balance (shares already split to savings or a partner are the merchant's to cover).
    /// Requires exactly 1 yoctoNEAR, so the merchant's agent key can never refund.
    /// A ticket can be refunded only while nobody has entered on it; afterwards it no longer opens the gate.
    #[payable]
    pub fn refund(&mut self, id: String) -> Invoice {
        assert_one_yocto();
        let mut inv = self.invoices.get(&id).cloned().unwrap_or_else(|| env::panic_str("invoice not found"));
        require!(env::predecessor_account_id() == inv.merchant, "merchant only");
        require!(inv.status == InvoiceStatus::Paid, "only a paid invoice can be refunded");
        if inv.kind == InvoiceKind::Ticket {
            require!(self.ticket_of(&inv).admitted == 0, "someone has already entered on this ticket");
        }
        self.debit(&inv.merchant.clone(), inv.amount.0);
        for c in inv.contributions.clone() {
            self.credit(&c.account_id, c.amount.0);
            emit(
                "refund",
                near_sdk::serde_json::json!({ "invoice_id": id, "account_id": c.account_id, "amount": c.amount }),
            );
        }
        inv.funded = U128(0);
        inv.status = InvoiceStatus::Refunded;
        self.invoices.insert(id, inv.clone());
        inv
    }

    /// Merchant (or its agent key) lets ticket holders in. `count` people enter now (default: everyone
    /// the ticket still admits). Refused once the ticket is used up or its closing time has passed.
    pub fn redeem(&mut self, id: String, count: Option<u32>) -> TicketInfo {
        let mut inv = self.invoices.get(&id).cloned().unwrap_or_else(|| env::panic_str("invoice not found"));
        require!(env::predecessor_account_id() == inv.merchant, "merchant only");
        require!(inv.kind == InvoiceKind::Ticket, "not a ticket");
        require!(inv.status == InvoiceStatus::Paid, "ticket not paid");
        let mut t = self.ticket_of(&inv);
        require!(t.admitted < t.admits, "ticket already redeemed");
        require!(t.valid_until_ms == 0 || env::block_timestamp_ms() <= t.valid_until_ms, "ticket expired");
        let n = count.unwrap_or(t.admits - t.admitted);
        require!(n > 0 && t.admitted + n <= t.admits, "more people than the ticket still admits");
        t.admitted += n;
        inv.redeemed = t.admitted == t.admits;
        self.tickets.insert(id.clone(), t.clone());
        self.invoices.insert(id.clone(), inv.clone());
        emit(
            "ticket_redeemed",
            near_sdk::serde_json::json!({ "invoice_id": id, "merchant": inv.merchant, "count": n, "admitted": t.admitted, "admits": t.admits }),
        );
        t
    }

    // ------------------------------------------------------------------- views

    pub fn get_config(&self) -> (AccountId, AccountId) {
        (self.owner.clone(), self.token.clone())
    }

    pub fn get_merchant(&self, account_id: AccountId) -> Option<Merchant> {
        self.merchants.get(&account_id).cloned()
    }

    pub fn is_verified(&self, account_id: AccountId) -> bool {
        self.merchants.get(&account_id).map(|m| m.verified).unwrap_or(false)
    }

    pub fn get_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).copied().unwrap_or(0))
    }

    /// Limits with the rolling 24h window already applied.
    pub fn get_limits(&self, account_id: AccountId) -> Option<Limits> {
        self.limits.get(&account_id).cloned().map(|mut l| {
            if env::block_timestamp_ms() >= l.window_start_ms + DAY_MS {
                l.spent_in_window = U128(0);
            }
            l
        })
    }

    pub fn get_invoice(&self, id: String) -> Option<Invoice> {
        self.invoices.get(&id).cloned()
    }

    /// Entry rights of a Ticket invoice: how many it admits, how many are in, and when it expires.
    pub fn get_ticket(&self, id: String) -> Option<TicketInfo> {
        self.invoices.get(&id).filter(|i| i.kind == InvoiceKind::Ticket).map(|i| self.ticket_of(i))
    }

    /// A receipt is a paid invoice.
    pub fn get_receipt(&self, id: String) -> Option<Invoice> {
        self.invoices.get(&id).filter(|i| i.status == InvoiceStatus::Paid).cloned()
    }

    /// Invoices the account is involved in (as merchant or payer), newest first.
    pub fn get_invoices_for(&self, account_id: AccountId, from_index: Option<u32>, limit: Option<u32>) -> Vec<Invoice> {
        let ids = match self.by_account.get(&account_id) {
            Some(v) => v,
            None => return vec![],
        };
        ids.iter()
            .rev()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .filter_map(|id| self.invoices.get(id).cloned())
            .collect()
    }
}

// ---------------------------------------------------------------- internals

impl SokoniPay {
    /// Tickets issued before the upgrade have no stored entry rights: they admit one person and do not expire.
    fn ticket_of(&self, inv: &Invoice) -> TicketInfo {
        self.tickets.get(&inv.id).cloned().unwrap_or(TicketInfo {
            admits: 1,
            admitted: u32::from(inv.redeemed),
            valid_until_ms: 0,
        })
    }

    fn credit(&mut self, account_id: &AccountId, amount: u128) {
        let bal = self.balances.get(account_id).copied().unwrap_or(0);
        self.balances.insert(account_id.clone(), bal.checked_add(amount).unwrap_or_else(|| env::panic_str("overflow")));
    }

    fn debit(&mut self, account_id: &AccountId, amount: u128) {
        let bal = self.balances.get(account_id).copied().unwrap_or(0);
        require!(bal >= amount, "insufficient SokoniPay balance");
        self.balances.insert(account_id.clone(), bal - amount);
    }

    fn index(&mut self, account_id: &AccountId, id: &str) {
        let mut ids = self.by_account.get(account_id).cloned().unwrap_or_default();
        if ids.len() >= MAX_LIST {
            ids.remove(0);
        }
        ids.push(id.to_string());
        self.by_account.insert(account_id.clone(), ids);
    }

    fn open_invoice(&self, id: &String) -> Invoice {
        let inv = self.invoices.get(id).cloned().unwrap_or_else(|| env::panic_str("invoice not found"));
        require!(inv.status == InvoiceStatus::Open, "invoice is not open");
        require!(env::block_timestamp_ms() <= inv.expires_at_ms, "invoice expired");
        inv
    }

    /// Agent keys cannot attach a deposit, so a call without one is treated as an agent
    /// and must fit the account's limits. Exactly 1 yoctoNEAR proves a full-access key.
    fn authorize_spend(&mut self, account_id: &AccountId, amount: u128) {
        let deposit = env::attached_deposit().as_yoctonear();
        if deposit == 1 {
            return;
        }
        require!(deposit == 0, "attach exactly 1 yoctoNEAR or nothing");
        let mut l = self
            .limits
            .get(account_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("no spending limits set: the account owner must call set_limits first"));
        let now = env::block_timestamp_ms();
        if now >= l.window_start_ms + DAY_MS {
            l.window_start_ms = now;
            l.spent_in_window = U128(0);
        }
        require!(amount <= l.per_payment.0, "over the per-payment limit");
        require!(l.spent_in_window.0 + amount <= l.per_day.0, "over the daily limit");
        l.spent_in_window = U128(l.spent_in_window.0 + amount);
        self.limits.insert(account_id.clone(), l);
    }

    /// Mark the invoice paid and credit the merchant and its revenue-split accounts.
    fn settle(&mut self, inv: &mut Invoice) {
        let total = inv.amount.0;
        let splits = self.merchants.get(&inv.merchant).map(|m| m.splits.clone()).unwrap_or_default();
        let mut shared = 0u128;
        let mut parts = vec![];
        for s in &splits {
            let part = total * s.bps as u128 / BPS;
            if part > 0 {
                self.credit(&s.account_id, part);
                shared += part;
                parts.push(near_sdk::serde_json::json!({ "account_id": s.account_id, "amount": U128(part) }));
            }
        }
        // Rounding dust stays with the merchant, so the parts always add up to the total.
        let merchant_part = total - shared;
        self.credit(&inv.merchant.clone(), merchant_part);
        if !parts.is_empty() {
            emit(
                "revenue_split",
                near_sdk::serde_json::json!({
                    "invoice_id": inv.id, "merchant": inv.merchant,
                    "merchant_amount": U128(merchant_part), "shares": parts,
                }),
            );
        }
        inv.status = InvoiceStatus::Paid;
        inv.paid_at_ms = Some(env::block_timestamp_ms());
    }
}

#[cfg(test)]
mod tests;

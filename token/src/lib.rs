//! sUSD: a demo NEP-141 stablecoin for SokoniPay on **testnet only**.
//!
//! Differences from a production token, all for demo convenience:
//! - `mint` is open to anyone, capped per call (it is a faucet).
//! - Receivers are registered automatically on mint/transfer (the contract pays
//!   storage), so demo users never hit "account not registered".
//!
//! On mainnet SokoniPay would accept native USDC instead of this token.

use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, PromiseOrValue};

/// 6 decimals, like USDC.
pub const DECIMALS: u8 = 6;
/// Max 1,000 sUSD per mint call.
pub const MAX_MINT: u128 = 1_000 * 10u128.pow(DECIMALS as u32);

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self { token: FungibleToken::new(StorageKey::Token) }
    }

    /// Testnet faucet: mint up to 1,000 sUSD to `account_id`.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(amount.0 > 0 && amount.0 <= MAX_MINT, "mint between 0 and 1000 sUSD");
        self.ensure_registered(&account_id);
        self.token.internal_deposit(&account_id, amount.0);
        near_contract_standards::fungible_token::events::FtMint {
            owner_id: &account_id,
            amount: amount,
            memo: Some("testnet faucet"),
        }
        .emit();
    }

    fn ensure_registered(&mut self, account_id: &AccountId) {
        if !self.token.accounts.contains_key(account_id) {
            self.token.internal_register_account(account_id);
        }
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.ensure_registered(&receiver_id);
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "SokoniPay Demo USD (testnet)".to_string(),
            symbol: "sUSD".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    #[test]
    fn mint_registers_and_credits() {
        testing_env!(VMContextBuilder::new().build());
        let mut c = Contract::new();
        c.mint(accounts(1), U128(5_000_000));
        assert_eq!(c.ft_balance_of(accounts(1)).0, 5_000_000);
        assert_eq!(c.ft_total_supply().0, 5_000_000);
    }

    #[test]
    #[should_panic(expected = "mint between")]
    fn mint_cap() {
        testing_env!(VMContextBuilder::new().build());
        let mut c = Contract::new();
        c.mint(accounts(1), U128(MAX_MINT + 1));
    }

    #[test]
    fn transfer_auto_registers_receiver() {
        let mut ctx = VMContextBuilder::new();
        testing_env!(ctx.predecessor_account_id(accounts(1)).build());
        let mut c = Contract::new();
        c.mint(accounts(1), U128(10));
        testing_env!(ctx
            .predecessor_account_id(accounts(1))
            .attached_deposit(NearToken::from_yoctonear(1))
            .build());
        c.ft_transfer(accounts(2), U128(4), None);
        assert_eq!(c.ft_balance_of(accounts(2)).0, 4);
    }
}

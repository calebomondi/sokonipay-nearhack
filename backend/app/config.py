from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # backend/.env wins; the repository's root .env is read too, for keys kept there.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    # NEAR
    # One address, or several separated by commas: the next is used when one refuses or is rate-limited.
    near_rpc_url: str = "https://test.rpc.fastnear.com,https://rpc.testnet.fastnear.com,https://near-testnet.drpc.org"
    contract_id: str = "sokonipay.testnet"
    token_id: str = "susd.sokonipay.testnet"
    # Full-access key of contract_id: creates sub-accounts, verifies shops, funds the demo faucet.
    root_account_key: str = ""
    new_account_near: float = 0.1
    explorer_tx: str = "https://testnet.nearblocks.io/txns/"

    # Demo defaults for a new customer (micro sUSD, 6 decimals)
    welcome_susd: int = 50_000_000
    default_per_payment: int = 20_000_000
    default_per_day: int = 40_000_000
    shop_per_payment: int = 10_000_000
    shop_per_day: int = 60_000_000

    # Supabase
    supabase_base_url: str = ""
    supabase_anon_key: str = ""
    supabase_db_conn_str: str = ""
    # Any Postgres. When set it is used instead of the Supabase database: local development points it at the
    # Docker container, so local tests never touch production data. Sign-in still goes through Supabase.
    local_database_url: str = Field(default="", validation_alias="DATABASE_URL")
    db_schema: str = "sokonipay"  # the Supabase project is shared, so we keep to our own schema

    # Secrets
    key_vault_secret: str = ""
    presence_qr_secret: str = "dev-only-presence-secret"

    # Agents
    near_ai_cloud_api_key: str = ""
    near_ai_cloud_base_url: str = "https://cloud-api.near.ai/v1"
    near_ai_models: str = "z-ai/glm-5.3,Qwen/Qwen3.8-27B,deepseek/deepseek-v4.1-flash"
    agent_mode: str = "auto"  # auto: LLM when a key is set, else scripted. scripted: never call an LLM.

    # NEAR Intents (mainnet only). The JWT lowers the fee. Real deposits stay off until INTENTS_TREASURY names
    # the mainnet NEAR account that receives the USDC; without it "Add money" shows live quotes and moves nothing.
    near_intents_1click_jwt: str = ""
    intents_treasury: str = ""
    funding_min: int = 1_000_000
    funding_max: int = 25_000_000

    # ElevenLabs: speech in and out for the chat. Leave the key empty and the app has no voice buttons.
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"  # a stock voice; any voice ID from your ElevenLabs account works
    elevenlabs_stt_model: str = "scribe_v2"
    elevenlabs_tts_model: str = "eleven_flash_v2_5"

    # People who may approve shops and see the admin page (comma-separated emails).
    admin_emails: str = ""
    # Hosted demo only: a shop's owner may verify their own new shop, so judges can try the whole flow.
    # A real deployment leaves this off and an admin checks each shop, which is what stops fake codes.
    demo_self_verify: bool = False

    allowed_origins: str = "http://localhost:5173,http://localhost:5174"

    @property
    def database_url(self) -> str:
        url = self.local_database_url or self.supabase_db_conn_str
        for prefix in ("postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix):]
        return url

    @property
    def admins(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}

    @property
    def llm_enabled(self) -> bool:
        return bool(self.near_ai_cloud_api_key) and self.agent_mode != "scripted"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()

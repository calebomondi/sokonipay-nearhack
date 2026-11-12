"""NEAR AI Cloud: an OpenAI-compatible API whose inference runs inside a TEE."""

from langchain_openai import ChatOpenAI

from app.config import settings


def models() -> list[str]:
    return [m.strip() for m in settings.near_ai_models.split(",") if m.strip()]


def chat(temperature: float = 0.2):
    """The first model, falling back to the others if a call fails."""
    made = [
        ChatOpenAI(model=m, base_url=settings.near_ai_cloud_base_url, api_key=settings.near_ai_cloud_api_key,
                   temperature=temperature, timeout=40, max_retries=1, max_tokens=700)
        for m in models()
    ]
    return made[0], made[1:]


def mode_label() -> str:
    return f"NEAR AI Cloud ({models()[0]})" if settings.llm_enabled else "Scripted rules"

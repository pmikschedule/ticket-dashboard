"""Gemini 자격증명을 어디서 가져올지 정합니다.

키가 있을 수 있는 곳이 두 군데입니다.

  · **설정 화면** (`app_secrets` 표)  — 운영자가 웹에서 등록·교체합니다.
  · **.env**                          — Windows PC 에 직접 적어 둔 값.

**설정 화면이 이깁니다.** 화면에서 등록·교체하는 목적 자체가 그 PC 에 붙지 않고
키를 바꾸는 것인데, .env 가 이기면 화면에서 바꿔도 아무 일이 안 일어납니다.
그러면 운영자는 바꿨다고 믿고 있는데 실제로는 옛 키가 계속 쓰입니다.

.env 는 **대비책**입니다 — DB 에 아직 등록하지 않았거나, 등록한 것을 지웠을 때.

고르는 규칙은 순수 함수(`choose_gemini`)로 떼어 놓았습니다. Supabase 없이
테스트할 수 있어야 하기 때문입니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .config import Config, ConfigError

# 화면에서 등록할 때 쓰는 이름. 웹의 web/src/lib/api.ts 와 **같은 값**입니다.
GEMINI_KEY_SECRET = "gemini_api_key"
GEMINI_MODEL_SETTING = "gemini_model"

DEFAULT_MODEL = "gemini-2.5-flash"


@dataclass(frozen=True)
class GeminiSettings:
    api_key: str
    model: str
    #: 'settings' = 설정 화면, 'env' = .env. doctor 가 어느 쪽인지 알려 줍니다.
    key_source: str
    model_source: str

    @property
    def masked_key(self) -> str:
        """로그·화면에 찍어도 되는 형태. 값 자체는 어디에도 남기지 않습니다."""
        if len(self.api_key) <= 4:
            return "•" * len(self.api_key)
        return "•" * (len(self.api_key) - 4) + self.api_key[-4:]


class SettingsSource(Protocol):
    def secret(self, key: str) -> str: ...
    def setting(self, key: str, default: str = "") -> str: ...


def choose_gemini(
    db_key: str,
    db_model: str,
    env_key: str,
    env_model: str,
) -> GeminiSettings:
    """두 출처 중 무엇을 쓸지 정합니다. 순수 함수입니다.

    빈 문자열과 공백만 있는 값은 '없는 것' 으로 봅니다 — 화면에서 지웠는데
    빈 문자열이 남아 있으면 키가 있는 줄 알고 그대로 호출하다 실패합니다.
    """
    key = (db_key or "").strip()
    key_source = "settings"
    if not key:
        key = (env_key or "").strip()
        key_source = "env"

    if not key:
        raise ConfigError(
            "Gemini API 키가 없습니다.\n"
            "  · 웹 설정 화면 → 시스템 설정 → Gemini API 키 에서 등록하거나,\n"
            "  · agent/.env 에 GEMINI_API_KEY 를 적으세요."
        )

    model = (db_model or "").strip()
    model_source = "settings"
    if not model:
        model = (env_model or "").strip()
        model_source = "env"
    if not model:
        model = DEFAULT_MODEL
        model_source = "기본값"

    return GeminiSettings(
        api_key=key,
        model=model,
        key_source=key_source,
        model_source=model_source,
    )


def resolve_gemini(store: SettingsSource, config: Config) -> GeminiSettings:
    """설정 화면을 먼저 보고, 없으면 .env 로 갑니다."""
    return choose_gemini(
        db_key=store.secret(GEMINI_KEY_SECRET),
        db_model=store.setting(GEMINI_MODEL_SETTING),
        env_key=config.gemini_api_key,
        env_model=config.gemini_model,
    )

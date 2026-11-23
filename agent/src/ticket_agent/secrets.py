"""자격증명을 어디서 가져올지 정합니다 — Gemini 키, 그리고 desk 인증.

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
from .constants import (
    DESK_AUTH_ENV,
    DESK_AUTH_SETTINGS,
    DESK_CLIENT_ID_SECRET,
    DESK_CLIENT_SECRET_SECRET,
    DESK_COOKIE_SECRET,
)
from .desk import CookieError, DeskAuth, jwt_expiry, normalize_cookie

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


class SecretsSource(Protocol):
    def secrets(self, keys: list[str]) -> dict[str, str]: ...


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


# ── desk 인증 ───────────────────────────────────────────────────────────────
#
# desk 는 Cloudflare Access(메일 OTP) 뒤에 있어 아이디·비밀번호 로그인이 없습니다.
# 붙는 길은 둘입니다.
#
#   ① Service Token — `CF-Access-Client-Id`·`CF-Access-Client-Secret` 헤더. desk 소유자가
#      발급해 줘야 합니다. 지금은 없고, 받으면 바로 쓰도록 자리만 둡니다. 만료가 없습니다.
#   ② CF_Authorization 쿠키 — 사람이 브라우저로 로그인해 받은 JWT. 한 달쯤 갑니다.
#
# 우선순위: Service Token(설정 화면 → .env) > 쿠키(설정 화면 → .env).
# Gemini 키와 같은 이유로 **설정 화면이 .env 를 이깁니다** — 화면에서 새 쿠키를 넣었는데
# .env 의 옛 쿠키가 이기면, 바꾼 줄 알고 있는 동안 수집이 계속 실패합니다.

_WHERE = {DESK_AUTH_SETTINGS: "설정 화면", DESK_AUTH_ENV: ".env"}

DESK_AUTH_MISSING = (
    "desk 인증이 없습니다 — 대시보드 설정 화면에서 desk 쿠키(CF_Authorization)를 넣어 주세요"
)


@dataclass(frozen=True)
class DeskAuthChoice:
    #: 쓸 인증. 없으면 None — 이유는 `problem`
    auth: DeskAuth | None
    problem: str | None = None
    #: 고르면서 버린 것들 (반쪽 Service Token, 못 읽는 쿠키). doctor·로그가 알려 줍니다
    notes: tuple[str, ...] = ()


def choose_desk_auth(
    db_cookie: str,
    env_cookie: str,
    db_client_id: str = "",
    db_client_secret: str = "",
    env_client_id: str = "",
    env_client_secret: str = "",
) -> DeskAuthChoice:
    """desk 인증을 고릅니다. 순수 함수입니다 (만료 여부는 판정하지 않습니다).

    만료된 쿠키도 **고릅니다.** 설정 화면에 넣은 값이 만료됐다고 .env 의 옛 값으로
    조용히 넘어가면, 사람은 무엇이 쓰이는지 모르게 됩니다. 만료는 수집이 명확한
    이유로 실패하게 두고, 화면이 미리 알립니다.

    **못 읽는 쿠키(JWT 가 아님)는 건너뜁니다.** 쓸 수 없는 값이라 고를 의미가 없고,
    건너뛴 사실은 notes 에 남습니다.
    """
    notes: list[str] = []

    for origin, client_id, client_secret in (
        (DESK_AUTH_SETTINGS, db_client_id, db_client_secret),
        (DESK_AUTH_ENV, env_client_id, env_client_secret),
    ):
        cid = (client_id or "").strip()
        csec = (client_secret or "").strip()
        if cid and csec:
            return DeskAuthChoice(DeskAuth.service_token(origin, cid, csec), None, tuple(notes))
        if cid or csec:
            notes.append(
                f"{_WHERE[origin]}의 desk Service Token 이 반쪽만 있어 쓰지 않습니다 "
                "(Client ID 와 Client Secret 둘 다 필요합니다)"
            )

    for origin, raw in ((DESK_AUTH_SETTINGS, db_cookie), (DESK_AUTH_ENV, env_cookie)):
        token = normalize_cookie(raw)
        if not token:
            continue
        try:
            expires_at = jwt_expiry(token)
        except CookieError as exc:
            notes.append(f"{_WHERE[origin]}의 desk 쿠키를 쓰지 않습니다 — {exc}")
            continue
        return DeskAuthChoice(DeskAuth.cookie(origin, token, expires_at), None, tuple(notes))

    return DeskAuthChoice(None, DESK_AUTH_MISSING, tuple(notes))


def resolve_desk_auth(store: SecretsSource, config: Config) -> DeskAuthChoice:
    """설정 화면(app_secrets)을 먼저 보고, 없으면 .env 로 갑니다.

    비밀값 세 개를 **한 번에** 읽습니다. 못 읽으면(표 없음·네트워크) 빈 값으로 보고
    .env 로 갑니다 — Gemini 키와 같습니다.
    """
    db = store.secrets([DESK_COOKIE_SECRET, DESK_CLIENT_ID_SECRET, DESK_CLIENT_SECRET_SECRET])
    return choose_desk_auth(
        db_cookie=db.get(DESK_COOKIE_SECRET, ""),
        env_cookie=config.desk_cf_authorization,
        db_client_id=db.get(DESK_CLIENT_ID_SECRET, ""),
        db_client_secret=db.get(DESK_CLIENT_SECRET_SECRET, ""),
        env_client_id=config.desk_cf_client_id,
        env_client_secret=config.desk_cf_client_secret,
    )

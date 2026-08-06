"""Gemini 자격증명 출처 선택.

Supabase 없이 돌아야 하므로 순수 함수만 검사합니다.
"""

from __future__ import annotations

import pytest

from ticket_agent.config import ConfigError
from ticket_agent.secrets import DEFAULT_MODEL, choose_gemini


def test_설정_화면이_env_를_이깁니다():
    """화면에서 바꿨는데 .env 가 이기면 바꾼 줄 알고 옛 키를 계속 씁니다."""
    result = choose_gemini(db_key="AIza-db", db_model="", env_key="AIza-env", env_model="")
    assert result.api_key == "AIza-db"
    assert result.key_source == "settings"


def test_화면에_없으면_env_로_갑니다():
    result = choose_gemini(db_key="", db_model="", env_key="AIza-env", env_model="")
    assert result.api_key == "AIza-env"
    assert result.key_source == "env"


def test_공백만_있는_값은_없는_것으로_봅니다():
    result = choose_gemini(db_key="   ", db_model="", env_key="AIza-env", env_model="")
    assert result.api_key == "AIza-env"
    assert result.key_source == "env"


def test_앞뒤_공백은_잘라냅니다():
    """붙여넣을 때 줄바꿈이 딸려 오는 일이 잦습니다."""
    result = choose_gemini(db_key="  AIza-db\n", db_model="", env_key="", env_model="")
    assert result.api_key == "AIza-db"


def test_둘_다_없으면_어디에_넣어야_하는지_알려_줍니다():
    with pytest.raises(ConfigError) as exc:
        choose_gemini(db_key="", db_model="", env_key="", env_model="")
    message = str(exc.value)
    assert "설정 화면" in message
    assert "GEMINI_API_KEY" in message


def test_모델도_화면이_우선():
    result = choose_gemini(
        db_key="k", db_model="gemini-3-pro", env_key="", env_model="gemini-2.5-flash"
    )
    assert result.model == "gemini-3-pro"
    assert result.model_source == "settings"


def test_모델이_어디에도_없으면_기본값():
    result = choose_gemini(db_key="k", db_model="", env_key="", env_model="")
    assert result.model == DEFAULT_MODEL
    assert result.model_source == "기본값"


def test_마스킹은_끝_4글자만_남깁니다():
    result = choose_gemini(db_key="AIzaSyABCDEFGH1234", db_model="", env_key="", env_model="")
    assert result.masked_key.endswith("1234")
    assert "AIzaSy" not in result.masked_key
    assert len(result.masked_key) == len("AIzaSyABCDEFGH1234")


def test_짧은_값도_전부_가립니다():
    result = choose_gemini(db_key="abc", db_model="", env_key="", env_model="")
    assert result.masked_key == "•••"

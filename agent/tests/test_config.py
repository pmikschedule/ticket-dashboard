import pytest

from ticket_agent.config import ConfigError, parse_since, resolve_mail_backend


class TestResolveMailBackend:
    def test_explicit_values_pass_through(self):
        assert resolve_mail_backend("outlook") == "outlook"
        assert resolve_mail_backend("fixture") == "fixture"

    def test_auto_resolves_by_platform(self, monkeypatch):
        monkeypatch.setattr("sys.platform", "darwin")
        assert resolve_mail_backend("auto") == "fixture"
        monkeypatch.setattr("sys.platform", "win32")
        assert resolve_mail_backend("auto") == "outlook"

    def test_empty_defaults_to_auto(self, monkeypatch):
        monkeypatch.setattr("sys.platform", "linux")
        assert resolve_mail_backend("") == "fixture"

    def test_unknown_value_raises(self):
        with pytest.raises(ConfigError, match="AGENT_MAIL_BACKEND"):
            resolve_mail_backend("gmail")


class TestParseSince:
    def test_empty_is_none(self):
        assert parse_since("") is None

    def test_iso_with_z_is_utc(self):
        parsed = parse_since("2026-08-01T00:00:00Z")
        assert parsed is not None and parsed.tzinfo is not None

    def test_naive_datetime_gets_utc(self):
        parsed = parse_since("2026-08-01T00:00:00")
        assert parsed is not None and parsed.tzinfo is not None

    def test_garbage_raises_instead_of_silently_ignoring(self):
        """조용히 None 이 되면 전체 폴더를 다시 스캔합니다."""
        with pytest.raises(ConfigError, match="SCAN_SINCE"):
            parse_since("어제")

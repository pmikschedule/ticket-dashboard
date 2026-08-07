"""수집 창 — 이게 틀리면 메일을 조용히 놓칩니다.

못 읽은 메일은 오류도 경고도 안 남깁니다. 그래서 '많이 읽는 쪽으로 틀리기' 를
일부러 시험합니다.
"""

from datetime import datetime, timedelta, timezone

from ticket_agent.window import parse_last_scan, resolve_scan_window

NOW = datetime(2026, 8, 7, 9, 0, tzinfo=timezone.utc)


class TestParseLastScan:
    def test_reads_iso(self):
        assert parse_last_scan("2026-08-01T00:00:00+00:00") == datetime(
            2026, 8, 1, tzinfo=timezone.utc
        )

    def test_accepts_z_suffix(self):
        assert parse_last_scan("2026-08-01T00:00:00Z") == datetime(2026, 8, 1, tzinfo=timezone.utc)

    def test_naive_value_is_utc(self):
        assert parse_last_scan("2026-08-01T00:00:00") == datetime(2026, 8, 1, tzinfo=timezone.utc)

    def test_empty_is_first_run(self):
        assert parse_last_scan("") is None
        assert parse_last_scan("   ") is None

    def test_broken_value_falls_back_to_first_run(self):
        """많이 읽는 것이 못 읽는 것보다 낫습니다."""
        assert parse_last_scan("어제") is None


class TestFirstRun:
    def test_uses_scan_since_and_no_limit(self):
        since = datetime(2026, 7, 1, tzinfo=timezone.utc)
        window = resolve_scan_window(
            last_scan_at=None, scan_since=since, lookback_days=3, now=NOW
        )
        assert window.first_run is True
        assert window.since == since
        assert window.limit is None

    def test_without_scan_since_reads_whole_folder(self):
        window = resolve_scan_window(
            last_scan_at=None, scan_since=None, lookback_days=3, now=NOW
        )
        assert window.since is None
        assert window.limit is None

    def test_explicit_limit_is_honoured_as_a_safety_net(self):
        window = resolve_scan_window(
            last_scan_at=None, scan_since=None, lookback_days=3, now=NOW, configured_limit=500
        )
        assert window.limit == 500


class TestLaterRuns:
    def test_reads_last_three_days(self):
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(hours=1),
            scan_since=None,
            lookback_days=3,
            now=NOW,
        )
        assert window.first_run is False
        assert window.since == NOW - timedelta(days=3)

    def test_long_downtime_does_not_widen_the_window(self):
        """3주 꺼져 있었어도 3일치만 봅니다. 그 사이 것은 사람이 이미 처리했습니다."""
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(days=21),
            scan_since=None,
            lookback_days=3,
            now=NOW,
        )
        assert window.since == NOW - timedelta(days=3)

    def test_never_goes_before_scan_since(self):
        """운영자가 그은 선입니다. 그 앞은 안 봅니다."""
        floor = NOW - timedelta(days=1)
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(hours=1),
            scan_since=floor,
            lookback_days=3,
            now=NOW,
        )
        assert window.since == floor

    def test_scan_since_older_than_lookback_does_not_widen(self):
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(hours=1),
            scan_since=NOW - timedelta(days=90),
            lookback_days=3,
            now=NOW,
        )
        assert window.since == NOW - timedelta(days=3)

    def test_zero_lookback_is_treated_as_one_day(self):
        """0 을 그대로 쓰면 창이 닫혀 아무것도 안 읽습니다."""
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(hours=1),
            scan_since=None,
            lookback_days=0,
            now=NOW,
        )
        assert window.since == NOW - timedelta(days=1)

    def test_later_runs_also_have_no_limit_by_default(self):
        window = resolve_scan_window(
            last_scan_at=NOW - timedelta(hours=1),
            scan_since=None,
            lookback_days=3,
            now=NOW,
        )
        assert window.limit is None


class TestDescribe:
    def test_first_run_is_labelled(self):
        window = resolve_scan_window(
            last_scan_at=None, scan_since=None, lookback_days=3, now=NOW
        )
        assert "첫 기동" in window.describe()
        assert "갯수 제한 없음" in window.describe()

    def test_later_run_is_labelled(self):
        window = resolve_scan_window(
            last_scan_at=NOW, scan_since=None, lookback_days=3, now=NOW
        )
        assert "이어서" in window.describe()

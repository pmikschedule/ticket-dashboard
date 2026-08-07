"""어디서부터 어디까지 읽을지 정합니다.

예전에는 `SCAN_LIMIT` 이 **이미 처리한 메일까지 세었습니다.** 중복 판정은
그다음 단계라서, 매 스캔마다 폴더의 최신 N통을 다시 읽고 대부분이 중복이었고,
그만큼 오래된 신규 메일은 영영 한도 밖에 남았습니다. 오류도 경고도 없이
수집 창이 조용히 좁아지는 형태라 알아채기 어렵습니다.

처리한 메일을 다른 폴더로 옮기면 해결되지만, 그건 운영자의 아웃룩 폴더 구조를
바꾸라는 요구입니다. 유지보수 말고 다른 메일도 오는 받은편지함에 폴더를 새로
파게 할 수는 없습니다.

그래서 **시간으로 자릅니다.**

  · 첫 기동   — `SCAN_SINCE` 부터 **갯수 제한 없이** 전부. 밀린 것을 한 번에 텁니다
  · 그다음부터 — 최근 며칠치만 (`SCAN_LOOKBACK_DAYS`, 기본 3일)

'그다음' 을 아는 근거는 마지막 스캔 시각(`last_scan_at`)입니다. DB 에 둡니다 —
파일에 두면 꾸러미를 다시 풀 때 사라지고, 그러면 첫 기동으로 되돌아가
`SCAN_SINCE` 부터 전부 다시 읽습니다.

되돌아 읽는 폭을 넉넉히 잡는 편이 낫습니다. 겹쳐 읽은 메일은 중복으로 걸러지지만
못 읽은 메일은 아무도 모릅니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class ScanWindow:
    """이번 스캔에서 읽을 범위."""

    #: 이 시각 이후 메일만. None 이면 폴더 전체.
    since: datetime | None
    #: 읽을 최대 통수. None 이면 제한 없음.
    limit: int | None
    #: 첫 기동인지. 로그 문구가 달라집니다.
    first_run: bool

    def describe(self) -> str:
        when = self.since.astimezone().strftime("%Y-%m-%d %H:%M") if self.since else "폴더 전체"
        cap = f"최대 {self.limit}통" if self.limit else "갯수 제한 없음"
        head = "첫 기동" if self.first_run else "이어서"
        return f"{head} — {when} 이후, {cap}"


def parse_last_scan(raw: str) -> datetime | None:
    """DB 에 넣어 둔 마지막 스캔 시각. 못 읽으면 None(첫 기동 취급)."""
    value = (raw or "").strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        # 값이 깨졌으면 첫 기동으로 돌아갑니다. 많이 읽는 것이
        # 못 읽는 것보다 낫습니다.
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def resolve_scan_window(
    *,
    last_scan_at: datetime | None,
    scan_since: datetime | None,
    lookback_days: int,
    now: datetime,
    configured_limit: int = 0,
) -> ScanWindow:
    """이번에 읽을 범위를 정합니다.

    `configured_limit` 이 0 이면 제한 없음입니다. 0 보다 크면 안전장치로
    그 값을 씁니다 — 폴더에 수만 통이 있는 곳에서 첫 기동이 하루 종일 도는
    것을 막고 싶을 때만 켜세요.

    첫 기동 판정은 `last_scan_at` 하나로 합니다. 값이 없거나 깨졌으면
    첫 기동입니다.
    """
    limit = configured_limit if configured_limit > 0 else None

    if last_scan_at is None:
        return ScanWindow(since=scan_since, limit=limit, first_run=True)

    # 마지막 스캔 시각이 아니라 **지금부터 N일 전**을 씁니다. 에이전트가 오래
    # 꺼져 있었다면 마지막 스캔 기준으로는 몇 주치를 한꺼번에 읽게 되는데,
    # 그 사이 메일은 이미 사람이 처리했을 가능성이 큽니다.
    lookback = timedelta(days=max(lookback_days, 1))
    since = now - lookback

    # SCAN_SINCE 보다 앞으로는 가지 않습니다. 운영자가 "이 날짜 이전은
    # 보지 마라" 고 정한 선입니다.
    if scan_since and since < scan_since:
        since = scan_since

    return ScanWindow(since=since, limit=limit, first_run=False)

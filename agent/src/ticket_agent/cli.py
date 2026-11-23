"""에이전트 CLI.

    ticket-agent collect            메일을 한 번 스캔해 티켓으로 적재
    ticket-agent collect --watch    N초마다 반복 스캔
    ticket-agent manual             수동 등록 큐를 한 번 처리
    ticket-agent send               발송 큐를 한 번 처리
    ticket-agent send --watch       발송 큐를 계속 감시 (상시 실행용)
    ticket-agent run                수집과 발송을 한 프로세스에서 번갈아 실행
                                    (+ desk 수집 스레드: 화면의 수집 요청 · 정기 수집)
    ticket-agent desk-scan          desk 를 한 번 읽어 스냅샷을 남기고 대시보드에 올림
    ticket-agent desk-scan --dry-run  받기·행 만들기만 (저장·업로드 안 함)
    ticket-agent doctor             설정·연결 점검
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import date, timedelta
from pathlib import Path

from . import __version__
from .classifier import Classifier
from .collector import Collector
from .config import Config, ConfigError, load_config
from .constants import (
    DESK_AUTH_ENV,
    DESK_AUTH_SERVICE_TOKEN,
    DESK_AUTH_SETTINGS,
    DESK_EXPIRY_WARN_DAYS,
)
from .desk import (
    days_left,
    fetch_state,
    is_missing_object,
    make_snapshot,
    now_utc,
    readable_error,
    snapshot_row,
)
from .desk_worker import (
    MISSING_QUEUE,
    STORE_TIMEOUT_SECONDS,
    DeskWorker,
    start_desk_thread,
)
from .mail import build_mail_client
from .manual import ManualProcessor
from .secrets import DeskAuthChoice, resolve_desk_auth, resolve_gemini
from .sender import Sender
from .store import TicketStore

log = logging.getLogger("ticket_agent")


def _setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def _build(config: Config):
    mail = build_mail_client(config)
    store = TicketStore(config.supabase_url, config.supabase_service_key, config.supabase_bucket)
    # 설정 화면에 등록된 키가 있으면 그쪽을 씁니다 (.env 는 대비책).
    gemini = resolve_gemini(store, config)
    log.info(
        "Gemini — 키 %s (%s), 모델 %s (%s)",
        gemini.masked_key,
        gemini.key_source,
        gemini.model,
        gemini.model_source,
    )
    classifier = Classifier(
        gemini.api_key,
        gemini.model,
        thinking_budget=config.gemini_thinking_budget,
    )
    return mail, store, classifier


def cmd_collect(config: Config, args: argparse.Namespace) -> int:
    mail, store, classifier = _build(config)
    collector = Collector(config, mail, classifier, store)
    try:
        if not args.watch:
            result = collector.run_once()
            print(result.summary())
            for error in result.errors:
                print(f"  ⚠️ {error}", file=sys.stderr)
            return 1 if result.errors else 0

        interval = max(30, args.interval)
        log.info("%d초마다 메일을 스캔합니다. Ctrl+C 로 종료합니다.", interval)
        while True:
            try:
                result = collector.run_once()
                log.info(result.summary())
            except KeyboardInterrupt:
                raise
            except Exception as exc:
                log.exception("스캔 중 오류 — 다음 주기에 다시 시도합니다: %s", exc)
            time.sleep(interval)
    except KeyboardInterrupt:
        log.info("중단했습니다.")
        return 0
    finally:
        mail.close()


def cmd_manual(config: Config, args: argparse.Namespace) -> int:
    """수동 등록 큐 — 웹에서 붙여넣은 본문을 분류해 티켓으로."""
    mail, store, classifier = _build(config)
    classifier.set_systems(store.list_systems())
    include_rules, exclude_rules = store.intake_rules()
    classifier.set_intake_rules(
        include_rules, exclude_rules, store.setting("intake_ambiguous_policy", "include")
    )

    processor = ManualProcessor(classifier, store)
    try:
        result = processor.run_once(limit=args.limit)
        print(result.summary())
        for error in result.errors:
            print(f"  ⚠️ {error}", file=sys.stderr)
        return 1 if result.errors else 0
    finally:
        mail.close()


def cmd_send(config: Config, args: argparse.Namespace) -> int:
    mail, store, _ = _build(config)
    sender = Sender(config, mail, store)
    try:
        if args.watch:
            sender.run_forever(limit=args.limit)
            return 0
        result = sender.run_once(limit=args.limit)
        print(result.summary())
        for error in result.errors:
            print(f"  ⚠️ {error}", file=sys.stderr)
        return 1 if result.errors else 0
    except KeyboardInterrupt:
        log.info("중단했습니다.")
        return 0
    finally:
        mail.close()


def cmd_run(config: Config, args: argparse.Namespace) -> int:
    """상시 실행 모드. 수집 주기마다 스캔하고, 그 사이에는 발송 큐를 봅니다."""
    mail, store, classifier = _build(config)
    collector = Collector(config, mail, classifier, store)
    sender = Sender(config, mail, store)
    manual = ManualProcessor(classifier, store)

    collect_interval = max(60, args.interval)
    send_interval = max(5, config.send_poll_interval)
    next_collect = 0.0

    # desk 수집은 **따로 도는 스레드**입니다. Outlook COM 을 안 건드리고 DB 클라이언트도
    # 따로 씁니다 — desk 가 늦거나 쿠키가 만료돼도 메일 수집은 멈추지 않습니다.
    desk = start_desk_thread(config)

    log.info(
        "상시 실행 시작 — 수집 %d초 주기, 수동등록·발송 %d초 주기 "
        "(발송 모드: %s). Ctrl+C 로 종료합니다.",
        collect_interval,
        send_interval,
        config.send_mode,
    )
    try:
        while True:
            now = time.monotonic()
            if now >= next_collect:
                next_collect = now + collect_interval
                try:
                    result = collector.run_once()
                    if result.scanned:
                        log.info(result.summary())
                except Exception as exc:
                    log.exception("수집 오류 — 계속 진행합니다: %s", exc)

            # 수동 등록은 사람이 화면에서 기다리므로 발송보다 먼저 봅니다.
            try:
                manual_result = manual.run_once(limit=args.limit)
                if manual_result.picked:
                    log.info(manual_result.summary())
            except Exception as exc:
                log.exception("수동 등록 오류 — 계속 진행합니다: %s", exc)

            try:
                send_result = sender.run_once(limit=args.limit)
                if send_result.picked:
                    log.info(send_result.summary())
            except Exception as exc:
                log.exception("발송 오류 — 계속 진행합니다: %s", exc)

            time.sleep(send_interval)
    except KeyboardInterrupt:
        log.info("중단했습니다.")
        return 0
    finally:
        if desk:
            desk[1].set()
        mail.close()


_WHERE = {DESK_AUTH_SETTINGS: "설정 화면", DESK_AUTH_ENV: ".env"}


def _desk_store(config: Config, timeout: float = STORE_TIMEOUT_SECONDS) -> TicketStore:
    return TicketStore(
        config.supabase_url, config.supabase_service_key, config.supabase_bucket, timeout=timeout
    )


def _auth_line(choice: DeskAuthChoice) -> tuple[str, str]:
    """(표시, 내용). 표시는 ✅ ⚠️ ℹ️ 중 하나 — desk 는 **경고만** 하고 실패로 세지 않습니다."""
    auth = choice.auth
    if auth is None:
        return "⚠️", choice.problem or "desk 인증이 없습니다"
    if auth.source == DESK_AUTH_SERVICE_TOKEN:
        return "ℹ️ ", f"desk 인증 — Service Token ({_WHERE.get(auth.origin, auth.origin)}, ID {auth.hint})"
    now = now_utc()
    assert auth.expires_at is not None
    left = days_left(auth.expires_at, now)
    when = (auth.expires_at + timedelta(hours=9)).strftime("%Y-%m-%d %H:%M")
    line = (
        f"desk 인증 — 쿠키 ({_WHERE.get(auth.source, auth.source)}, {auth.hint}) · "
        f"만료 {when} 한국 시각 ({left}일 남음)"
    )
    if auth.expired(now):
        return "⚠️", f"{line} — 만료됐습니다. 대시보드 설정에서 desk 쿠키를 다시 넣어 주세요"
    if left <= DESK_EXPIRY_WARN_DAYS:
        return "⚠️", f"{line} — 곧 만료됩니다. 대시보드 설정에서 새 쿠키를 넣어 두세요"
    return "✅", line


def cmd_desk_scan(config: Config, args: argparse.Namespace) -> int:
    """desk 를 한 번 읽습니다. 정기 수집·화면 요청과 **같은 함수**(`DeskWorker.scan`)입니다."""
    store = _desk_store(config)
    if not args.dry_run:
        outcome = DeskWorker(config, store).scan("manual")
        print(("완료 — " if outcome.ok else "실패 — ") + outcome.note)
        return 0 if outcome.ok else 1

    print("desk 수집 — dry-run (받기·행 만들기만 · 로컬 저장·업로드·상태 기록 안 함)")
    choice = resolve_desk_auth(store, config)
    for note in choice.notes:
        print(f"  ⚠️ {note}")
    mark, line = _auth_line(choice)
    print(f"  {mark} {line}")
    auth = choice.auth
    if auth is None or auth.expired(now_utc()):
        return 1
    try:
        result = fetch_state(config.desk_url, auth, timeout=60)
    except Exception as exc:
        print(f"  ✖ {readable_error(exc)}")
        return 1

    row = snapshot_row(make_snapshot(result.state, now_utc()))
    size_kb = round(len(json.dumps(row["state"], ensure_ascii=False, separators=(",", ":"))) / 1024)
    counts = row["counts"]
    print(f"  계정    : {result.email or '(알 수 없음)'}")
    print(
        f"  수집    : work {counts['work']} · projects {counts['projects']} · decisions {counts['decisions']}"
    )
    print(f"  원본시각: {row['source_at'] or '(없음)'}")
    print(
        f"  행      : day={row['day']} · scanned_at={row['scanned_at']} · "
        f"키 {', '.join(sorted(row))} · state 약 {size_kb}KB"
    )
    if args.row_out:
        out = Path(args.row_out)
        out.write_text(json.dumps(row, ensure_ascii=False), encoding="utf-8")
        print(f"  행 파일 : {out} — desk 업무 내용이 들어 있습니다. 대조 후 지우세요")
    print("  업로드  : 안 함 (dry-run)")
    return 0


def _doctor_desk(config: Config) -> None:
    """desk 줄은 **경고만** 합니다. run-agent.bat 은 doctor 가 실패하면 에이전트를 안
    띄우므로, 쿠키 만료가 메일 수집까지 멈추게 하면 안 됩니다."""
    print("\n■ desk 수집 (경고만 — 여기가 실패해도 메일 수집은 그대로 돕니다)")
    if not config.desk_scan_enabled:
        print("  ℹ️  꺼져 있습니다 (DESK_SCAN=off) — 화면의 수집 요청을 처리하지 않습니다")
        return
    try:
        store = _desk_store(config, timeout=20)
    except Exception as exc:
        print(f"  ⚠️ 대시보드에 붙지 못해 desk 점검을 건너뜁니다 — {readable_error(exc)}")
        return

    choice = resolve_desk_auth(store, config)
    for note in choice.notes:
        print(f"  ⚠️ {note}")
    mark, line = _auth_line(choice)
    print(f"  {mark} {line}")
    auth = choice.auth
    if auth is not None and not auth.expired(now_utc()):
        try:
            result = fetch_state(config.desk_url, auth, timeout=20)
            print(
                f"  ✅ desk 연결 — {config.desk_url} · 업무 {len(result.state['work'])}건"
                f" (계정 {result.email or '?'})"
            )
        except Exception as exc:
            print(f"  ⚠️ desk 연결 — {readable_error(exc)}")

    try:
        rows = store.open_scan_requests()
        print(f"  ✅ 수집 요청 표 — 대기·진행 {len(rows)}건")
    except Exception as exc:
        missing = is_missing_object(getattr(exc, "code", None), str(exc))
        print(f"  ⚠️ 수집 요청 표 — {MISSING_QUEUE if missing else readable_error(exc)}")

    try:
        newest = store.latest_snapshot_day()
        if not newest:
            print("  ⚠️ 대시보드 스냅샷 — 없습니다. `desk-scan` 을 한 번 돌리세요")
        else:
            today = now_utc().date()
            age = (today - date.fromisoformat(newest[:10])).days
            mark = "⚠️" if age >= 7 else "✅"
            tail = " — 주간보고서가 지난 구간으로 만들어집니다" if age >= 7 else ""
            print(f"  {mark} 대시보드 스냅샷 — 최신 {newest[:10]} ({age}일 전){tail}")
    except Exception as exc:
        print(f"  ⚠️ 대시보드 스냅샷 — {readable_error(exc)}")


def cmd_doctor(config: Config, args: argparse.Namespace) -> int:
    """설정과 외부 연결을 점검합니다. 실패해도 다음 항목을 계속 봅니다."""
    print("■ 설정")
    print(f"  에이전트 버전 : {__version__}")
    print(f"  메일 백엔드   : {config.mail_backend}")
    print(f"  대상 폴더     : {config.outlook_folder}")
    print(f"  처리 후 이동  : {config.outlook_done_folder or '(이동 안 함, 읽음 표시만)'}")
    print(f"  발송 모드     : {config.send_mode}")
    print(f"  분류 모델     : {config.gemini_model} (Google Gemini)")
    print(f"  Supabase URL  : {config.supabase_url}")
    print(f"  첨부 버킷     : {config.supabase_bucket}")

    ok = True

    print("\n■ 연결 점검")
    try:
        store = TicketStore(
            config.supabase_url, config.supabase_service_key, config.supabase_bucket
        )
        store.claim_queued_emails(limit=1)
        print("  ✅ Supabase — 접속 및 outbound_emails 조회 성공")
    except Exception as exc:
        ok = False
        print(f"  ❌ Supabase — {exc}")

    try:
        mail = build_mail_client(config)
        mails = list(mail.fetch(config.outlook_folder, limit=1))
        print(f"  ✅ 메일 백엔드 — '{config.outlook_folder}' 접근 성공 (표본 {len(mails)}건)")
        mail.close()
    except Exception as exc:
        ok = False
        print(f"  ❌ 메일 백엔드 — {exc}")

    try:
        store = TicketStore(
            config.supabase_url, config.supabase_service_key, config.supabase_bucket
        )
        gemini = resolve_gemini(store, config)
        where = {"settings": "설정 화면", "env": "agent/.env"}
        print(
            f"  ℹ️  Gemini 키 출처 — {where.get(gemini.key_source, gemini.key_source)}"
            f" ({gemini.masked_key})"
        )
        classifier = Classifier(gemini.api_key, gemini.model)
        models = classifier.available_models()
        if gemini.model in models:
            print(f"  ✅ Gemini API — 모델 '{gemini.model}' 사용 가능")
        else:
            ok = False
            print(f"  ❌ Gemini API — 키는 유효하지만 '{gemini.model}' 을 쓸 수 없습니다.")
            print(f"     이 키로 쓸 수 있는 모델: {', '.join(models[:8]) or '(없음)'}")
            print("     설정 화면의 Gemini 모델을 위 목록 중 하나로 바꾸세요.")
    except Exception as exc:
        ok = False
        print(f"  ❌ Gemini API — {exc}")

    # desk 는 결과(ok)에 넣지 않습니다 — 경고만
    _doctor_desk(config)

    print("\n결과:", "정상" if ok else "위 항목을 해결해야 에이전트가 동작합니다.")
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ticket-agent",
        description="메일 기반 이슈 트래킹 시스템 — 로컬 PC 에이전트",
    )
    parser.add_argument("--env-file", help=".env 경로 (기본: 현재 디렉터리의 .env)")
    sub = parser.add_subparsers(dest="command", required=True)

    collect = sub.add_parser("collect", help="메일을 스캔해 티켓으로 적재")
    collect.add_argument("--watch", action="store_true", help="주기적으로 반복")
    collect.add_argument("--interval", type=int, default=300, help="반복 주기(초). 최소 30")
    collect.set_defaults(func=cmd_collect)

    send = sub.add_parser("send", help="완료 티켓의 회신을 발송")
    send.add_argument("--watch", action="store_true", help="큐를 계속 감시")
    send.add_argument("--limit", type=int, default=10, help="한 번에 처리할 건수")
    send.set_defaults(func=cmd_send)

    manual = sub.add_parser("manual", help="수동 등록 큐를 처리")
    manual.add_argument("--limit", type=int, default=10, help="한 번에 처리할 건수")
    manual.set_defaults(func=cmd_manual)

    run = sub.add_parser("run", help="수집 + 수동 등록 + 발송 상시 실행 (+ desk 수집 스레드)")
    run.add_argument("--interval", type=int, default=300, help="수집 주기(초). 최소 60")
    run.add_argument("--limit", type=int, default=10, help="한 번에 처리할 발송 건수")
    run.set_defaults(func=cmd_run)

    desk_scan = sub.add_parser("desk-scan", help="desk 를 한 번 읽어 스냅샷을 남기고 대시보드에 올림")
    desk_scan.add_argument(
        "--dry-run",
        action="store_true",
        help="받기·행 만들기만 합니다 (로컬 저장·업로드·상태 기록 안 함)",
    )
    desk_scan.add_argument(
        "--row-out",
        metavar="PATH",
        help="(dry-run) 만든 행을 JSON 파일로 남깁니다 — 다른 구현과 대조할 때",
    )
    desk_scan.set_defaults(func=cmd_desk_scan)

    doctor = sub.add_parser("doctor", help="설정·연결 점검")
    doctor.set_defaults(func=cmd_doctor)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = load_config(args.env_file)
    except ConfigError as exc:
        print(f"설정 오류: {exc}", file=sys.stderr)
        return 2

    _setup_logging(config.log_level)
    return args.func(config, args)


if __name__ == "__main__":
    raise SystemExit(main())

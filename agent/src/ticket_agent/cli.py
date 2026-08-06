"""에이전트 CLI.

    ticket-agent collect            메일을 한 번 스캔해 티켓으로 적재
    ticket-agent collect --watch    N초마다 반복 스캔
    ticket-agent send               발송 큐를 한 번 처리
    ticket-agent send --watch       발송 큐를 계속 감시 (상시 실행용)
    ticket-agent run                수집과 발송을 한 프로세스에서 번갈아 실행
    ticket-agent doctor             설정·연결 점검
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from .classifier import Classifier
from .collector import Collector
from .config import Config, ConfigError, load_config
from .mail import build_mail_client
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
    classifier = Classifier(
        config.gemini_api_key,
        config.gemini_model,
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

    collect_interval = max(60, args.interval)
    send_interval = max(5, config.send_poll_interval)
    next_collect = 0.0

    log.info(
        "상시 실행 시작 — 수집 %d초 주기, 발송 %d초 주기 (발송 모드: %s). Ctrl+C 로 종료합니다.",
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
        mail.close()


def cmd_doctor(config: Config, args: argparse.Namespace) -> int:
    """설정과 외부 연결을 점검합니다. 실패해도 다음 항목을 계속 봅니다."""
    print("■ 설정")
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
        classifier = Classifier(config.gemini_api_key, config.gemini_model)
        models = classifier.available_models()
        if config.gemini_model in models:
            print(f"  ✅ Gemini API — 모델 '{config.gemini_model}' 사용 가능")
        else:
            ok = False
            print(f"  ❌ Gemini API — 키는 유효하지만 '{config.gemini_model}' 을 쓸 수 없습니다.")
            print(f"     이 키로 쓸 수 있는 모델: {', '.join(models[:8]) or '(없음)'}")
            print("     .env 의 GEMINI_MODEL 을 위 목록 중 하나로 바꾸세요.")
    except Exception as exc:
        ok = False
        print(f"  ❌ Gemini API — {exc}")

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

    run = sub.add_parser("run", help="수집 + 발송 상시 실행")
    run.add_argument("--interval", type=int, default=300, help="수집 주기(초). 최소 60")
    run.add_argument("--limit", type=int, default=10, help="한 번에 처리할 발송 건수")
    run.set_defaults(func=cmd_run)

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

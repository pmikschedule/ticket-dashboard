"""fixture 백엔드 — 이 백엔드가 동작해야 Outlook 없이 개발이 됩니다."""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from ticket_agent.mail.base import MailError
from ticket_agent.mail.fixture import FixtureMailClient

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "sample_mails.json"


def write_mails(tmp_path: Path, records: list[dict]) -> Path:
    path = tmp_path / "mails.json"
    path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    return path


def client(tmp_path: Path, records: list[dict]) -> FixtureMailClient:
    return FixtureMailClient(write_mails(tmp_path, records), tmp_path / "outbox")


class TestFetch:
    def test_reads_the_bundled_sample_file(self):
        mails = list(FixtureMailClient(SAMPLE, Path("/tmp")).fetch("받은 편지함/요청", limit=50))
        assert len(mails) == 4
        assert mails[0].message_id == "fixture-001"  # 오래된 것부터

    def test_sorted_oldest_first(self, tmp_path):
        records = [
            {"message_id": "b", "received_at": "2026-08-06T10:00:00Z", "subject": "나중"},
            {"message_id": "a", "received_at": "2026-08-05T10:00:00Z", "subject": "먼저"},
        ]
        mails = list(client(tmp_path, records).fetch("", limit=10))
        assert [m.message_id for m in mails] == ["a", "b"]

    def test_since_filter(self, tmp_path):
        records = [
            {"message_id": "old", "received_at": "2026-07-01T00:00:00Z"},
            {"message_id": "new", "received_at": "2026-08-05T00:00:00Z"},
        ]
        since = datetime(2026, 8, 1, tzinfo=timezone.utc)
        mails = list(client(tmp_path, records).fetch("", limit=10, since=since))
        assert [m.message_id for m in mails] == ["new"]

    def test_limit_is_respected(self, tmp_path):
        records = [{"message_id": f"m{i}", "received_at": f"2026-08-0{i+1}T00:00:00Z"} for i in range(5)]
        assert len(list(client(tmp_path, records).fetch("", limit=2))) == 2

    def test_folder_filter(self, tmp_path):
        records = [
            {"message_id": "a", "folder": "받은 편지함/요청"},
            {"message_id": "b", "folder": "받은 편지함/기타"},
        ]
        mails = list(client(tmp_path, records).fetch("받은 편지함/요청", limit=10))
        assert [m.message_id for m in mails] == ["a"]

    def test_record_without_message_id_is_skipped(self, tmp_path):
        records = [{"subject": "ID 없음"}, {"message_id": "ok"}]
        mails = list(client(tmp_path, records).fetch("", limit=10))
        assert [m.message_id for m in mails] == ["ok"]

    def test_base64_attachment_is_decoded(self, tmp_path):
        payload = base64.b64encode(b"\x89PNG-bytes").decode()
        records = [
            {
                "message_id": "a",
                "attachments": [{"file_name": "shot.png", "content_base64": payload}],
            }
        ]
        mails = list(client(tmp_path, records).fetch("", limit=10))
        assert mails[0].attachments[0].content == b"\x89PNG-bytes"

    def test_plain_attachment_content_is_encoded(self, tmp_path):
        records = [{"message_id": "a", "attachments": [{"file_name": "a.txt", "content": "로그"}]}]
        mails = list(client(tmp_path, records).fetch("", limit=10))
        assert mails[0].attachments[0].content == "로그".encode()

    def test_attachment_filename_is_sanitized(self, tmp_path):
        records = [{"message_id": "a", "attachments": [{"file_name": "../../etc/passwd"}]}]
        mails = list(client(tmp_path, records).fetch("", limit=10))
        assert mails[0].attachments[0].file_name == "passwd"

    def test_processed_mail_is_not_returned_again(self, tmp_path):
        c = client(tmp_path, [{"message_id": "a"}])
        assert len(list(c.fetch("", limit=10))) == 1
        c.mark_processed("a")
        assert list(c.fetch("", limit=10)) == []

    def test_missing_file_raises_instead_of_returning_empty(self, tmp_path):
        """조용히 0건이면 '메일이 없다' 와 '설정이 틀렸다' 를 구분할 수 없습니다."""
        c = FixtureMailClient(tmp_path / "nope.json", tmp_path / "outbox")
        with pytest.raises(MailError, match="fixture 메일 파일이 없습니다"):
            list(c.fetch("", limit=10))

    def test_invalid_json_raises(self, tmp_path):
        path = tmp_path / "mails.json"
        path.write_text("{ 깨진 json", encoding="utf-8")
        with pytest.raises(MailError, match="올바른 JSON"):
            list(FixtureMailClient(path, tmp_path / "outbox").fetch("", limit=10))

    def test_non_array_root_raises(self, tmp_path):
        path = tmp_path / "mails.json"
        path.write_text('{"message_id": "a"}', encoding="utf-8")
        with pytest.raises(MailError, match="배열이어야"):
            list(FixtureMailClient(path, tmp_path / "outbox").fetch("", limit=10))


class TestSendReply:
    def test_writes_outbox_file(self, tmp_path):
        c = client(tmp_path, [])
        note = c.send_reply("entry-1", "user@example.co.kr", "RE: 제목", "본문입니다")

        files = list((tmp_path / "outbox").glob("*.txt"))
        assert len(files) == 1
        content = files[0].read_text(encoding="utf-8")
        assert "받는 사람: user@example.co.kr" in content
        assert "본문입니다" in content
        assert "display" in content
        assert str(files[0]) in note

    def test_send_mode_is_recorded(self, tmp_path):
        c = client(tmp_path, [])
        c.send_reply(None, "u@e.kr", "s", "b", display_only=False)
        content = next((tmp_path / "outbox").glob("*.txt")).read_text(encoding="utf-8")
        assert "send(자동 발송)" in content

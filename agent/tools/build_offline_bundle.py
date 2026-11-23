"""인터넷 없는 윈도우에서 **설치 없이** 돌릴 수 있는 꾸러미를 만듭니다.

인트라넷 환경에서는 `pip install` 이 안 되고 설치 프로그램도 못 돌립니다.
그래서 의존 라이브러리를 미리 풀어 담고, `PYTHONPATH` 대신 `run.py` 가
`sys.path` 를 직접 맞춰 주는 방식으로 갑니다. 압축만 풀면 실행됩니다.

**이 스크립트는 인터넷이 되는 기기(맥 등)에서 돌립니다.** 윈도우용 휠을
받아 오는 것이지 이 기기에 설치하는 것이 아닙니다.

    python3 tools/build_offline_bundle.py              # 전체 (라이브러리 포함, 약 70MB)
    python3 tools/build_offline_bundle.py --src-only   # 소스만 (수십 KB)

산출물: dist-offline/ticket-agent-offline.zip
        dist-offline/ticket-agent-src-<버전>.zip   (--src-only)

**코드만 바뀌었으면 `--src-only` 로 충분합니다.** 라이브러리(`lib/`)는 그대로 두고
`src` 폴더만 갈아 끼우는 배포입니다. 의존성(REQUIREMENTS)을 바꿨을 때만 전체를
다시 만듭니다. 소스만 만들 때는 기존 전체 꾸러미를 지우지 않습니다.

꾸러미 구조:

    ticket-agent-offline/
      run.py              sys.path 를 맞추고 CLI 를 부릅니다
      run-agent.bat       윈도우에서 더블클릭
      .env.example
      src/ticket_agent/   소스
      lib/common/         순수 파이썬 라이브러리 (버전 무관, 한 벌)
      lib/cp310..cp314/   컴파일된 라이브러리 (파이썬 버전별)

파이썬 버전을 미리 물어보지 않아도 되도록 3.10~3.14 를 전부 담습니다.
`run.py` 가 실행 중인 인터프리터에 맞는 폴더를 골라 씁니다.

**새 파이썬이 나오면 `PY_VERSIONS` 에 추가하고 다시 만듭니다.** 목록에 없는
버전으로 실행하면 `run.py` 가 거부합니다 — 컴파일된 확장 모듈(pydantic_core,
pywin32 등)은 ABI 가 버전마다 달라서 대신 쓸 수 있는 것이 없기 때문입니다.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

AGENT = Path(__file__).resolve().parent.parent
OUT = AGENT / "dist-offline"
BUNDLE = OUT / "ticket-agent-offline"

PY_VERSIONS = ["3.10", "3.11", "3.12", "3.13", "3.14"]

# pyproject.toml 과 같은 목록입니다. 여기만 고치면 어긋나므로 함께 고치세요.
REQUIREMENTS = [
    "google-genai>=1.0",
    "supabase>=2.10",
    "python-dotenv>=1.0",
    "pywin32>=306",
]


def tag(version: str) -> str:
    return "cp" + version.replace(".", "")


def download(version: str, dest: Path) -> list[Path]:
    dest.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable, "-m", "pip", "download",
            "--dest", str(dest),
            "--platform", "win_amd64",
            "--python-version", version,
            "--only-binary=:all:",
            *REQUIREMENTS,
        ],
        check=True,
        capture_output=True,
    )
    return sorted(dest.glob("*.whl"))


def unpack(wheel: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(wheel) as zf:
        zf.extractall(target)


def agent_version() -> str:
    """`src/ticket_agent/__init__.py` 의 __version__. 파일 이름에 넣습니다."""
    text = (AGENT / "src" / "ticket_agent" / "__init__.py").read_text(encoding="utf-8")
    hit = re.search(r'__version__\s*=\s*"([^"]+)"', text)
    if not hit:
        raise SystemExit("__init__.py 에서 __version__ 을 찾지 못했습니다")
    return hit.group(1)


def build_src_only() -> int:
    """`src/ticket_agent/` + `.env.example` + `READ-ME-FIRST.txt` 만 담습니다.

    사내 PC 에서는 zip 안의 **`src` 폴더만** 설치 폴더에 덮어씁니다. `lib/`·`.env`·
    `data/` 는 zip 에 없으므로 덮어써질 일이 없습니다 — `.env.example` 은 이름이 달라
    `.env` 를 건드리지 않습니다. egg-info·캐시는 넣지 않습니다.
    """
    version = agent_version()
    OUT.mkdir(parents=True, exist_ok=True)
    archive = OUT / f"ticket-agent-src-{version}.zip"
    if archive.exists():
        archive.unlink()

    src = AGENT / "src" / "ticket_agent"
    files = sorted(
        p
        for p in src.rglob("*")
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    )
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, Path("src") / path.relative_to(AGENT / "src"))
        zf.write(AGENT / ".env.example", ".env.example")
        zf.write(AGENT / "tools" / "offline" / "READ-ME-FIRST.txt", "READ-ME-FIRST.txt")

    size_kb = archive.stat().st_size / 1024
    print(f"  완료: {archive}  ({size_kb:.0f} KB · 소스 {len(files)}개 · 버전 {version})")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="오프라인 꾸러미를 만듭니다")
    parser.add_argument(
        "--src-only",
        action="store_true",
        help="소스만 담은 zip (lib 는 그대로 두고 src 만 교체하는 배포)",
    )
    if parser.parse_args().src_only:
        return build_src_only()

    if OUT.exists():
        shutil.rmtree(OUT)
    BUNDLE.mkdir(parents=True)

    work = OUT / ".wheels"
    common = BUNDLE / "lib" / "common"
    seen_common: set[str] = set()

    for version in PY_VERSIONS:
        cp = tag(version)
        print(f"  {version} 휠 내려받는 중…", flush=True)
        wheels = download(version, work / cp)

        for wheel in wheels:
            # '-none-any.whl' 은 순수 파이썬이라 버전과 무관합니다. 한 벌만 담습니다.
            if wheel.name.endswith("-none-any.whl"):
                if wheel.name not in seen_common:
                    unpack(wheel, common)
                    seen_common.add(wheel.name)
            else:
                unpack(wheel, BUNDLE / "lib" / cp)

        n_specific = sum(1 for w in wheels if not w.name.endswith("-none-any.whl"))
        print(f"    공용 {len(wheels) - n_specific}개 · {cp} 전용 {n_specific}개")

    shutil.rmtree(work)

    # 소스와 설정 예시
    shutil.copytree(
        AGENT / "src" / "ticket_agent",
        BUNDLE / "src" / "ticket_agent",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    shutil.copy(AGENT / ".env.example", BUNDLE / ".env.example")
    shutil.copy(AGENT / "tools" / "offline" / "run.py", BUNDLE / "run.py")
    shutil.copy(AGENT / "tools" / "offline" / "run-agent.bat", BUNDLE / "run-agent.bat")
    shutil.copy(AGENT / "tools" / "offline" / "READ-ME-FIRST.txt", BUNDLE / "READ-ME-FIRST.txt")

    archive = OUT / "ticket-agent-offline.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(BUNDLE.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(BUNDLE.parent))

    size_mb = archive.stat().st_size / 1024 / 1024
    print(f"\n  완료: {archive}  ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""설치 없이 에이전트를 실행합니다.

인트라넷 환경용입니다. `pip install` 도 가상환경도 쓰지 않고, 옆에 풀어 둔
`lib/` 폴더를 `sys.path` 에 직접 얹어서 소스를 그대로 돌립니다.

    python run.py doctor
    python run.py collect
    python run.py run

pywin32 는 그냥 경로에 얹는 것만으로는 부족합니다. 정상 설치 시에는
`pywin32.pth` 가 `win32`·`win32\\lib`·`pythonwin` 을 경로에 넣고
`pywin32_bootstrap` 이 DLL 폴더를 등록해 주는데, 여기서는 그 두 가지를
직접 합니다. 안 하면 `import win32com.client` 가 DLL 을 못 찾습니다.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
LIB = ROOT / "lib"
TAG = f"cp{sys.version_info.major}{sys.version_info.minor}"


def fail(message: str) -> int:
    print(f"\n  [X] {message}\n", file=sys.stderr)
    return 2


def main() -> int:
    if sys.version_info < (3, 10):
        return fail(
            f"파이썬 3.10 이상이 필요합니다 (지금: {sys.version.split()[0]})."
        )

    version_lib = LIB / TAG
    if not version_lib.is_dir():
        available = sorted(p.name for p in LIB.glob("cp3*")) if LIB.is_dir() else []
        return fail(
            f"이 꾸러미에 파이썬 {sys.version_info.major}.{sys.version_info.minor} 용"
            f" 라이브러리가 없습니다.\n"
            f"      꾸러미에 담긴 버전: {', '.join(available) or '(없음)'}\n"
            f"      지금 실행 중인 파이썬: {sys.executable}\n"
            f"      다른 파이썬으로 실행하거나, 해당 버전 꾸러미를 요청하세요."
        )

    # 순서가 중요합니다. 버전 전용이 공용보다 앞에 와야 하고,
    # 소스(src)가 라이브러리보다 앞에 있어야 우리 패키지가 먼저 잡힙니다.
    paths = [
        ROOT / "src",
        version_lib,
        version_lib / "win32",
        version_lib / "win32" / "lib",
        version_lib / "pythonwin",
        LIB / "common",
    ]
    for path in reversed(paths):
        if path.is_dir():
            sys.path.insert(0, str(path))

    # pywin32 의 pythoncom3XX.dll / pywintypes3XX.dll 을 찾게 해 줍니다.
    # 파이썬 3.8 부터 확장 모듈은 PATH 가 아니라 이 목록에서 DLL 을 찾습니다.
    dll_dir = version_lib / "pywin32_system32"
    if os.name == "nt" and dll_dir.is_dir():
        os.add_dll_directory(str(dll_dir))

    try:
        from ticket_agent.cli import main as cli_main
    except ImportError as exc:
        return fail(
            f"라이브러리를 불러오지 못했습니다: {exc}\n"
            f"      압축을 푼 폴더 구조가 깨졌을 수 있습니다. 다시 풀어 보세요."
        )

    return cli_main()


if __name__ == "__main__":
    raise SystemExit(main())

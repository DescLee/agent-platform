"""Launch the installed Lvzhou 3.0 desktop application."""

import subprocess
import sys


def launch_lvzhou() -> dict:
    if sys.platform != "darwin":
        return {"ok": False, "error": "当前仅支持在 macOS 自动打开绿舟3.0，请手动启动客户端"}
    try:
        result = subprocess.run(
            ["/usr/bin/open", "-b", "com.kingsoft.lvzhou3.0"],
            capture_output=True, text=True, timeout=10, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {"ok": False, "error": "无法打开绿舟3.0，请确认已安装后重试"}
    if result.returncode != 0:
        return {"ok": False, "error": "无法打开绿舟3.0，请确认已安装后重试"}
    return {"ok": True, "started": True}

"""Lifecycle helpers for connectors backed by vendor command-line tools."""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import webbrowser
from threading import Lock
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CliConnector:
    executable: str
    package: str
    connect_commands: tuple[tuple[str, ...], ...]
    status_command: tuple[str, ...]


CONNECTORS: dict[str, CliConnector] = {
    "dingtalk": CliConnector(
        executable="dws",
        package="dingtalk-workspace-cli",
        connect_commands=(("auth", "login", "-y"),),
        status_command=("auth", "status"),
    ),
    "feishu": CliConnector(
        executable="lark-cli",
        package="@larksuite/cli",
        connect_commands=(
            ("config", "init", "--new", "--lang", "en"),
            ("auth", "login", "--recommend"),
        ),
        status_command=("auth", "status"),
    ),
    "wecom": CliConnector(
        executable="wecom-cli",
        package="@wecom/cli",
        connect_commands=(("init", "--noninteractive", "--no-open"),),
        status_command=("auth", "show"),
    ),
}

_active_processes: dict[str, subprocess.Popen[str]] = {}
_active_lock = Lock()


def cancel_connect(name: str) -> bool:
    with _active_lock:
        proc = _active_processes.pop(name, None)
    if proc is None or proc.poll() is not None:
        return False
    proc.terminate()
    return True


def state(name: str) -> tuple[bool, bool]:
    spec = CONNECTORS[name]
    executable = shutil.which(spec.executable)
    if not executable:
        return False, False
    try:
        result = subprocess.run(
            [executable, *spec.status_command],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return True, False
    if result.returncode != 0:
        return True, False
    output = result.stdout.strip()
    if name == "dingtalk":
        return True, '"authenticated": true' in output.lower()
    if name == "wecom":
        return True, bool(re.search(r'"id"\s*:\s*"', output))
    try:
        return True, bool((json.loads(output) or {}).get("identity") == "user")
    except (TypeError, ValueError):
        return True, '"identity"' in output and '"user"' in output


def install_command(name: str) -> list[str]:
    return ["npm", "install", "-g", CONNECTORS[name].package, "--force"]


def connect_commands(name: str) -> list[list[str]]:
    spec = CONNECTORS[name]
    executable = shutil.which(spec.executable) or spec.executable
    return [[executable, *args] for args in spec.connect_commands]


def connect_feishu_interactive() -> subprocess.CompletedProcess[str]:
    """Run Feishu's two blocking device flows while surfacing their URLs.

    Both commands intentionally wait for browser completion. This function is
    run in a background thread by the API, so the HTTP request can return while
    the UI polls connector state.
    """
    executable = shutil.which("lark-cli") or "lark-cli"
    combined: list[str] = []
    for args in (
        ("config", "init", "--new", "--lang", "zh_cn"),
        ("auth", "login", "--recommend"),
    ):
        proc = subprocess.Popen(
            [executable, *args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        with _active_lock:
            _active_processes["feishu"] = proc
        opened: set[str] = set()
        started = time.monotonic()
        assert proc.stdout is not None
        while True:
            line = proc.stdout.readline()
            if line:
                combined.append(line)
                for url in re.findall(r"https?://[^\s\"'<>]+", line):
                    url = url.rstrip(".,);]")
                    if url not in opened:
                        opened.add(url)
                        webbrowser.open(url)
            elif proc.poll() is not None:
                break
            if time.monotonic() - started > 300:
                proc.terminate()
                return subprocess.CompletedProcess(proc.args, 124, "".join(combined), "飞书连接超时")
        with _active_lock:
            if _active_processes.get("feishu") is proc:
                _active_processes.pop("feishu", None)
        if proc.returncode != 0:
            return subprocess.CompletedProcess(proc.args, proc.returncode, "".join(combined), "")
    return subprocess.CompletedProcess([executable, "connect"], 0, "".join(combined), "")


def reset(name: str) -> subprocess.CompletedProcess[str]:
    spec = CONNECTORS[name]
    executable = shutil.which(spec.executable) or spec.executable
    if name == "wecom":
        config_dir = Path.home() / ".config" / "wecom"
        shutil.rmtree(config_dir, ignore_errors=True)
        return subprocess.CompletedProcess(["reset", str(config_dir)], 0, "", "")
    args = ("auth", "reset", "-y") if name == "dingtalk" else ("config", "remove")
    return subprocess.run([executable, *args], capture_output=True, text=True, timeout=300)

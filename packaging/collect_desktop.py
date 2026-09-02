"""Collect native installers and self-contained desktop bundles (no private state)."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def require(path: Path) -> Path:
    if not path.exists():
        raise ValueError(f"Missing build output: {path}")
    return path


def collect(target: str, output: Path) -> Path:
    config = json.loads((ROOT / "surfaces/gui/src-tauri/tauri.conf.json").read_text())
    version = config["version"]
    host = (platform.system(), platform.machine().lower())
    expected = {"macos-arm64": ("Darwin", {"arm64", "aarch64"}),
                "macos-x64": ("Darwin", {"x86_64"}),
                "windows-x64": ("Windows", {"amd64", "x86_64"})}[target]
    if host[0] != expected[0] or host[1] not in expected[1]:
        raise ValueError(f"{target} must be built/collected natively; host is {host}")
    release = ROOT / "surfaces/gui/src-tauri/target/release"
    bundle = release / "bundle"
    destination = output.resolve() / f"OpenWorker-{version}-{target}"
    if destination.exists():
        raise ValueError(f"Refusing to overwrite: {destination}")
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="desktop-package-", dir=output) as temp:
        stage = Path(temp)
        if target.startswith("macos"):
            app = require(bundle / "macos" / f"{config['productName']}.app")
            require(app / "Contents/Resources/sidecar/openworker-server")
            installers = list((bundle / "dmg").glob(f"*_{version}_*.dmg"))
            if len(installers) != 1:
                raise ValueError(f"Expected exactly one versioned DMG, found {len(installers)}")
            shutil.copy2(installers[0], stage / f"OpenWorker-{version}-{target}.dmg")
            # ditto preserves bundle symlinks and executable metadata on macOS.
            subprocess.run(["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent",
                            str(app), str(stage / f"OpenWorker-{version}-{target}.app.zip")], check=True)
            instructions = "安装：打开 DMG，将绿巨人拖入 Applications。\n免安装：解压 app.zip，打开绿巨人.app。"
        else:
            for folder, suffix in (("nsis", "exe"), ("msi", "msi")):
                matches = list((bundle / folder).glob(f"*.{suffix}"))
                if len(matches) != 1:
                    raise ValueError(f"Expected one {suffix} installer, found {len(matches)}")
                shutil.copy2(matches[0], stage / f"OpenWorker-{version}-{target}-setup.{suffix}")
            with tempfile.TemporaryDirectory(prefix="desktop-portable-") as portable_temp:
                portable = Path(portable_temp) / "OpenWorker"
                portable.mkdir()
                shutil.copy2(require(release / "lvjuren.exe"), portable / "lvjuren.exe")
                sidecar = require(ROOT / "surfaces/gui/src-tauri/binaries/sidecar")
                require(sidecar / "openworker-server.exe")
                shutil.copytree(sidecar, portable / "sidecar")
                shutil.make_archive(str(stage / f"OpenWorker-{version}-{target}-portable"),
                                    "zip", portable.parent, portable.name)
            instructions = "安装：运行 setup.exe 或 setup.msi（二选一）。\n免安装：解压 portable.zip，运行 OpenWorker/lvjuren.exe；不要移动或删除 sidecar。\nWindows 需已安装 Microsoft Edge WebView2 Runtime；安装包可引导安装，免安装包不包含此系统运行时。"
        (stage / "使用说明.txt").write_text(instructions + "\n首次运行通过界面配置模型。未包含 API Key、登录 Cookie、个人数据库。\n此构建未保证签名/公证；系统可能阻止启动，请按组织安全要求审批，不自动关闭安全保护。\n", encoding="utf-8")
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        files = {}
        for file in stage.iterdir():
            if file.is_file():
                digest = hashlib.sha256()
                with file.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                files[file.name] = {"sha256": digest.hexdigest(), "bytes": file.stat().st_size}
        (stage / "manifest.json").write_text(json.dumps({"version": version, "target": target,
            "commit": commit, "files": files, "launch_test": "manual verification required"}, ensure_ascii=False, indent=2), encoding="utf-8")
        shutil.copytree(stage, destination)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=["macos-arm64", "macos-x64", "windows-x64"])
    parser.add_argument("--output", type=Path, default=ROOT / "out/desktop")
    args = parser.parse_args()
    print(collect(args.target, args.output))

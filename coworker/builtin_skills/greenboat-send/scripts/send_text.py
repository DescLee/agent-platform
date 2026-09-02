#!/usr/bin/env python3
"""CLI helper for manually testing the bundled greenboat-send skill."""

from __future__ import annotations

import argparse
import json

from coworker.lvzhou import KimIpcClient, KimIpcError


def main() -> int:
    parser = argparse.ArgumentParser(description="Send text to the current Lvzhou self chat")
    parser.add_argument("text", help="plain-text message")
    args = parser.parse_args()
    try:
        result = KimIpcClient().send_self_text(args.text)
    except KimIpcError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "message_id": result.get("id"), "status": result.get("status")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

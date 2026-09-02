"""Agent-facing tools for the bundled Lvzhou skill."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from typing import Any, Callable

import aisuite as ai

from .client import KimIpcClient, KimIpcError

_SCHEMA = {
    "type": "function",
    "function": {
        "name": "send_lvzhou_self_message",
        "description": (
            "Send a plain-text message to the currently logged-in user's own Lvzhou self chat. "
            "This version intentionally cannot send to other people or groups. Use only when "
            "the user explicitly asks to send a Lvzhou message."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The plain-text message to send."}
            },
            "required": ["text"],
        },
    },
}


def lvzhou_tools(client: KimIpcClient | None = None) -> list[Callable[..., Any]]:
    """Build the approval-gated Lvzhou self-message tool."""
    # Keep the complete send flow bounded. It performs status, chat lookup and
    # send RPCs, so a per-RPC timeout alone could leave one tool call waiting
    # several times longer than the UI expects.
    # Chat-list responses include latest-message payloads and can take several
    # seconds to serialize in the desktop client. Keep each RPC bounded, but
    # do not use a deadline shorter than the service's normal response time.
    kim = client or KimIpcClient(timeout=10.0)

    def send_lvzhou_self_message(text: str) -> dict[str, Any]:
        # Bound the whole multi-RPC operation. A socket timeout alone does not
        # protect the agent if a client implementation gets stuck between RPCs.
        last_error = "绿舟发送失败"
        for attempt in range(2):
            executor = ThreadPoolExecutor(max_workers=1)
            try:
                future = executor.submit(kim.send_self_text, text)
                message = future.result(timeout=30.0)
                break
            except FutureTimeoutError:
                last_error = "绿舟发送超时（30 秒），请确认绿舟客户端仍在运行"
            except KimIpcError as exc:
                last_error = str(exc)
            finally:
                executor.shutdown(wait=False, cancel_futures=True)
            # sendMessage may have been committed even when its response was
            # lost. Verify persistence before retrying, otherwise a retry can
            # duplicate the user's message.
            try:
                persisted = kim.find_recent_self_text(text)
            except KimIpcError:
                persisted = None
            if persisted is not None:
                message = persisted
                break
        else:
            return {"error": f"{last_error}；已重试 1 次仍失败"}
        return {
            "ok": True,
            "message_id": str(message.get("id") or ""),
            "uuid": str(message.get("uuid") or ""),
            "chat_id": str(message.get("targetId") or ""),
            "sender_uid": str(message.get("senderUid") or ""),
            "status": message.get("status"),
            "text": message.get("content", {}).get("text", ""),
        }

    send_lvzhou_self_message.__name__ = _SCHEMA["function"]["name"]
    send_lvzhou_self_message.__doc__ = _SCHEMA["function"]["description"]
    send_lvzhou_self_message.__aisuite_tool_metadata__ = ai.ToolMetadata(
        name=send_lvzhou_self_message.__name__,
        category="messaging",
        risk_level="medium",
        capabilities=["messaging", "lvzhou"],
        requires_approval=True,
    )
    send_lvzhou_self_message.__coworker_schema__ = _SCHEMA
    return [send_lvzhou_self_message]

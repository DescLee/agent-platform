"""Agent-facing tools for the bundled Lvzhou skill."""

from __future__ import annotations

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
    kim = client or KimIpcClient()

    def send_lvzhou_self_message(text: str) -> dict[str, Any]:
        try:
            message = kim.send_self_text(text)
        except KimIpcError as exc:
            return {"error": str(exc)}
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

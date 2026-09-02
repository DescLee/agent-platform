"""Tests for the bundled Lvzhou KIM IPC integration."""

from __future__ import annotations

import json

import pytest

from coworker.lvzhou import KimIpcClient, KimIpcError
from coworker.lvzhou.client import PREFIX, SUFFIX, decode_packet, decode_serialized_body, encode_request
from coworker.lvzhou.tools import lvzhou_tools


def _packet(body: object, *, correlation_id: str = "request") -> bytes:
    metadata = json.dumps(
        {"correlationId": correlation_id, "type": "ResultResponse"},
        separators=(",", ":"),
    ).encode()
    payload = json.dumps(body, ensure_ascii=False).encode()
    return PREFIX + len(metadata).to_bytes(2, "big", signed=True) + b"\x01" + metadata + payload + SUFFIX


def test_encode_request_uses_kim_path_and_json_payload():
    request_id, packet = encode_request("sendMessage", ["120356", {"type": "kim-text"}], request_id="abc")
    assert request_id == "abc"
    assert b'"path":"/KimService/sendMessage"' in packet
    assert b'["120356",{"type":"kim-text"}]' in packet


def test_decode_packet_and_direct_json_body():
    packet = _packet({"id": "3515170"})
    assert decode_packet(packet)["body"] == {"id": "3515170"}
    assert decode_serialized_body(b'{"ok":true}') == {"ok": True}


def test_send_self_text_rechecks_uid_chat_and_online():
    client = KimIpcClient()
    calls = []

    def call(method, payload):
        calls.append((method, payload))
        if method == "getStatus":
            return {"initialized": True, "status": 2, "isOnline": True, "uid": "u-1"}
        if method == "getChatList":
            return {"chats": [{"id": "chat-1", "type": 1, "uid": "u-1"}]}
        if method == "sendMessage":
            return {
                "id": "m-1",
                "uuid": "uuid-1",
                "status": 3,
                "senderUid": "u-1",
                "targetId": "chat-1",
                "type": "kim-text",
                "content": {"text": "hello"},
            }
        raise AssertionError(method)

    client.call = call
    result = client.send_self_text(" hello ")
    assert result["id"] == "m-1"
    assert calls[-1] == (
        "sendMessage",
        ["chat-1", {"type": "kim-text", "content": {"text": "hello"}}],
    )


def test_send_self_text_rejects_offline_and_empty_text():
    client = KimIpcClient()
    client.call = lambda method, payload: (
        {"initialized": True, "status": 1, "isOnline": False, "uid": "u-1"}
        if method == "getStatus"
        else {"chats": [{"id": "chat-1", "type": 1, "uid": "u-1"}]}
    )
    with pytest.raises(KimIpcError, match="不在线"):
        client.send_self_text("hello")
    with pytest.raises(KimIpcError, match="不能为空"):
        client._send_text("chat-1", "  ")


def test_tool_is_approval_gated_and_only_accepts_text():
    class Stub:
        def send_self_text(self, text):
            return {"id": "m-1", "uuid": "u-1", "targetId": "chat-1", "senderUid": "u-1", "status": 3, "content": {"text": text}}

    tool = lvzhou_tools(Stub())[0]
    assert tool.__aisuite_tool_metadata__.requires_approval is True
    assert tool("hello")["message_id"] == "m-1"

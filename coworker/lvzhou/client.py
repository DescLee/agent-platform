"""Client for the Unix socket exposed by Lvzhou's local KIM engine."""

from __future__ import annotations

import json
import os
import socket
import stat
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Optional

PREFIX = b".kcore."
SUFFIX = b"$_\x0c_$"
_SOCKET_PATTERN = "app_*.kim.engine"


class KimIpcError(RuntimeError):
    """Raised when Lvzhou's local KIM engine cannot complete a request."""


def find_engine_socket(temp_dir: Optional[str | Path] = None) -> Path:
    """Return the newest live-looking KIM Unix socket in the OS temp directory."""
    directory = Path(temp_dir) if temp_dir is not None else Path(tempfile.gettempdir())
    candidates: list[tuple[int, Path]] = []
    for path in directory.glob(_SOCKET_PATTERN):
        try:
            info = path.stat()
        except OSError:
            continue
        if stat.S_ISSOCK(info.st_mode):
            candidates.append((info.st_mtime_ns, path))
    if not candidates:
        raise KimIpcError("未找到绿舟本地消息引擎，请先启动绿舟客户端")
    return max(candidates, key=lambda item: item[0])[1]


def encode_request(
    method: str,
    payload: Any = None,
    *,
    request_id: Optional[str] = None,
) -> tuple[str, bytes]:
    """Encode one JSON unary request using KIM's local framing protocol."""
    correlation_id = request_id or uuid.uuid4().hex
    body = json.dumps(
        {} if payload is None else payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    metadata = json.dumps(
        {
            "id": correlation_id,
            "correlationId": correlation_id,
            "path": f"/KimService/{method}",
            "origin": "Client",
            "type": "UnaryRequest",
            "createTime": str(int(time.time() * 1000)),
            "body": {},
        },
        separators=(",", ":"),
    ).encode("utf-8")
    if len(metadata) > 0x7FFF:
        raise KimIpcError("绿舟请求元数据过大")
    header = len(metadata).to_bytes(2, "big", signed=True) + b"\x01"
    return correlation_id, PREFIX + header + metadata + body + SUFFIX


def _restore_embedded_buffers(value: Any, body: bytes, depth: int = 2) -> Any:
    if depth < 0 or not isinstance(value, (dict, list)):
        return value
    if isinstance(value, dict) and value.get("t") == "TypeOfU8A":
        offset, size = int(value["o"]), int(value["s"])
        if offset < 0 or size < 0 or offset + size > len(body):
            raise ValueError("embedded buffer is incomplete")
        return body[offset : offset + size]
    if isinstance(value, list):
        return [_restore_embedded_buffers(item, body, depth - 1) for item in value]
    return {
        key: _restore_embedded_buffers(item, body, depth - 1)
        for key, item in value.items()
    }


def decode_serialized_body(body: bytes) -> Any:
    """Decode KIM's direct JSON or 64-byte descriptor based response body."""
    if not body:
        return None
    if len(body) < 64:
        return json.loads(body.decode("utf-8"))

    descriptor_bytes = body[:64].lstrip(b"\x00")
    try:
        descriptor = json.loads(descriptor_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return json.loads(body.decode("utf-8"))

    if descriptor.get("t") == "TypeOfU8A":
        offset, size = int(descriptor["o"]), int(descriptor["s"])
        if offset < 0 or size < 0 or offset + size > len(body):
            raise ValueError("serialized buffer is incomplete")
        return body[offset : offset + size]
    if descriptor.get("t") != "TypeOfJson":
        return json.loads(body.decode("utf-8"))
    offset, size = int(descriptor["o"]), int(descriptor["s"])
    if offset < 0 or size < 0 or offset + size > len(body):
        raise ValueError("serialized JSON is incomplete")
    value = json.loads(body[offset : offset + size].decode("utf-8"))
    return _restore_embedded_buffers(value, body)


def decode_packet(packet: bytes) -> dict[str, Any]:
    """Decode a complete KIM frame."""
    if not packet.startswith(PREFIX) or not packet.endswith(SUFFIX):
        raise KimIpcError("收到未知的绿舟后台数据包")
    frame = packet[len(PREFIX) : -len(SUFFIX)]
    if len(frame) < 3:
        raise KimIpcError("绿舟后台数据包不完整")
    metadata_size = int.from_bytes(frame[:2], "big", signed=True)
    if metadata_size < 0 or len(frame) < 3 + metadata_size:
        raise KimIpcError("绿舟后台数据包元数据不完整")
    try:
        metadata = json.loads(frame[3 : 3 + metadata_size].decode("utf-8"))
        body = decode_serialized_body(frame[3 + metadata_size :])
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, ValueError) as exc:
        raise KimIpcError("绿舟后台数据包解析失败") from exc
    return {**metadata, "body": body}


class KimIpcClient:
    """Small synchronous client for Lvzhou's local KIM service."""

    def __init__(
        self,
        *,
        timeout: float = 8.0,
        max_response_size: int = 16 * 1024 * 1024,
        temp_dir: Optional[str | Path] = None,
    ) -> None:
        self.timeout = timeout
        self.max_response_size = max_response_size
        self.temp_dir = temp_dir

    def call(self, method: str, payload: Any = None) -> Any:
        correlation_id, request = encode_request(method, payload)
        path = find_engine_socket(self.temp_dir)
        pending = b""
        deadline = time.monotonic() + self.timeout
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
                conn.settimeout(max(0.001, deadline - time.monotonic()))
                conn.connect(os.fspath(path))
                conn.sendall(request)
                while True:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise KimIpcError(f"绿舟后台接口 {method} 调用超时")
                    # A busy KIM socket can continuously deliver unrelated events.
                    # Reapply the remaining absolute deadline before every recv;
                    # a plain socket timeout is only an idle timeout and would be
                    # reset forever by that unrelated traffic.
                    conn.settimeout(remaining)
                    chunk = conn.recv(64 * 1024)
                    if not chunk:
                        break
                    pending += chunk
                    if len(pending) > self.max_response_size:
                        raise KimIpcError(f"绿舟后台接口 {method} 响应过大")
                    response, pending = self._matching_response(pending, correlation_id)
                    if response is not None:
                        if response.get("type") == "ErrorResponse":
                            reason = response.get("reason") or response.get("body")
                            raise KimIpcError(self._error_message(reason))
                        return response.get("body")
        except KimIpcError:
            raise
        except (OSError, TimeoutError) as exc:
            raise KimIpcError(f"绿舟后台接口 {method} 调用失败: {exc}") from exc
        raise KimIpcError(f"绿舟后台接口 {method} 未返回完整响应")

    @staticmethod
    def _matching_response(
        pending: bytes, correlation_id: str
    ) -> tuple[Optional[dict[str, Any]], bytes]:
        while True:
            start = pending.find(PREFIX)
            if start < 0:
                return None, pending[-(len(PREFIX) - 1) :]
            if start:
                pending = pending[start:]
            search_from = len(PREFIX)
            while True:
                end = pending.find(SUFFIX, search_from)
                if end < 0:
                    return None, pending
                boundary = end + len(SUFFIX)
                packet = pending[:boundary]
                try:
                    response = decode_packet(packet)
                except KimIpcError:
                    # Large KIM bodies can contain the delimiter bytes. Keep reading
                    # until a candidate boundary produces a complete packet.
                    search_from = boundary
                    continue
                pending = pending[boundary:]
                if response.get("correlationId") == correlation_id:
                    return response, pending
                break

    @staticmethod
    def _error_message(reason: Any) -> str:
        if isinstance(reason, dict) and reason.get("message"):
            return str(reason["message"])
        return json.dumps(reason, ensure_ascii=False) if reason is not None else "绿舟调用失败"

    def get_status(self) -> dict[str, Any]:
        status = self.call("getStatus", {})
        if not isinstance(status, dict):
            raise KimIpcError("绿舟后台返回了无效状态")
        return status

    def get_self_chat(self) -> dict[str, Any]:
        status = self.get_status()
        uid = str(status.get("uid") or "")
        if not status.get("initialized") or not uid:
            raise KimIpcError("绿舟消息引擎尚未登录")
        # Chat entries include the complete latest message/card payload. Asking
        # for 100 entries can produce a multi-megabyte response and make the
        # local KIM service miss the caller's short RPC deadline. The self chat
        # is kept among the recent entries, so keep this discovery request
        # deliberately small.
        query: dict[str, Any] = {"count": 20}
        chat = None
        # Usually the self chat is in the first page. Only request more pages
        # when needed so normal sends keep the small, fast response.
        for _ in range(5):
            result = self.call("getChatList", [query])
            chats = result.get("chats", []) if isinstance(result, dict) else []
            chat = next(
                (
                    item
                    for item in chats
                    if isinstance(item, dict)
                    and item.get("type") == 1
                    and str(item.get("uid") or "") == uid
                ),
                None,
            )
            if chat is not None:
                break
            cursor = result.get("cursor") if isinstance(result, dict) else None
            if not cursor or cursor == query.get("cursor"):
                break
            query["cursor"] = cursor
        if chat is None:
            raise KimIpcError("没有在绿舟后台找到当前账号的本人自聊会话")
        return {"status": status, "chat": chat}

    def _send_text(self, chat_id: str, text: str) -> dict[str, Any]:
        """Send plain text to a chat after the caller has performed target checks."""
        normalized = text.strip()
        if not normalized:
            raise KimIpcError("消息内容不能为空")
        result = self.call(
            "sendMessage",
            [str(chat_id), {"type": "kim-text", "content": {"text": normalized}}],
        )
        if not isinstance(result, dict):
            raise KimIpcError("绿舟发送接口返回了无效结果")
        return result

    def send_self_text(self, text: str) -> dict[str, Any]:
        """Send text to the currently logged-in user's verified self chat."""
        current = self.get_self_chat()
        status, chat = current["status"], current["chat"]
        uid, chat_id = str(status["uid"]), str(chat["id"])
        if status.get("isOnline") is False or status.get("status") != 2:
            raise KimIpcError("绿舟当前不在线，无法发送消息")
        message = self._send_text(chat_id, text)
        if (
            str(message.get("senderUid") or "") != uid
            or str(message.get("targetId") or "") != chat_id
            or message.get("type") != "kim-text"
            or message.get("status") != 3
        ):
            raise KimIpcError("绿舟返回的消息结果与本人自聊不匹配")
        return message

    def find_recent_self_text(self, text: str) -> dict[str, Any] | None:
        """Find a recently persisted self-chat message by exact text."""
        current = self.get_self_chat()
        chat_id = str(current["chat"]["id"])
        result = self.call("getHistoryMessages", [chat_id, {"count": 20, "order": 1}])
        messages = result.get("messages", []) if isinstance(result, dict) else []
        for message in messages:
            if message.get("type") == "kim-text" and message.get("content", {}).get("text") == text.strip():
                return message
        return None

    def get_chats_for_date(self, date: str) -> list[dict[str, Any]]:
        """Return chat groups containing messages sent on an ISO date.

        KIM returns large latest-message payloads, so this deliberately uses
        small pages and bounds both chat and history traversal.
        """
        from datetime import datetime, time, timedelta
        from zoneinfo import ZoneInfo

        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise KimIpcError("日期格式必须为 YYYY-MM-DD") from exc
        tz = ZoneInfo("Asia/Shanghai")
        start = datetime.combine(day, time.min, tzinfo=tz).timestamp() * 1000
        end = (datetime.combine(day, time.min, tzinfo=tz) + timedelta(days=1)).timestamp() * 1000
        result: list[dict[str, Any]] = []
        chats_result = self.call("getChatList", [{"count": 20}])
        chats = chats_result.get("chats", []) if isinstance(chats_result, dict) else []
        for chat in chats[:10]:
            if not isinstance(chat, dict) or not chat.get("id"):
                continue
            messages: list[dict[str, Any]] = []
            query: dict[str, Any] = {"count": 20, "order": 1}
            try:
                # The list endpoint is a summary view. One small history page
                # is enough to determine whether this recent conversation has
                # messages in the requested window; full paging belongs to the
                # detail endpoint.
                for _ in range(1):
                    page = self.call("getHistoryMessages", [str(chat["id"]), query])
                    rows = page.get("messages", []) if isinstance(page, dict) else []
                    messages.extend(
                        m for m in rows
                        if isinstance(m, dict) and start <= float(m.get("sentTime") or 0) < end
                    )
                    if rows and min(float(m.get("sentTime") or 0) for m in rows) < start:
                        break
                    cursor = page.get("cursor") if isinstance(page, dict) else None
                    if not cursor or cursor == query.get("cursor"):
                        break
                    query["cursor"] = cursor
            except KimIpcError:
                continue
            if messages:
                result.append({
                    "id": str(chat["id"]),
                    "name": chat.get("name") or str(chat["id"]),
                    "type": chat.get("type"),
                    "unreadCount": int(chat.get("unreadCount") or 0),
                    "messages": sorted(messages, key=lambda m: float(m.get("sentTime") or 0)),
                })
        return result

    @staticmethod
    def _parse_range(start: str, end: str) -> tuple[float, float]:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        try:
            tz = ZoneInfo("Asia/Shanghai")
            left = datetime.fromisoformat(start).replace(tzinfo=tz) if len(start) == 16 else datetime.fromisoformat(start)
            right = datetime.fromisoformat(end).replace(tzinfo=tz) if len(end) == 16 else datetime.fromisoformat(end)
            values = left.timestamp() * 1000, right.timestamp() * 1000
        except ValueError as exc:
            raise KimIpcError("时间格式必须为 YYYY-MM-DDTHH:MM") from exc
        if values[0] >= values[1]:
            raise KimIpcError("结束时间必须晚于开始时间")
        return values

    def get_conversation_messages(self, conversation_id: str, start: str, end: str, unread: str = "all", page_size: int = 20, cursor: str | None = None, chat: dict[str, Any] | None = None) -> dict[str, Any]:
        start_ms, end_ms = self._parse_range(start, end)
        if unread not in {"all", "only", "exclude"}:
            raise KimIpcError("unread 必须是 all、only 或 exclude")
        # getChat is slow/unreliable on some desktop versions. The list result
        # already supplies the metadata we need, and individual messages carry
        # their own read status, so never block a detail request on getChat.
        chat = chat or {"id": str(conversation_id)}
        last_read = str(chat.get("lastReadSeq") or "") if isinstance(chat, dict) else ""
        rows: list[dict[str, Any]] = []
        query: dict[str, Any] = {"count": max(1, min(int(page_size), 100)), "order": 1}
        if cursor:
            query["cursor"] = cursor
        next_cursor = None
        for _ in range(20):
            page = self.call("getHistoryMessages", [str(conversation_id), query])
            messages = page.get("messages", []) if isinstance(page, dict) else []
            for message in messages:
                if not isinstance(message, dict):
                    continue
                sent = float(message.get("sentTime") or 0)
                read_status = message.get("messageReadStatus")
                is_unread = (
                    isinstance(read_status, dict) and read_status.get("isRead") is False
                ) or bool(last_read and str(message.get("seq") or "") > last_read)
                if start_ms <= sent < end_ms and (unread == "all" or is_unread == (unread == "only")):
                    content = message.get("content") if isinstance(message.get("content"), dict) else {}
                    rows.append({
                        "id": str(message.get("id") or ""),
                        "sender_uid": str(message.get("senderUid") or ""),
                        "sent_time": int(sent),
                        "type": str(message.get("type") or ""),
                        "text": str(content.get("text") or content.get("name") or ""),
                        "is_read": not is_unread,
                    })
            if messages and min(float(m.get("sentTime") or 0) for m in messages) < start_ms:
                break
            next_cursor = page.get("cursor") if isinstance(page, dict) else None
            if not next_cursor or next_cursor == query.get("cursor"):
                break
            break
        return {"conversation": {"id": str(chat.get("id") or conversation_id), "name": chat.get("name") or str(conversation_id), "type": chat.get("type")}, "messages": sorted(rows, key=lambda m: m["sent_time"]), "next_cursor": next_cursor}

"""Engine assembly from an Agent (Code / Chat / …).

Wires the agent's base tools + permissions + AGENTS.md (workspace agents) + memory +
the skill catalog (progressive disclosure) + load_skill into a TurnEngine.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

from .agents import Agent, AgentContext, code_agent
from .automation import scheduling_tools
from .selfwake import selfwake_tools
from .subscriptions import subscription_tools
from .config import load_config
from .connectors import (
    connector_list,
    load_settings,
    make_integration_tools,
    make_send_file_tool,
    make_send_message_tool,
)
from .engine import Approver, TurnEngine
from .environment import environment_context
from .memory import (
    MemoryStore,
    Scope,
    format_user_rules,
    memory_tools,
    render_memory_block,
)
from .lvzhou import lvzhou_tools
from .permissions import Mode, PermissionEngine
from .project import load_agents_md
from . import session_facts
from .roots import RootDir, normalize_roots, render_context
from .providers import ProviderClient, ProviderRouter
from .overrides import RiskOverrideStore
from .secrets import SecretStore, state_dir
from .skills import (
    BUILTIN_SKILLS_DIR,
    SkillLoader,
    save_skill_tool,
    skill_catalog_text,
    skill_tools,
)
from .tools import ToolRegistry
from .tools.ask import ask_user_tool
from .tools.directories import request_directory_tool
from .tools.plan import propose_plan_tool
from .tools.toolreq import request_tool_tool
from .tools.subagent import explorer_tools
from .web import make_web_fetch_tool, make_web_search_tool
from .workspace_trust import WorkspaceTrustStore
from .tools.shell import LocalExecutor
from .tools.todo import TodoList

# Appended each turn while discuss mode is active: enforcement-only read-only, with no
# pressure toward a plan proposal (that's what distinguishes it from plan mode).
_DISCUSS_MODE_CONTEXT = """\
Discuss mode is active: write and shell tools are disabled. Explore and answer freely; if
the user asks for a change, describe it in chat instead of attempting it (they can switch
to plan or approval mode to have you make it)."""

# Appended to the latest user message every turn while plan mode is active. The mode can
# flip mid-session (plan approval), so this can't live in the static instructions.
_PLAN_MODE_CONTEXT = """\
当前处于计划模式：写入和 Shell 工具已被禁用。请只读探索并设计实施方案。确定方案后，使用
`propose_plan` 提交计划，说明要修改什么、涉及哪些文件以及如何验证；不要把尚未实施的修改描述成
已经执行。如果计划获批，本会话会切换到执行模式并由你实施；如果被拒绝，请根据反馈修订计划。"""

# When-to-remember rules (MEMORY-SPEC §4.2), injected only when a memory store is wired.
# Without these, models either never call `remember` or save noise the repo already
# records. The conservative bias is deliberate: a wrong memory feels broken and creepy at
# once; a missing one merely means the user repeats themselves.
_MEMORY_GUIDANCE = """\
记忆：
- 你拥有跨会话的持久记忆。使用 `remember` 保存长期有效的事实，包括用户纠正和明确偏好（记录原因），
  以及无法从代码重新推导的项目背景。关于用户的事实使用 `global`，关于当前工作的事实使用 `workspace`；
  保存完整内容时同时提供不超过 15 个字的一行摘要。
- 谨慎保存，错误记忆比缺失记忆危害更大。只保存明确长期有效的内容，例如“今后”“一直”“所有对话”。
  含糊的一次性表达只应用于当前任务，不保存；用户明确要求记住时则必须保存。
- 健康、财务、关系、信仰等敏感话题不得静默保存，必须先询问用户，得到同意后再保存。
- 保存后在可见回复中用一句话告知。某条记忆首次影响本会话行为时，也用一句简短说明告知，仅首次说明。
- 不保存仓库已有记录（代码结构、Git 历史、AGENTS.md）或只对当前任务有用的细节。使用绝对日期，不写“昨天”。
- 保存前检查已知记忆：已有相关条目时用 `memory_update` 更新，避免近似重复；错误或过时内容用 `memory_forget` 清理。
- 记忆反映写入时的状态。若涉及文件、功能开关或 URL，使用前先确认其仍然存在。"""

# Injected INSTEAD of the memory guidance when the user turned memory off (§4.3).
# Off means "stop LEARNING", not "forget what you know": already-saved memories stay
# injected and usable; only the write tools are gone. Without this notice the model
# bluffs — asked to "remember" with no remember tool, it narrated a fake save through
# its todo list ("I'll remember that your favorite color is blue"), observed live
# 2026-07-28. Honesty needs the model to KNOW saving is off, not just lack the tools.
_MEMORY_OFF_NOTICE = """\
用户已在设置中关闭新增记忆。已有的已知记忆仍然有效，应继续使用；但你无法保存、修改或删除记忆，
本次对话的新信息也不会带入未来会话。如果用户要求记住新内容，应明确说明：本次对话中会留意，但会话
结束后不会保存；用户可在“设置 ▸ 记忆”中重新开启。不得暗示已保存、已记录或未来会记住新内容。"""

# UX-015 (§33): the GUI interleaves these status lines with humanized tool rows inside a
# collapsed "turn" — they're what the user reads while the agent works. Universal (appended
# for every persona); models that ignore it degrade gracefully to a turn with no narration.
_NARRATION_GUIDANCE = """\
过程说明：每批工具调用前，用一句简短直白的话说明正在做什么以及原因。该内容会作为实时进度展示给
用户。无需说明琐碎的单次跟进调用，不要重复上一条说明，也不能用过程说明代替最终答复。"""

# A bare "hey" answered with a bare "hey" makes a specialist read as an empty chat box
# (owner catch 2026-08-24). First contact is the one moment to show what this coworker
# is for — after that, greetings stay lightweight.
_FIRST_CONTACT_GUIDANCE = """\
首次交流：如果用户第一条消息只是问候或开放式问题，而不是具体任务，不要只回复问候。先用一两句话
说明当前角色能做什么，再通过 ask_user 提供两到三个结合本会话上下文（工作区、已连接工具）的具体
起点，选项名称应简短，并允许用户自由输入。用户选定后应直接开始执行。保持简短；如果用户已经给出
任务，则跳过本流程。"""


def _enabled_connector_tools(secrets: SecretStore) -> tuple[set[str], set[str]]:
    connectors = {c["name"]: c for c in connector_list(secrets)}
    enabled_connectors = {
        name
        for name, c in connectors.items()
        if c.get("connected") and c.get("enabled")
    }
    enabled_tools = {
        tool["name"]
        for c in connectors.values()
        if c.get("name") in enabled_connectors
        for tool in c.get("tools", [])
        if tool.get("enabled")
    }
    return enabled_connectors, enabled_tools


def _loaded_skill_names(messages: list[dict[str, Any]]) -> set[str]:
    """Skills whose instructions successfully entered THIS conversation (a load_skill call
    with a non-error result). Drives the disable countermand: a menu quietly shrinking is
    passive, but instructions already in history keep steering the model unless it is
    explicitly asked to stop."""
    import json as _json

    results: dict[str, str] = {}
    for m in messages:
        if m.get("role") == "tool" and m.get("tool_call_id"):
            content = m.get("content")
            results[m["tool_call_id"]] = (
                content if isinstance(content, str) else _json.dumps(content)
            )
    loaded: set[str] = set()
    for m in messages:
        if m.get("role") != "assistant" or not m.get("tool_calls"):
            continue
        for tc in m["tool_calls"]:
            fn = tc.get("function") or {}
            if fn.get("name") != "load_skill":
                continue
            try:
                name = str(_json.loads(fn.get("arguments") or "{}").get("name", ""))
            except Exception:
                continue
            result = results.get(tc.get("id", ""), "")
            if name and '"instructions"' in result:
                loaded.add(name)
    return loaded


def _skill_dirs(workspace: Optional[Path]) -> list[Path]:
    dirs = [BUILTIN_SKILLS_DIR, state_dir() / "skills"]
    if workspace is not None:
        dirs.append(workspace / ".coworker" / "skills")
    return dirs


def build_engine(
    *,
    agent: Agent,
    workspace: Optional[str | Path] = None,
    model: str = "gpt-5.6-sol",
    mode: Mode = Mode.INTERACTIVE,
    approver: Optional[Approver] = None,
    provider: Optional[ProviderClient] = None,
    allowed_commands: Optional[list[str]] = None,
    max_iterations: Optional[int] = None,
    model_settings: Optional[dict[str, Any]] = None,
    memory_store: Optional[MemoryStore] = None,
    # Twentieth pass: the project key memory loads/saves under. Defaults to the
    # workspace path; the manager passes the resolved key (binding > git > path)
    # so all worktrees of a repo share one memory and named bindings work.
    memory_workspace: Optional[str] = None,
    # MEMORY-SPEC §5.1: called with the MemoryItem right after `remember` persists it —
    # the manager uses this to push the memory_saved event that powers the save toast.
    on_memory_saved: Optional[Any] = None,
    # MEMORY-SPEC §6: the user's standing rules (Settings textarea). Injected verbatim
    # above auto memories; independent of the memory on/off switch. No tool writes it.
    # A CALLABLE is read per turn (the server passes one so a Settings edit reaches
    # conversations already open); a plain string is a fixed value for CLI/tests.
    user_rules: Optional[Any] = None,
    # True when the user turned memory OFF in Settings (vs. memory simply not wired):
    # injects the honesty notice so the model says so instead of faking a save.
    memory_off: bool = False,
    # LIVE saving switch, consulted per write so turning memory off applies to
    # conversations already running (the registry is fixed at build, so the tool stays
    # and refuses). Same pattern as the skills menu's live filter.
    memory_saving_enabled: Optional[Any] = None,
    messages: Optional[list[dict[str, Any]]] = None,
    extra_tools: Optional[list[Any]] = None,
    secrets: Optional[SecretStore] = None,
    task_store: Optional[Any] = None,
    wake_store: Optional[Any] = None,
    session_id: Optional[str] = None,
    audit_sink: Optional[Any] = None,
    roots: Optional[list] = None,
    directory_requester: Optional[Any] = None,
    plan_approver: Optional[Any] = None,
    question_asker: Optional[Any] = None,
    tool_requester: Optional[Any] = None,
    team_approver: Optional[Any] = None,
    items_approver: Optional[Any] = None,
    subscription_store: Optional[Any] = None,
    channel_buffer: Optional[Any] = None,
    routing_targets: Optional[list[str]] = None,
    connector_filter: Optional[set[str]] = None,
    # A set (static snapshot) or a zero-arg callable (live, re-evaluated per load_skill).
    skill_filter: Optional[set[str] | Callable[[], set[str]]] = None,
    # Auto-Approve flags (spec Part 8 / §1.5). None ⇒ read the config.toml value; the server
    # passes its prefs-backed booleans so the GUI Settings toggle takes effect. Both stores
    # are user-global, preserving the "a repo can't enable this" invariant.
    auto_approve: Optional[bool] = None,
    auto_approve_shadow: Optional[bool] = None,
    # Persona-carried skill folders (OPE-58): the bundle's skills/ dir joins the loader so
    # its skills are readable by load_skill, not just listed by the filter.
    extra_skill_dirs: Optional[list[str | Path]] = None,
) -> TurnEngine:
    """根据会话上下文组装一个可运行的 TurnEngine。

    组装过程把 provider、工具注册表、工作区执行器、权限引擎、技能过滤器和各种
    交互回调连接起来；这些依赖被集中注入后，TurnEngine 可以专注于回合编排。函数
    不负责执行模型请求，也不负责保存会话，调用方应在得到引擎后通过 ``run`` 驱动，
    并由 SessionManager 在适当时机持久化。
    """
    ws = Path(workspace).expanduser().resolve() if workspace else None
    if agent.requires_folder and ws is None:
        raise ValueError(f"agent '{agent.name}' requires a workspace")

    # The session's directories. Explicit `roots` (orphan Cowork: scratch + added folders) wins;
    # otherwise the single workspace is the sole writable root. One shared, mutable list flows to
    # the file tools, the permission engine, and the context injector so add/remove is seen by all.
    if roots:
        root_list: list[RootDir] = normalize_roots(roots)
    elif ws is not None:
        root_list = [RootDir(path=ws, writable=True)]
    else:
        root_list = []

    workspace_trusted = bool(ws and WorkspaceTrustStore().is_trusted(ws))
    config = load_config(ws, workspace_trusted=workspace_trusted)
    executor = LocalExecutor(cwd=ws) if ws is not None else None
    todo = TodoList()
    context = AgentContext(
        workspace=ws, executor=executor, todo=todo, roots=root_list or None
    )

    registry = ToolRegistry()
    registry.register_all(agent.build_tools(context))
    # MCP / connector tools (supplied by the manager) carry their own metadata + schema.
    if extra_tools:
        registry.register_all(extra_tools)
    # Messaging personas (Cowork / Ops / MyHelper) expose send_message; MyHelper also uses it as
    # the reply path for inbound Telegram/Slack super-agent sessions. DingTalk credentials live
    # in the DWS CLI rather than ConnectorSettings, so include its connector status explicitly.
    secrets = secrets or SecretStore()
    dingtalk_connected = any(
        c.get("name") == "dingtalk" and c.get("connected") and c.get("enabled")
        for c in connector_list(secrets)
    )
    # Lvzhou is a local desktop KIM engine, so it does not depend on connector tokens.
    # Every surface may load skills; expose the matching approval-gated tool everywhere.
    # Session-level connector_filter is the source of truth here. The Sources
    # drawer can enable Lvzhou for a newly created session even when the global
    # connector profile's opt-in flag has not been persisted yet.
    if (connector_filter is not None and "lvzhou" in connector_filter) or (
        connector_filter is None
        and any(c.get("name") == "lvzhou" and c.get("connected") and c.get("enabled") for c in connector_list(secrets))
    ):
        registry.register_all(lvzhou_tools())
    if agent.messaging and (any(s.enabled for s in load_settings(secrets).values()) or dingtalk_connected):
        registry.register(make_send_message_tool(secrets))
        # send_file (§34): hand deliverables into the chat — same targets, but its OWN
        # approval surface (a thread's standing send_message grant never covers uploads).
        registry.register(
            make_send_file_tool(secrets, workspace=ws, roots=root_list or None)
        )
        # Channel subscriptions (inbound): listen to a channel, catch up, (un)subscribe. The agent
        # obtains a channel via ask_user or from a channel message it's reacting to.
        if subscription_store is not None and channel_buffer is not None and session_id:
            registry.register_all(
                subscription_tools(
                    subscription_store,
                    session_id,
                    channel_buffer,
                    routing_targets=routing_targets,
                )
            )
    # Surfaces with a multi-root workspace can ask the user mid-task for another folder.
    if root_list:
        registry.register(request_directory_tool())
    # Anything with a shell can hit a missing CLI (a scanner, aws, kubectl). Give it a way to
    # ask instead of silently dropping the check that needed it (OPE-85).
    if executor is not None:
        registry.register(request_tool_tool())
    if agent.connectors:
        enabled_connectors, enabled_tools = _enabled_connector_tools(secrets)
        # Least-privilege grant (OPE-93): a persona with an allowlist gets ONLY the
        # connectors it declared — an undeclared connector's tools never enter the
        # session, no matter what the user has connected. True = general personas
        # (Cowork) that legitimately drive whatever is connected.
        if agent.connectors is not True:
            enabled_connectors = enabled_connectors & set(agent.connectors)
        # Per-session connection hierarchy (UI-REFRESH §4.3): when the caller supplies the session's
        # effective connector set, intersect it so only effective-enabled connectors expose tools.
        # Default None preserves CLI / direct callers (no per-session restriction).
        if connector_filter is not None:
            enabled_connectors = enabled_connectors & connector_filter
        registry.register_all(
            make_integration_tools(
                secrets,
                enabled_connectors=enabled_connectors,
                enabled_tools=enabled_tools,
                roots=root_list or None,
            )
        )
    # Web search + fetch: research tools for every agent (keyless DuckDuckGo default).
    registry.register(make_web_search_tool(secrets))
    registry.register(make_web_fetch_tool())
    # ask_user: the universal human-in-the-loop Q&A primitive (every agent; engine-intercepted).
    if question_asker is not None:
        registry.register(ask_user_tool())
    # Route by the model's `provider:` prefix (OpenAI default, Ollama, …). The manager normally
    # passes its shared router; this fallback covers the TUI / direct build_engine() callers.
    # Resolved here (not at engine construction) because the explorer subagent captures it.
    provider = provider or ProviderRouter(secrets, default_provider="openai")
    # Repo-focused personas can fan broad research out to read-only explorer subagents, keeping
    # their own context for the actual change.
    if agent.subagents and ws is not None:
        registry.register_all(
            explorer_tools(
                workspace=ws,
                provider=provider,
                model=model,
                model_settings=model_settings,
            )
        )
    # Scheduling: opted-in surfaces with a workspace can set up scheduled tasks (origin = this
    # session). Code stays out (it fans out to explorers instead).
    if task_store is not None and ws is not None and agent.scheduling:
        origin = {
            "surface": agent.name,
            "session_id": session_id or "",
            "workspace": str(ws),
            "agent": agent.name,
        }
        registry.register_all(
            scheduling_tools(task_store, origin=origin, default_workspace=str(ws))
        )
    # Self-wake: scheduling surfaces can suspend + schedule their own resumption (timer /
    # on-completion / on-event). The scheduler tick resumes due wakes.
    if wake_store is not None and session_id and agent.scheduling:
        registry.register_all(selfwake_tools(wake_store, session_id))

    instructions = f"{agent.system_prompt}\n\n{_NARRATION_GUIDANCE}\n\n{_FIRST_CONTACT_GUIDANCE}"
    if ws is not None:
        instructions = f"{instructions}\n\n{environment_context(ws)}"
        conventions = load_agents_md(ws)
        if conventions:
            instructions = f"{instructions}\n\n{conventions}"

    # The user's own standing instructions, read once here: like the memories below,
    # they're session-stable knowledge. Edits apply to NEW conversations (the Settings
    # copy says exactly that), never mid-conversation.
    rules_block = format_user_rules(
        (user_rules() if callable(user_rules) else user_rules) or ""
    )
    if rules_block:
        instructions = f"{instructions}\n\n{rules_block}"

    # The live saving switch. The callable (server) beats the build-time flag (CLI/tests):
    # the setting can flip EITHER WAY mid-conversation, so nothing about it may be baked
    # into the fixed registry or the static instructions (owner-hit 2026-07-28, both
    # directions: off kept saving, then on kept claiming it was off).
    def _saving_enabled() -> bool:
        if memory_saving_enabled is not None:
            return bool(memory_saving_enabled())
        return not memory_off

    if memory_store is not None:
        # Always the full toolset: the registry is fixed at build, so a session born
        # while saving was off must still be able to save the moment it's turned on.
        # Enforcement is the tools' own live check, not their absence.
        mem_ws = memory_workspace or (str(ws) if ws else None)
        registry.register_all(
            memory_tools(
                memory_store,
                workspace=mem_ws,
                on_saved=on_memory_saved,
                saving_enabled=_saving_enabled,
            )
        )
        instructions = f"{instructions}\n\n{_MEMORY_GUIDANCE}"
        # What the coworker KNOWS is fixed at session start (MEMORY-SPEC §7.1): a
        # conversation's knowledge must not shift underfoot — a fact it referenced ten
        # turns ago cannot silently vanish — and the system prompt is the cached prefix,
        # so the facts are processed once instead of re-sent every turn. Deletions reach
        # NEW conversations; the UI says so rather than pretending otherwise.
        remembered = memory_store.list(scope=Scope.GLOBAL)
        if mem_ws is not None:
            remembered += memory_store.list(scope=Scope.WORKSPACE, workspace=mem_ws)
        block = render_memory_block(remembered)
        if block:
            instructions = f"{instructions}\n\n{block}"

    # Persona dirs come FIRST so a user's global/workspace copy of the same name shadows
    # the bundle's (later dirs overwrite earlier in the loader).
    skill_loader = SkillLoader([Path(d) for d in (extra_skill_dirs or [])] + _skill_dirs(ws))
    # Per-session effective menu (SKILLS-SPEC §3). The manager passes a CALLABLE so
    # load_skill consults the LIVE state per call (a Settings disable applies to running
    # sessions; a skill created after this build is still loadable). The catalog itself
    # is injected per turn via context_provider (below), NOT here — so the menu the model
    # sees is also live: skill changes apply from the next message, no new session needed.
    # Default None preserves CLI / direct callers.
    registry.register_all(skill_tools(skill_loader, allowed=skill_filter))
    # The worker-authors door (SKILLS-SPEC §5.2): save_skill proposes installing a finished
    # skill; requires_approval routes it through the standard approval card, so the review-
    # before-save rule holds without any bespoke plumbing. Bundled files may only come from
    # this session's roots.
    registry.register(
        save_skill_tool(
            allowed_dirs=[r.path for r in (root_list or [])] or ([ws] if ws else [])
        )
    )

    # User-local risk overrides (mainly to relax MCP's conservative default). Empty store →
    # no-op; never written by persona loading (the no-self-grant rule).
    risk_overrides = RiskOverrideStore(state_dir() / "risk_overrides.json").resolver()
    permissions = PermissionEngine(
        workspace_root=ws or (root_list[0].path if root_list else Path.cwd()),
        mode=mode,
        # `[]` is an explicit deny-by-default override, not a request to fall back to config.
        allowed_commands=(
            allowed_commands if allowed_commands is not None else config.allowed_commands
        ),
        auto_allow_tools=set(config.auto_allow),
        allowed_domains=list(config.allowed_domains),
        roots=root_list or None,
        risk_overrides=risk_overrides,
    )
    # The plan-mode exit door — mutually exclusive with the board's decomposition
    # gate, DERIVED from the team trait (owner call 2026-08-16): a lead never
    # implements, so plan mode is meaningless for it, and shipping both tools made
    # the lead pick the wrong one (dogfood-hit: propose_plan denied outside plan
    # mode). Solo/worker personas keep propose_plan as always (mode can flip
    # mid-session; the engine rejects the call outside plan mode).
    if agent.team != "lead":
        registry.register(propose_plan_tool())

    # The lead's gates: propose_work_items (decomposition → items on approval, any
    # mode) and propose_team (staffing → pre-spawn on approval).
    if agent.team == "lead":
        from .teams.tools import propose_team_tool, propose_work_items_tool

        registry.register(propose_work_items_tool())
        registry.register(propose_team_tool())

    # Per-turn ephemeral context, appended to the latest user message since mid-thread system
    # messages aren't reliable across providers. Three producers: the plan-mode reminder (mode can
    # flip mid-session, so it's checked each turn, not baked into the instructions), the live
    # directory list (any multi-root session can gain folders mid-session), and the
    # memory-SAVING notice (same reason as plan mode — the switch flips either way mid-chat).
    # Note what is NOT here: the memories and the user's rules. Those are knowledge, fixed at
    # session start (§7.1).
    roots_context = (lambda: render_context(root_list)) if root_list else None

    # Late-bound engine ref: the closure needs the conversation history (for the disable
    # countermand) but the engine is constructed after the closure. Filled below.
    _engine_box: list = []

    def context_provider() -> str:
        # Live clock, every turn (owner ruling 2026-08-20): the environment block's
        # "Today's date" is a session-START snapshot — stale for long-lived/self-waking
        # sessions — and carries no time of day, which absolute scheduling
        # (sleep_until, scheduled tasks) needs to compute wake times.
        now = datetime.now().astimezone()
        parts = [f"Now: {now.strftime('%Y-%m-%d %H:%M')} ({now.tzname()})"]
        if permissions.mode is Mode.PLAN:
            parts.append(_PLAN_MODE_CONTEXT)
        elif permissions.mode is Mode.DISCUSS:
            parts.append(_DISCUSS_MODE_CONTEXT)
        # Only the SAVING switch is per-turn (§4.3): it governs an action, not
        # knowledge, so it must bite the moment the user flips it. What the coworker
        # knows stays fixed for the session — see the instructions built above.
        if memory_store is not None and not _saving_enabled():
            parts.append(_MEMORY_OFF_NOTICE)
        if roots_context is not None:
            ctx = roots_context()
            if ctx:
                parts.append(ctx)
        # Live skill menu (SKILLS-SPEC §4.1): recomputed every turn like the roots list, so
        # a skill installed/enabled/disabled mid-session applies from the NEXT MESSAGE —
        # no new session, no lost context.
        skill_loader.rescan()
        allowed = skill_filter() if callable(skill_filter) else skill_filter
        skills_ctx = skill_catalog_text(skill_loader, allowed=allowed)
        if skills_ctx:
            parts.append(skills_ctx)
        # Disable countermand (§3): instructions already loaded into this conversation keep
        # steering the model even after the skill is turned off/deleted — history can't be
        # un-read. So a loaded-but-no-longer-available skill gets an explicit stop note,
        # recomputed fresh each turn (re-enable → the note disappears; never persisted).
        eng = _engine_box[0] if _engine_box else None
        if eng is not None:
            available = set(skill_loader.names()) if allowed is None else set(allowed)
            for name in sorted(_loaded_skill_names(eng.messages) - available):
                parts.append(
                    f'Note: the skill "{name}" has been disabled by the user — stop '
                    "following its instructions from here on."
                )
        return "\n\n".join(parts)

    engine = TurnEngine(
        provider=provider,
        registry=registry,
        permissions=permissions,
        model=model,
        instructions=instructions,
        approver=approver,
        # Stop kills the in-flight foreground shell command, not just the loop.
        interrupt_hooks=[executor.interrupt_now] if executor is not None else None,
        max_iterations=(
            max_iterations if max_iterations is not None else config.max_iterations
        ),
        model_settings=model_settings,
        messages=messages,
        audit_sink=audit_sink,
        context_provider=context_provider,
        directory_requester=directory_requester,
        plan_approver=plan_approver,
        question_asker=question_asker,
        tool_requester=tool_requester,
        team_approver=team_approver,
        items_approver=items_approver,
    )
    engine.executor = executor  # type: ignore[attr-defined]
    engine.todo = todo  # type: ignore[attr-defined]
    engine.agent_name = agent.name  # type: ignore[attr-defined]
    engine.roots = root_list  # type: ignore[attr-defined]  # shared list; Slice C mutates in place
    # Session facts (spec Part 0 / §2.4): freeze the known world NOW, before the agent has
    # acted. Freezing is the whole point — compared against live state, an agent that runs
    # `git remote add backup https://attacker.net/…` would make its own destination look
    # familiar. Nothing consumes this in v1; ingestion is recorded to the audit log only.
    engine.session_facts = session_facts.SessionFacts(
        world=session_facts.capture(
            roots=root_list,
            allowed_domains=config.allowed_domains,
            workspace=ws,
        )
    )

    # §1.9: the web_search approval card names the LIVE destination ("Queries go to your
    # configured search provider (currently: ‹name›)"). Resolved when the card is raised,
    # not at session start, so a mid-session Settings change shows through.
    def _approval_extras(tool_name: str, _arguments: dict) -> dict:
        if tool_name == "web_search":
            from .web import provider_name

            return {"search_provider": provider_name(secrets)}
        return {}

    engine.approval_extras = _approval_extras
    # Auto-Approve reviewer (spec Part 8). Attached only when the user-global flag is on —
    # a repo config can never enable it (`auto_approve` is in _GLOBAL_ONLY_FIELDS, same
    # rule as `auto_allow`). With no reviewer attached, Mode.AUTO_APPROVE behaves exactly
    # like INTERACTIVE, which is also the fallback for unattended sessions and after the
    # per-turn retry guard trips (engine._reviewer_active). Uses the session's own
    # provider and model: no second key, and if it's trusted to drive the agent it's
    # strong enough to review it (§1.5).
    #
    # The two flags may be overridden by the caller (the GUI Settings toggle persists them
    # to the user-global prefs store, which the server reads and passes here); None ⇒ take
    # the config.toml value. Both stores are user-global, so a repo still can't turn either
    # on regardless of which path set it.
    live_on = auto_approve if auto_approve is not None else getattr(config, "auto_approve", False)
    shadow_on = (
        auto_approve_shadow
        if auto_approve_shadow is not None
        else getattr(config, "auto_approve_shadow", False)
    )
    if live_on or shadow_on:
        from .reviewer import Reviewer

        engine.reviewer = Reviewer(
            provider=provider,
            model=model,
            known_world=engine.session_facts.world.render(),
        )
        # Shadow evaluation (Part 6 step 3): with only the shadow flag on, the reviewer is
        # attached but the LIVE path stays off unless both live_on and Mode.AUTO_APPROVE
        # are selected — shadow verdicts are recorded on approval cards in any mode.
        engine.reviewer_shadow = bool(shadow_on)
    engine.reviewer_live_enabled = bool(live_on)
    engine.audit_context = {
        "session_id": session_id or "",
        "agent": agent.name,
        "workspace": str(ws) if ws else "",
    }
    engine.skill_loader = skill_loader  # type: ignore[attr-defined]
    _engine_box.append(engine)  # late-bind for the countermand (see context_provider)
    return engine


def build_code_engine(**kwargs: Any) -> TurnEngine:
    """Back-compat shim: build the Code agent's engine."""
    return build_engine(agent=code_agent(), **kwargs)

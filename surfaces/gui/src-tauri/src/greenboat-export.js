(() => {
  const jobId = __GREENBOAT_JOB_ID__;
  if (window.top !== window || location.origin !== "https://imwork.syncotechai.com:8663") return;
  if (window.__greenboatExport && !window.__greenboatExport.finished) return;
  const job = window.__greenboatExport = { id: jobId, cancelled: false, finished: false };
  const started = Date.now();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const emit = (data) => window.__TAURI__.event.emitTo("main", "greenboat-export", { jobId, date, ...data });
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  function check() {
    if (job.cancelled) throw new Error("采集已取消");
    if (Date.now() - started > 15 * 60 * 1000) throw new Error("采集超过 15 分钟，已停止；已采集内容仍可保存");
  }
  const time = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : NaN;
  };
  const isToday = stamp => stamp >= today.getTime() && stamp < tomorrow.getTime();
  const props = node => node?.__vue__;
  const sequence = value => {
    if (value == null || (typeof value === "number" && !Number.isSafeInteger(value))) return null;
    const result = String(value);
    return /^\d+$/.test(result) ? result : null;
  };
  function chat(node) {
    const vm = props(node);
    const data = vm?.$props?.data || vm?.data;
    const id = data?.chatid ?? data?.chatId ?? data?.id;
    return id == null ? null : {
      id: String(id),
      name: node.querySelector(".chat-name")?.textContent?.trim() || String(data.name || id),
      stamp: time(data.latestMessageTime),
      readSeq: sequence(data.lastReadSeq ?? data.last_read_seq),
      unreadCount: data.unreadCount ?? data.unread_count ?? null,
    };
  }
  function scrollParent(node) {
    for (let p = node?.parentElement; p && p !== document.body; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.clientHeight > 0) return p;
    }
    return null;
  }
  function messageView(node) {
    // Vue may attach the message component to an inner element or several wrappers
    // below the DOM root. Do not assume one fixed component depth.
    const queue = [props(node), ...[...node.querySelectorAll('*')].map(props)];
    for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.matches('.talk-container, .chat-view-container') || p.querySelectorAll('.message-item').length !== 1) break;
      const vm = props(p);
      if (vm) queue.push(vm);
    }
    const seen = new Set();
    while (queue.length && seen.size < 300) {
      const vm = queue.shift();
      if (!vm || seen.has(vm)) continue;
      seen.add(vm);
      const s = vm.source || vm.$props?.source;
      if (s && typeof s === 'object' && !Array.isArray(s) &&
        (s.ctime != null || s.msgid != null || s.content != null)) return vm;
      queue.push(...(vm.$children || []));
    }
    return null;
  }
  function visibleTime(text) {
    const value = (text || '').replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/：/g, ':').trim();
    const m = value.match(/^(?:(今天|昨天|前天|\d{4}[年\/-]\d{1,2}[月\/-]\d{1,2}日?|\d{1,2}[月\/-]\d{1,2}日?)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m || +m[2] > 23 || +m[3] > 59 || +(m[4] || 0) > 59) return NaN;
    const d = new Date(today);
    if (m[1] === '昨天') d.setDate(d.getDate() - 1);
    else if (m[1] === '前天') d.setDate(d.getDate() - 2);
    else if (m[1] && m[1] !== '今天') {
      const parts = m[1].match(/\d+/g).map(Number);
      if (parts.length === 3) d.setFullYear(parts.shift());
      d.setMonth(parts[0] - 1, parts[1]);
    }
    d.setHours(+m[2], +m[3], +(m[4] || 0), 0);
    return +d;
  }
  function domTime(node) {
    const boundary = scrollParent(node);
    const split = node.querySelector('.message-time-split[content]');
    if (split) return visibleTime(split.getAttribute('content'));
    // The deployed MessageItem renders its time INSIDE .operations, after the
    // body in DOM order. Its visual position is not its sibling order. This is
    // a UI time label, not the raw timestamp and not a date in the message body.
    const ownLabel = [...node.querySelectorAll('.message-time')].find(label =>
      !label.closest('.message-content, .message-system') &&
      !label.closest('[hidden], [aria-hidden="true"]') &&
      getComputedStyle(label).display !== 'none');
    if (ownLabel) return visibleTime(ownLabel.textContent);
    function lastLabel(element) {
      if (element.matches('.message-content, .message-system, .user-name, [contenteditable], [hidden], [aria-hidden="true"]') ||
        getComputedStyle(element).display === 'none') return NaN;
      if (element.matches('.message-time-split[content]')) return visibleTime(element.getAttribute('content'));
      // Search backwards inside wrappers as well: multiple messages may share
      // one preceding separator. Message text must never act as a time label.
      for (const child of [...element.children].reverse()) {
        const stamp = lastLabel(child);
        if (Number.isFinite(stamp)) return stamp;
      }
      return element.children.length ? NaN : visibleTime(element.textContent);
    }
    for (let p = node; p && p !== boundary && p !== document.body; p = p.parentElement) {
      for (let sibling = p.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        const stamp = lastLabel(sibling);
        if (Number.isFinite(stamp)) return stamp;
      }
    }
    return NaN;
  }
  function source(node) {
    const vm = messageView(node);
    const raw = vm?.source || vm?.$props?.source || {};
    return { ...raw,
      chatid: raw.chatid ?? raw.chatId ?? node.getAttribute('data-chat-id'),
      msgid: raw.msgid ?? raw.msgId ?? raw.id ?? node.getAttribute('data-message-id') ??
        node.querySelector('.message-main[id]')?.id ?? raw.key,
      ctime: domTime(node),
    };
  }
  const messageNodes = () => [...document.querySelectorAll('.message-item')].filter(n =>
    !n.closest('.recent-chat-item') && !n.closest('[hidden], [aria-hidden="true"]') &&
    getComputedStyle(n).display !== 'none');
  const listSignature = () => [...document.querySelectorAll(".recent-chat-item")]
    .map(n => { const c = chat(n); return `${c?.id}:${c?.stamp}`; }).join("|");
  // Cached views can finish immediately after rendering. Slow/unchanged views retain
  // the old wait budget, particularly at history boundaries where network IO occurs.
  async function waitForRender(read, previous, timeout, changed = false) {
    let last = previous, quiet = 0;
    for (let elapsed = 0; elapsed < timeout; elapsed += 60) {
      check(); await sleep(60);
      const current = read();
      if (current !== last) { changed = true; quiet = 0; last = current; }
      else quiet += 60;
      if (changed && quiet >= 120) return;
    }
  }
  async function collect(item, node) {
    check();
    await emit({ type: "progress", text: `正在读取：${item.name}（${date} 00:00 起）` });
    const before = new Set(messageNodes());
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    node.click();
    const deadline = Date.now() + 12000;
    let nodes;
    const belongs = n => {
      const id = source(n).chatid;
      if (id != null) return String(id) === item.id;
      // An absent per-message chat ID is common. A newly mounted detail after
      // selecting the conversation is usable; never reuse the previous chat DOM.
      return !before.has(n);
    };
    do {
      check();
      nodes = messageNodes();
      if (nodes.some(belongs)) break;
      await sleep(75);
    } while (Date.now() < deadline);
    if (!nodes.some(belongs)) throw new Error(`详情未切换：找到 ${nodes.length} 个消息节点，但没有当前会话的新内容`);
    const scroller = scrollParent(nodes.find(belongs));
    if (!scroller) throw new Error("未找到消息滚动容器");
    const detailNodes = () => messageNodes().filter(n => scroller.contains(n) && belongs(n));
    const detailSignature = () => detailNodes().map(n => {
      const s = source(n);
      return `${s.msgid ?? s.key}:${s.ctime}:${n.textContent?.length}`;
    }).join("|");
    // Opening a conversation can restore an old scroll position. Confirm the latest
    // message before walking backwards, including when the virtual list remounts.
    let latestConfirmed = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const initialSignature = detailSignature();
      const alreadyAtBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await waitForRender(detailSignature, initialSignature, 1000, alreadyAtBottom && attempt === 0);
      const latest = Math.max(...detailNodes().map(n => time(source(n)?.ctime)).filter(Number.isFinite));
      if (latest >= item.stamp - 60000) { latestConfirmed = true; break; }
    }
    const messages = new Map();
    let crossedDay = false, stagnant = 0, unknown = 0, domFallback = false;
    let interrupted;
    try {
    for (let round = 0; round < 600; round++) {
      check();
      if (round % 10 === 0) await emit({ type: "progress", text: `正在向上加载：${item.name}（已读取 ${messages.size} 条）` });
      const occurrences = new Map();
      for (const n of detailNodes()) {
        const s = source(n);
        if (!s) continue;
        const stamp = time(s.ctime);
        if (!Number.isFinite(stamp)) { unknown++; continue; }
        if (stamp < today.getTime()) crossedDay = true;
        if (!isToday(stamp)) continue;
        const body = n.querySelector(".message-content, .message-system");
        const fingerprint = `${stamp}:${body?.textContent || n.textContent}`;
        const occurrence = (occurrences.get(fingerprint) || 0) + 1;
        occurrences.set(fingerprint, occurrence);
        const id = s.msgid ?? s.key ?? `dom:${fingerprint}:${occurrence}`;
        if (s.msgid == null && s.key == null) domFallback = true;
        const vm = messageView(n);
        const uid = vm?.loginUserId;
        const outgoing = uid != null && String(s.sender) === String(uid);
        const seq = sequence(s.seq);
        // The boundary is copied before opening this chat; opening it marks messages read.
        const readState = outgoing ? "read" : item.readSeq !== null && seq !== null
          ? (BigInt(seq) <= BigInt(item.readSeq) ? "read" : "unread") : "unknown";
        const mentions = Array.isArray(s.ext?.mention) ? s.ext.mention.map(String) : [];
        const mentionMe = uid == null ? null : !outgoing && mentions.includes(String(uid));
        const text = (body?.innerText ?? body?.textContent)?.trim() ||
          (body?.querySelector("video") ? "[视频]" : body?.querySelector("audio") ? "[语音]" :
            body?.querySelector("img") ? "[图片]" : "[非文本消息，需在绿舟中查看]");
        messages.set(String(id), {
          id: String(id), time: new Date(stamp).toLocaleString("zh-CN", { hour12: false }), stamp,
          sender: n.querySelector(".user-name")?.textContent?.trim() || messageView(n)?.displayName ||
            (s.sender != null ? `用户 ${s.sender}` : "发送者未显示"),
          text,
          readState, outgoing, mentionMe, mentionAll: !outgoing && mentions.includes("-1"),
        });
      }
      if (crossedDay) break;
      const previous = scroller.scrollTop;
      const previousSignature = detailSignature();
      scroller.scrollTop = Math.max(0, previous - Math.max(100, scroller.clientHeight * 0.85));
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await waitForRender(detailSignature, previousSignature, 800);
      if (previous === 0 && scroller.scrollTop === 0 && previousSignature === detailSignature()) stagnant++;
      else stagnant = 0;
      if (stagnant >= 5) break;
    }
    } catch (error) { interrupted = error; }
    const warnings = [];
    if (!latestConfirmed) warnings.push("未确认已定位到最新消息，可能遗漏较新的今日消息");
    if (!crossedDay) warnings.push("未确认昨日边界，仅包含当前成功加载的今日消息");
    if (unknown) warnings.push("部分消息上方缺少时间标签，未纳入汇总");
    if (domFallback) warnings.push("部分消息按页面时间标签和正文识别；时间可能为分组时间，重叠页的同文消息去重可能有误差，已读及@状态缺少依据时为未知");
    if (item.readSeq === null) warnings.push("未获取打开会话前的已读位置，接收消息的已读状态标为未知");
    if (interrupted) warnings.push(interrupted.message);
    const all = [...messages.values()].sort((a, b) => a.stamp - b.stamp);
    // Bound each IPC payload; messages are never sent to an external summarization service.
    for (let i = 0; i < Math.max(1, all.length); i += 50) {
      await emit({ type: "messages", conversation: { id: item.id, name: item.name, unreadCountBeforeOpen: item.unreadCount }, messages: all.slice(i, i + 50), warnings });
    }
    if (interrupted) throw interrupted;
  }
  (async () => {
    const warnings = [];
    let list, oldTop;
    try {
      const first = document.querySelector(".recent-chat-item");
      if (!first || !chat(first)) throw new Error("未识别到绿舟会话列表，请切换到消息页后重试");
      list = scrollParent(first);
      if (!list) throw new Error("未找到会话列表滚动容器");
      oldTop = list.scrollTop;
      const initialSignature = listSignature();
      list.scrollTop = 0;
      await waitForRender(listSignature, initialSignature, 700, oldTop === 0);
      const visited = new Set();
      let bottom = 0, complete = false;
      for (let page = 0; page < 600; page++) {
        check();
        await emit({ type: "progress", text: `正在遍历会话列表（已检查 ${visited.size} 个会话）` });
        const previousCount = visited.size;
        for (const node of [...list.querySelectorAll(".recent-chat-item")]) {
          const item = chat(node);
          if (!item) { warnings.push("部分会话无法识别 ID，已跳过"); continue; }
          if (visited.has(item.id)) continue;
          visited.add(item.id);
          if (!Number.isFinite(item.stamp)) { warnings.push(`会话 ${item.name} 缺少最近消息时间`); continue; }
          if (!isToday(item.stamp)) continue;
          try { await collect(item, node); }
          catch (error) { check(); warnings.push(`${item.name}：${error.message}`); }
        }
        const previousTop = list.scrollTop;
        const previousSignature = listSignature();
        list.scrollTop += Math.max(100, list.clientHeight * 0.85);
        list.dispatchEvent(new Event("scroll", { bubbles: true }));
        await waitForRender(listSignature, previousSignature, 700);
        if (previousTop === list.scrollTop && visited.size === previousCount && previousSignature === listSignature()) bottom++;
        else bottom = 0;
        if (bottom >= 4) { complete = true; break; }
      }
      if (!complete) warnings.push("会话列表遍历达到上限，可能仍有会话未采集");
      await emit({ type: "done", warnings: [...new Set(warnings)], text: "采集完成，正在生成新会话草稿" });
    } catch (error) {
      await emit({ type: "failed", warnings: [error.message], text: error.message });
    } finally {
      if (list && oldTop != null) list.scrollTop = oldTop;
      job.finished = true;
    }
  })();
})();

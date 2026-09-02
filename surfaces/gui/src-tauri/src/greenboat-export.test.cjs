const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(`${__dirname}/greenboat-export.js`, 'utf8').replace('__GREENBOAT_JOB_ID__', '"test-job"');

test('uses the nearest preceding label, shares it across messages and ignores body timestamps', () => {
  const dom = new JSDOM(`<div id="history">
    <div>昨天 23:59</div><div class="message-item" id="old"></div>
    <section><span>00:12</span><div class="message-item" id="a"><div class="message-content">昨天 20:00</div></div></section>
    <div class="message-item" id="b"></div>
    <div>00:15</div><div class="message-item" id="c"></div></div>`);
  const d = dom.window.document, today = new Date(); today.setHours(0, 0, 0, 0);
  const helper = script.slice(script.indexOf('function visibleTime'), script.indexOf('function source(node)'));
  const read = new Function('today', 'document', 'getComputedStyle', 'scrollParent', `${helper}; return domTime;`)(
    today, d, dom.window.getComputedStyle.bind(dom.window), () => d.querySelector('#history'),
  );
  assert.ok(read(d.querySelector('#old')) < +today);
  assert.equal(read(d.querySelector('#a')), +today + 12 * 60000);
  assert.equal(read(d.querySelector('#b')), +today + 12 * 60000);
  assert.equal(read(d.querySelector('#c')), +today + 15 * 60000);
  d.querySelector('#history').prepend(d.createElement('div'));
  assert.ok(Number.isNaN(read(d.querySelector('#history').firstElementChild)));
  dom.window.close();
});

test('reads deployed message-item operations time labels inside the node, including bare HH:mm', () => {
  const dom = new JSDOM(`<div id="history">
    <div class="message-item" id="old"><div class="message-content">登录时间 2026/08/26 09:16:20</div><div class="operations"><div class="message-time">8月26日 09:16</div></div></div>
    <div class="message-item" id="notice"><div class="message-content">登录操作通知</div><div class="operations"><div class="message-time">00:11</div></div></div>
    <div class="message-item" id="story"><div class="message-content">《给未来的自己》</div><div class="operations"><div class="message-time">\u200e00：12</div></div></div>
  </div>`);
  const today = new Date(2026, 8, 3), d = dom.window.document;
  const helper = script.slice(script.indexOf('function visibleTime'), script.indexOf('function source(node)'));
  const read = new Function('today', 'document', 'getComputedStyle', 'scrollParent', `${helper}; return domTime;`)(
    today, d, dom.window.getComputedStyle.bind(dom.window), () => d.querySelector('#history'),
  );
  assert.equal(read(d.querySelector('#old')), +new Date(2026, 7, 26, 9, 16));
  assert.equal(read(d.querySelector('#notice')), +today + 11 * 60000);
  assert.equal(read(d.querySelector('#story')), +today + 12 * 60000);
  dom.window.close();
});

async function run({ cancel = false, missing = false, empty = false, paged = false, stale = false, readMissing = false, deep = false, noChatId = false, domOnly = false, visibleOnly = false, cssTime = false } = {}) {
  const dom = new JSDOM('<div id="list" style="overflow-y:auto"></div><div class="talk-container" style="overflow-y:auto"></div>', {
    url: 'https://imwork.syncotechai.com:8663/woa/im/messages', runScripts: 'outside-only',
  });
  const w = dom.window, d = w.document, list = d.querySelector('#list'), talk = d.querySelector('.talk-container');
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const noon = +midnight + 12 * 3600000;
  const clicked = [], events = [];
  function scroll(el) {
    let top = 0;
    Object.defineProperties(el, { clientHeight: { value: 400 }, scrollHeight: { value: 800 }, scrollTop: {
      get: () => top, set: value => { top = Math.max(0, Math.min(400, value)); },
    } });
  }
  scroll(list); scroll(talk);
  let active;
  function renderMessages(id, entries) {
    talk.innerHTML = '';
    for (const [msgid, ctime] of entries) {
      const m = d.createElement('div'); m.className = 'message-item';
      m.innerHTML = '<div class="user-name">张三</div><div class="message-content">相同文本</div>';
      // Some message wrappers hold the source on their child Vue component.
      m.__vue__ = { $children: [{ loginUserId: 42, source: { chatid: id, msgid, ctime: missing ? undefined : ctime,
        seq: msgid === 'a' ? '2' : '3', sender: 99, ext: { mention: msgid === 'a' ? [42] : [-1] } } }] };
      if (noChatId) delete m.__vue__.$children[0].source.chatid;
      if (deep) m.__vue__ = { $children: [{ $children: [m.__vue__] }] };
      if (domOnly) {
        delete m.__vue__;
        m.setAttribute('data-message-id', msgid);
        m.setAttribute('data-timestamp', ctime);
      }
      if (visibleOnly) {
        delete m.__vue__;
        m.querySelector('.message-content').textContent = `正文 ${msgid}：给未来的自己`;
      }
      if (!missing) {
        const separator = d.createElement('div');
        const stamp = ctime < 1e12 ? ctime * 1000 : ctime;
        const date = new Date(stamp);
        separator.textContent = `${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2,'0')}:${String(date.getSeconds()).padStart(2,'0')}`;
        if (cssTime) {
          delete m.__vue__;
          separator.className = 'message-time-split';
          separator.setAttribute('content', separator.textContent);
          separator.textContent = '';
          m.prepend(separator);
          const body = m.querySelector('.message-content');
          const wrapper = d.createElement('div'); wrapper.className = 'message-main'; wrapper.id = msgid;
          body.replaceWith(wrapper); wrapper.append(body);
        } else talk.append(separator);
      }
      talk.append(m);
    }
  }
  talk.addEventListener('scroll', () => {
    if (!paged || !active) return;
    if (talk.scrollTop === 400) renderMessages(active, [['latest', noon]]);
    else if (talk.scrollTop > 0) renderMessages(active, [['early', +midnight + 1000], ['latest', noon]]);
    else renderMessages(active, [['yesterday', +midnight - 1], ['midnight', +midnight], ['early', +midnight + 1000]]);
  });
  if (!empty) for (const id of ['old', 'one', 'two']) {
    const node = d.createElement('div'); node.className = 'recent-chat-item';
    node.innerHTML = '<span class="chat-name">同名会话</span>';
    node.__vue__ = { $props: { data: { chatId: id, lastReadSeq: readMissing ? undefined : '2', latestMessageTime: id === 'old' ? +midnight - 1000 : noon } } };
    node.addEventListener('mousedown', () => {
      clicked.push(id); active = id;
      // Opening the conversation updates the live read boundary immediately.
      node.__vue__.$props.data.lastReadSeq = '999';
      renderMessages(id, paged || stale ? [['old-position', +midnight - 1]] :
        [['yesterday', +midnight - 1], ['a', noon / 1000], ['b', noon + 1000], ['a', noon / 1000], ['tomorrow', +midnight + 86400000]]);
    }); list.append(node);
  }
  let resolve;
  const done = new Promise(r => { resolve = r; });
  w.__TAURI__ = { event: { emitTo: async (target, name, payload) => {
    assert.equal(target, 'main'); assert.equal(name, 'greenboat-export');
    events.push(payload);
    if (cancel && payload.text?.startsWith('正在向上加载')) w.__greenboatExport.cancelled = true;
    if (payload.type === 'done' || payload.type === 'failed') resolve();
  } } };
  w.setTimeout = fn => { queueMicrotask(fn); return 1; };
  w.eval(script);
  await done;
  dom.window.close();
  return { events, clicked };
}

test('walks today conversations, excludes yesterday/tomorrow, deduplicates IDs not text', async () => {
  const { events, clicked } = await run();
  assert.deepEqual(clicked, ['one', 'two']);
  const chunks = events.filter(e => e.type === 'messages');
  assert.equal(chunks.length, 2);
  for (const c of chunks) { assert.equal(c.messages.length, 2); assert.equal(c.warnings.length, 0); }
  assert.equal(events.at(-1).type, 'done');
});
test('missing timestamps are skipped and explicitly reported', async () => {
  const { events } = await run({ missing: true });
  const chunk = events.find(e => e.type === 'messages');
  assert.equal(chunk.messages.length, 0);
  assert.ok(chunk.warnings.some(w => w.includes('缺少时间')));
});

test('uses the pre-open read boundary and separates direct mentions from mention-all', async () => {
  const { events } = await run();
  const [a, b] = events.find(e => e.type === 'messages').messages;
  assert.equal(a.readState, 'read'); assert.equal(b.readState, 'unread');
  assert.equal(a.mentionMe, true); assert.equal(a.mentionAll, false);
  assert.equal(b.mentionMe, false); assert.equal(b.mentionAll, true);
});
test('does not infer read status without a pre-open boundary', async () => {
  const { events } = await run({ readMissing: true });
  assert.ok(events.find(e => e.type === 'messages').messages.every(m => m.readState === 'unknown'));
});
test('cancellation preserves messages already collected and reports incomplete result', async () => {
  const { events } = await run({ cancel: true });
  assert.equal(events.at(-1).type, 'failed');
  assert.ok(events.at(-1).warnings[0].includes('取消'));
  assert.equal(events.find(e => e.type === 'messages').messages.length, 2);
});
test('an unrecognized page fails explicitly instead of exporting an empty success', async () => {
  const { events } = await run({ empty: true });
  assert.equal(events.at(-1).type, 'failed');
  assert.ok(events.at(-1).warnings[0].includes('未识别'));
});

test('loads virtual detail pages back to midnight and retains messages removed from DOM', async () => {
  const { events } = await run({ paged: true });
  for (const chunk of events.filter(e => e.type === 'messages')) {
    assert.deepEqual(Array.from(chunk.messages, m => m.id), ['midnight', 'early', 'latest']);
    assert.equal(chunk.warnings.length, 0);
    assert.equal(chunk.messages[0].text, '相同文本');
  }
});

for (const [name, options] of [
  ['live CSS content time labels and message-main IDs', { cssTime: true }],
  ['deeply nested message components', { deep: true }],
  ['messages without per-message chat IDs', { noChatId: true }],
  ['DOM-only messages without Vue internals', { domOnly: true }],
]) test(`collects paged details from ${name}`, async () => {
  const { events } = await run({ ...options, paged: true });
  const chunks = events.filter(e => e.type === 'messages');
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.deepEqual(Array.from(chunk.messages, m => m.id), ['midnight', 'early', 'latest']);
    assert.ok(!chunk.warnings.some(w => w.includes('边界')));
  }
});

test('reads visible time separators and full bodies with no Vue, IDs or timestamp attributes', async () => {
  const { events } = await run({ visibleOnly: true, paged: true });
  const chunks = events.filter(e => e.type === 'messages');
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) {
    assert.deepEqual(Array.from(chunk.messages, m => m.text), [
      '正文 midnight：给未来的自己', '正文 early：给未来的自己', '正文 latest：给未来的自己',
    ]);
    assert.ok(chunk.messages.every(m => m.readState === 'unknown' && m.mentionMe === null));
    assert.ok(chunk.warnings.some(w => w.includes('页面时间标签')));
    assert.ok(!chunk.warnings.some(w => w.includes('昨日边界')));
  }
});

test('does not claim completeness when opening an old position fails to reach latest messages', async () => {
  const { events } = await run({ stale: true });
  const chunk = events.find(e => e.type === 'messages');
  assert.ok(chunk.warnings.some(w => w.includes('最新消息')));
});

test('adaptive rendering proceeds early for cached views but waits for slow history', async () => {
  const helper = script.slice(script.indexOf('async function waitForRender'), script.indexOf('async function collect'));
  async function duration(changeAt, alreadyRendered = false) {
    let elapsed = 0;
    const wait = new Function('check', 'sleep', `${helper}; return waitForRender;`)(
      () => {}, async ms => { elapsed += ms; },
    );
    await wait(() => elapsed >= changeAt ? 'new messages' : 'old messages', 'old messages', 800, alreadyRendered);
    return elapsed;
  }
  assert.equal(await duration(60), 180);
  assert.equal(await duration(600), 720);
  assert.ok(await duration(Infinity) >= 800);
  assert.equal(await duration(Infinity, true), 120);
});

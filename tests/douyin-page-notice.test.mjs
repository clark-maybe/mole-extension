import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import vm from 'node:vm';
import { buildSync } from 'esbuild';

const bundle = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/functions/douyin-page-notice.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { updateDouyinPageNotice } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

// 可控 DOM/时钟：在注入函数已经返回后触发验证码和消息回调。
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.handlers = {}; }
  append(...children) { for (const child of children) this.appendChild(child); }
  appendChild(child) { this.children.push(child); child.parent = this; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  removeEventListener(event, handler) { if (this.handlers[event] === handler) delete this.handlers[event]; }
  dispatchEvent(event) { this.handlers[event.type]?.(); }
  attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
}
const find = (node, predicate) => predicate(node) ? node : node.children.map((child) => find(child, predicate)).find(Boolean);
const text = (node) => (node.textContent || '') + node.children.map(text).join('');

function page() {
  const root = new Element('html');
  const timers = new Set();
  const observers = [];
  const reports = [];
  const window = new Element('window');
  let now = 0;
  let reply = (callback) => callback({ accepted: true });
  const document = {
    documentElement: root,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => find(root, (node) => node.id === id),
    querySelector: (selector) => document.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector) => {
      const nodes = [];
      const walk = (node) => {
        if (selector.split(',').some((part) => {
      const candidate = part.trim();
      if (candidate === '#captcha_container') return node.id === 'captcha_container';
      if (candidate === '[role="dialog"]') return node.attributes.role === 'dialog';
      if (candidate === 'a[href="/user/self"]') return node.tag === 'a' && node.href === '/user/self';
      const prefix = candidate.match(/^iframe\[src\^="([^"]+)"\]$/)?.[1];
      return node.tag === 'iframe' && prefix && node.src?.startsWith(prefix);
        })) nodes.push(node);
        node.children.forEach(walk);
      };
      walk(root);
      return nodes;
    },
  };
  const context = vm.createContext({ document, window, Event: class { constructor(type) { this.type = type; } },
    location: { origin: 'https://www.douyin.com' }, Date: { now: () => now },
    setInterval: (fn) => { timers.add(fn); return fn; }, clearInterval: (fn) => timers.delete(fn),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
    chrome: { runtime: { sendMessage: (message, callback) => { reports.push(message); reply(callback); } } },
  });
  const update = vm.runInContext(`(${updateDouyinPageNotice.toString()})`, context);
  return { root, document, update, reports, observers, timers, window,
    setReply: (fn) => { reply = fn; },
    mutate: () => { for (const o of observers) if (o.connected) o.callback(); },
    tick: () => { now += 500; for (const fn of timers) fn(); },
    notice: () => document.getElementById('mole-douyin-task-notice')?.shadow,
  };
}

test('顶部提醒说明搜索目的，常驻且可更新、关闭，关键词只作为文本显示', () => {
  const { root, update } = page();
  update('<img src=x onerror=alert(1)>', 'verification', 'data:image/svg+xml,test');
  assert.equal(root.children.length, 1);
  let shadow = root.children[0].shadow;
  assert.match(text(shadow), /Mole 正在搜索线索/);
  assert.match(text(shadow), /手动完成当前页面的安全验证/);
  assert.match(text(shadow), /<img src=x onerror=alert\(1\)>/);
  assert.equal(find(shadow, (node) => node.tag === 'img').src, 'data:image/svg+xml,test');
  assert.equal(find(shadow, (node) => node.attributes.role === 'status').tag, 'div');

  update('武汉 餐饮', 'login', 'data:image/svg+xml,test');
  assert.equal(root.children.length, 1);
  shadow = root.children[0].shadow;
  assert.match(text(shadow), /在当前页面完成登录/);
  assert.doesNotMatch(text(shadow), /onerror/);
  find(shadow, (node) => node.tag === 'button').handlers.click();
  assert.equal(root.children.length, 0);

  update('武汉 餐饮', 'verification', 'data:image/svg+xml,test');
  update('武汉 餐饮', null, 'data:image/svg+xml,test');
  assert.equal(root.children.length, 0);
});

test('搜索返回后再弹出验证码，覆盖登录卡片并主动上报，不重复刷提醒', () => {
  for (const kind of ['container', 'iframe']) {
    const p = page();
    p.update('武汉 餐饮', 'watch', 'icon', 'watch-1');
    p.update('武汉 餐饮', 'login', 'icon', 'watch-1');
    assert.match(text(p.notice()), /请先登录抖音/);
    const captcha = new Element(kind === 'iframe' ? 'iframe' : 'div');
    if (kind === 'iframe') captcha.src = 'https://rmc.bytedance.com/verifycenter/captcha/v2';
    else captcha.id = 'captcha_container';
    p.root.append(captcha);
    p.mutate();
    assert.match(text(p.notice()), /需要你完成安全验证/);
    assert.equal(p.reports.length, 1);
    assert.equal(p.reports[0].type, '__douyin_verification_detected');
    assert.equal(p.reports[0].data.watchId, 'watch-1');
    const notice = p.notice();
    p.tick();
    p.mutate();
    assert.equal(p.notice(), notice);
    assert.equal(p.reports.length, 1);
    // 随后抵达的登录/成功结果不能覆盖已经出现的验证码。
    for (const state of ['login', null]) {
      p.update('武汉 餐饮', state, 'icon', 'watch-1');
      assert.match(text(p.notice()), /需要你完成安全验证/);
    }
    captcha.remove();
    p.mutate();
    p.root.append(captcha);
    p.tick();
    assert.equal(p.reports.length, 2);
  }
});

test('成功结果之后才插入 iframe，定时检查也能感知并重试过早的上报', () => {
  const p = page();
  p.setReply((callback) => callback({ accepted: false }));
  p.update('武汉 餐饮', 'watch', 'icon', 'watch-2');
  p.update('武汉 餐饮', null, 'icon', 'watch-2');
  const iframe = new Element('iframe');
  iframe.src = 'about:blank';
  p.root.append(iframe);
  p.mutate();
  assert.equal(p.reports.length, 0);
  iframe.src = '//rmc.bytedance.com/verifycenter/captcha/v2';
  p.tick();
  assert.match(text(p.notice()), /安全验证/);
  assert.equal(p.reports.length, 1);
  p.mutate();
  assert.equal(p.reports.length, 1);
  p.tick();
  assert.equal(p.reports.length, 2);
  p.setReply((callback) => callback({ accepted: true }));
  p.tick();
  p.tick();
  assert.equal(p.reports.length, 3);
});

test('重装与页面离开会清理观察器和计时器，旧回调不会影响新的验证', () => {
  const p = page();
  let reply;
  p.setReply((callback) => { reply = callback; });
  p.update('旧词', 'watch', 'icon', 'old');
  const captcha = new Element('div');
  captcha.id = 'captcha_container';
  p.root.append(captcha);
  p.mutate();
  const oldReply = reply;
  p.update('新词', 'watch', 'icon', 'new');
  assert.equal(p.observers[0].connected, false);
  assert.equal(p.timers.size, 1);
  assert.equal(p.reports.at(-1).data.watchId, 'new');
  oldReply({ accepted: true });
  reply({ accepted: false });
  p.tick();
  assert.equal(p.reports.at(-1).data.watchId, 'new');
  p.window.dispatchEvent({ type: 'pagehide' });
  assert.ok(p.observers.every((observer) => !observer.connected));
  assert.equal(p.timers.size, 0);
  assert.equal(p.document.getElementById('mole-douyin-verification-watch'), undefined);
});

test('验证码消失并保持稳定后只上报一次恢复候选，不在页面循环请求搜索', () => {
  const p = page();
  const captcha = new Element('div');
  captcha.id = 'captcha_container';
  p.root.append(captcha);
  p.update('关键词', 'watch', 'icon', 'auto');
  captcha.remove();
  p.mutate();
  for (let i = 0; i < 6; i++) p.tick();
  const reports = p.reports.filter((report) => report.type === '__channel_access_ready');
  assert.equal(reports.length, 1);
  assert.equal(reports[0].data.watchId, 'auto');
  for (let i = 0; i < 10; i++) { p.tick(); p.mutate(); }
  assert.equal(p.reports.filter((report) => report.type === '__channel_access_ready').length, 1);
});

test('登录弹窗消失后自动检查；普通 DOM 变化不会触发恢复', () => {
  const p = page();
  p.update('关键词', 'watch', 'icon', 'login-auto');
  p.update('关键词', 'login', 'icon', 'login-auto');
  for (let i = 0; i < 6; i++) p.tick();
  assert.equal(p.reports.length, 0);
  const dialog = new Element('div');
  dialog.setAttribute('role', 'dialog');
  dialog.textContent = '扫码登录';
  p.root.append(dialog);
  p.mutate();
  for (let i = 0; i < 6; i++) p.tick();
  assert.equal(p.reports.length, 0);
  dialog.remove();
  for (let i = 0; i < 6; i++) p.tick();
  assert.equal(p.reports.filter((report) => report.type === '__channel_access_ready').length, 1);
});

test('刷新后可按已登录标识重新发现恢复时机，隐藏验证码不阻止恢复', () => {
  const p = page();
  const account = new Element('a');
  account.href = '/user/self';
  p.root.append(account);
  const captcha = new Element('div');
  captcha.id = 'captcha_container';
  captcha.hidden = true;
  p.root.append(captcha);
  p.update('关键词', 'watch', 'icon', 'restored', undefined, 'login');
  assert.match(text(p.notice()), /请先登录抖音/);
  for (let i = 0; i < 6; i++) p.tick();
  assert.equal(p.reports.filter((report) => report.type === '__channel_access_ready').length, 1);
  assert.equal(p.reports.filter((report) => report.type === '__douyin_verification_detected').length, 0);
});

test('取消时停止指定查询的观察器，旧任务清理不能停止新查询', () => {
  const p = page();
  p.update('关键词', 'watch', 'icon', 'new');
  p.update('', 'stop', 'icon', 'old');
  assert.equal(p.timers.size, 1);
  p.update('', 'stop', 'icon', 'new');
  assert.equal(p.timers.size, 0);
});

test('后台重装参数经过 JSON 序列化后，验证码检测仍生效', () => {
  const p = page();
  const captcha = new Element('div');
  captcha.id = 'captcha_container'; p.root.append(captcha);
  p.update(...JSON.parse(JSON.stringify(['词', 'watch', 'icon', 'restored-captcha', null, 'verification'])));
  for (let i = 0; i < 8; i++) p.tick();
  assert.equal(p.reports.filter(report => report.type === '__channel_access_ready').length, 0);
  assert.equal(p.reports[0].type, '__douyin_verification_detected');
  captcha.remove();
  for (let i = 0; i < 8; i++) p.tick();
  assert.equal(p.reports.filter(report => report.type === '__channel_access_ready').length, 1);
});

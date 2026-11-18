/** 注入抖音页的常驻轻提醒；函数须能独立序列化至隔离环境。 */
export function updateDouyinPageNotice(
  keyword: string,
  state: 'watch' | 'login' | 'verification' | null,
  icon: string,
  watchId = '',
  captchaSelector = '#captcha_container, iframe[src^="https://rmc.bytedance.com/verifycenter/captcha/"], iframe[src^="//rmc.bytedance.com/verifycenter/captcha/"]',
): void {
  if (location.origin !== 'https://www.douyin.com') return;
  const id = 'mole-douyin-task-notice';
  const renderNotice = (noticeState: 'login' | 'verification' | null) => {
    document.getElementById(id)?.remove();
    if (!noticeState) return;

    const host = document.createElement('div');
    host.id = id;
    host.style.cssText = 'all:initial;position:fixed;top:12px;left:16px;right:16px;z-index:2147483647;pointer-events:none';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box} .notice{display:flex;align-items:center;gap:12px;max-width:880px;margin:0 auto;padding:12px 14px;border:1px solid #e8e7ed;border-radius:12px;background:#fff;color:#24212d;box-shadow:0 4px 24px #18112414;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;pointer-events:auto}
      img{width:30px;height:30px;border-radius:8px;flex:none} .body{flex:1;min-width:0} strong{display:block;font-size:13px;font-weight:600;line-height:1.5} p{margin:3px 0 0;font-size:12px;line-height:1.6;color:#777480;overflow-wrap:anywhere}
      button{flex:none;width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:#92909b;font-size:19px;cursor:pointer}button:hover{background:#f5f4f7}button:focus-visible{outline:2px solid #a78bfa}
    `;
    const notice = document.createElement('div');
    notice.className = 'notice';
    notice.setAttribute('role', 'status');
    const image = document.createElement('img');
    image.src = icon;
    image.alt = '抖音';
    const body = document.createElement('div');
    body.className = 'body';
    const title = document.createElement('strong');
    title.textContent = noticeState === 'verification' ? 'Mole 正在搜索线索 · 需要你完成安全验证' : 'Mole 正在搜索线索 · 请先登录抖音';
    const description = document.createElement('p');
    description.textContent = `正在查找「${keyword}」相关账号。请${noticeState === 'verification' ? '手动完成当前页面的安全验证' : '在当前页面完成登录'}，然后返回 Mole 重试搜索。`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', '关闭搜索提醒');
    close.addEventListener('click', () => host.remove());
    body.append(title, description);
    notice.append(image, body, close);
    shadow.append(style, notice);
    document.documentElement.appendChild(host);
  };

  if (state !== 'watch') {
    // 返回登录/成功结果的瞬间也可能刚好弹出验证码，不覆盖验证提醒。
    renderNotice(document.querySelector(captchaSelector) ? 'verification' : state);
    return;
  }

  const watcherId = 'mole-douyin-verification-watch';
  const oldWatcher = document.getElementById(watcherId);
  oldWatcher?.dispatchEvent(new Event('mole-watch-stop'));
  oldWatcher?.remove();
  const marker = document.createElement('span');
  marker.id = watcherId;
  marker.style.display = 'none';
  document.documentElement.appendChild(marker);
  let wasPresent = false;
  let delivered = false;
  let sending = false;
  let attempts = 0;
  let stopped = false;
  let generation = 0;
  let nextReportAt = 0;
  const check = () => {
    if (stopped) return;
    const present = document.querySelector(captchaSelector) !== null;
    if (!present) {
      if (wasPresent) generation++;
      wasPresent = false;
      delivered = false;
      attempts = 0;
      sending = false;
      nextReportAt = 0;
      return;
    }
    if (!wasPresent) renderNotice('verification');
    wasPresent = true;
    if (delivered || sending || attempts >= 60 || Date.now() < nextReportAt) return;
    sending = true;
    attempts++;
    nextReportAt = Date.now() + 500;
    const reportGeneration = generation;
    // 此函数独立注入隔离环境，使用 Channel 的消息协议上报，不依赖模块闭包。
    try {
      chrome.runtime.sendMessage({ type: '__douyin_verification_detected', data: { watchId } }, (response) => {
        const invalidContext = chrome.runtime.lastError;
        if (stopped || reportGeneration !== generation) return;
        sending = false;
        delivered = !invalidContext && response?.accepted === true;
      });
    } catch { sending = false; }
  };
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'src', 'style', 'class', 'hidden'],
  });
  // 覆盖请求完成后弹窗、属性切换及页面自身异步验证流程。
  const timer = setInterval(check, 500);
  const stop = () => {
    stopped = true;
    observer.disconnect();
    clearInterval(timer);
    window.removeEventListener('pagehide', stop);
    marker.remove();
  };
  marker.addEventListener('mole-watch-stop', stop, { once: true });
  window.addEventListener('pagehide', stop, { once: true });
  check();
}

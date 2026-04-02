/**
 * 悬浮球 React 版入口
 * 创建 Shadow DOM + 注入样式 + ReactDOM.createRoot 挂载
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { getStyles } from './float-ball/styles';
import { MoleRoot } from './float-ball/MoleRoot';
import { DISABLED_DOMAINS_KEY, isMac } from './float-ball/constants';

export const initFloatBallReact = async () => {
  if (!document.body) return;
  if (window.location.protocol === 'chrome:' || window.location.protocol === 'chrome-extension:') return;

  // 域名黑名单检查
  try {
    const stored = await new Promise<Record<string, unknown>>(resolve => {
      chrome.storage.local.get(DISABLED_DOMAINS_KEY, resolve);
    });
    const disabledData = stored[DISABLED_DOMAINS_KEY] as { domains?: (string | { hostname: string })[] } | undefined;
    if (disabledData && Array.isArray(disabledData.domains)) {
      const host = window.location.hostname;
      const isDisabled = disabledData.domains.some((d) =>
        typeof d === 'string' ? d === host : d.hostname === host,
      );
      if (isDisabled) return;
    }
  } catch {
    // 读取失败时不阻塞初始化
  }

  // 创建 Shadow DOM 宿主
  const host = document.createElement('div');
  host.id = 'mole-root';
  host.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; overflow: visible; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  // 注入样式
  const styleEl = document.createElement('style');
  styleEl.textContent = getStyles();
  shadow.appendChild(styleEl);

  // React 挂载容器
  const reactRoot = document.createElement('div');
  reactRoot.id = 'mole-react-root';
  shadow.appendChild(reactRoot);

  // 插入页面
  document.body.appendChild(host);

  // DOM 保护：MutationObserver 兜底
  let userDismissed = false;
  const bodyObserver = new MutationObserver(() => {
    if (!host.isConnected && !userDismissed) {
      document.body.appendChild(host);
    }
  });
  bodyObserver.observe(document.body, { childList: true });

  // 视口补偿：修复 position: fixed 在祖先有 transform 时失效
  let _compensateRAF = 0;
  const compensateHostPosition = () => {
    const rect = host.getBoundingClientRect();
    const offsetX = Math.round(rect.left);
    const offsetY = Math.round(rect.top);
    if (offsetX !== 0 || offsetY !== 0) {
      const curLeft = parseFloat(host.style.left) || 0;
      const curTop = parseFloat(host.style.top) || 0;
      host.style.left = `${curLeft - offsetX}px`;
      host.style.top = `${curTop - offsetY}px`;
    }
  };
  window.addEventListener('scroll', () => {
    cancelAnimationFrame(_compensateRAF);
    _compensateRAF = requestAnimationFrame(compensateHostPosition);
  }, { passive: true });
  requestAnimationFrame(compensateHostPosition);

  // React 挂载
  const root = ReactDOM.createRoot(reactRoot);
  root.render(<MoleRoot />);

  // 截图时隐藏/恢复悬浮球（React 版补充，旧版 float-ball.ts 中有对应逻辑）
  import('../lib/channel').then(({ default: Channel }) => {
    Channel.on('__screenshot_hide', (_data: unknown, _sender: unknown, sendResponse?: (resp: unknown) => void) => {
      host.style.display = 'none';
      sendResponse?.({ ok: true });
      return true;
    });
    Channel.on('__screenshot_show', () => {
      host.style.display = '';
    });
  });

  // ---- 宿主文档上的全局事件监听 ----
  // 通过 window 上的自定义事件桥接给 React（closed Shadow DOM 内组件无法访问外部 DOM）

  // 全局快捷键：⌘M (Mac) / Ctrl+M (Win)
  document.addEventListener('keydown', (e) => {
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    if (modKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('mole-toggle'));
    }
  });

  // ESC 键（宿主文档）
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      window.dispatchEvent(new CustomEvent('mole-escape'));
    }
  });

  // 点击外部关闭（宿主文档 mousedown）
  document.addEventListener('mousedown', (e) => {
    const path = e.composedPath();
    if (!path.includes(host)) {
      window.dispatchEvent(new CustomEvent('mole-click-outside'));
    }
  });
};

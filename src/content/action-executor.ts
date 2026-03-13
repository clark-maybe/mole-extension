/**
 * 页面动作执行器（Content Script 侧）
 * 接收来自 background 的 __execute_page_action 消息
 * 在当前页面上执行 DOM 交互操作（点击、填写、选择、滚动、获取元素信息）
 */

import Channel from '../lib/channel';

const isElementVisible = (el: HTMLElement): boolean => {
  if (!el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0;
};

const normalizeText = (value: string): string => value.replace(/\s+/g, '').trim().toLowerCase();

const CLICKABLE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SUMMARY', 'OPTION', 'SELECT', 'LABEL']);

const isElementDisabled = (el: HTMLElement): boolean => {
  if ('disabled' in el && (el as HTMLInputElement | HTMLButtonElement).disabled) return true;
  return el.getAttribute('aria-disabled') === 'true';
};

const getElementText = (el: Element): string => {
  const htmlEl = el as HTMLElement;
  if (htmlEl instanceof HTMLInputElement && typeof htmlEl.value === 'string') {
    return htmlEl.value;
  }
  const aria = htmlEl.getAttribute('aria-label');
  if (aria) return aria;
  return htmlEl.innerText || htmlEl.textContent || '';
};

const isPotentiallyClickable = (el: HTMLElement): boolean => {
  if (!el.isConnected || isElementDisabled(el)) return false;
  if (CLICKABLE_TAGS.has(el.tagName)) return true;
  const role = el.getAttribute('role');
  if (role === 'button' || role === 'link' || role === 'menuitem' || role === 'tab') return true;
  if (el.hasAttribute('onclick')) return true;
  if (typeof el.tabIndex === 'number' && el.tabIndex >= 0 && el.getAttribute('contenteditable') !== 'true') return true;
  const style = window.getComputedStyle(el);
  return style.cursor === 'pointer';
};

const getClickableTarget = (el: HTMLElement): HTMLElement | null => {
  if (isPotentiallyClickable(el) && isElementVisible(el)) return el;
  return el.closest([
    'button',
    'a',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="tab"]',
    'input[type="button"]',
    'input[type="submit"]',
    '[onclick]',
    '[tabindex]',
  ].join(',')) as HTMLElement | null;
};

const setNativeInputValue = (target: HTMLInputElement | HTMLTextAreaElement, nextValue: string): void => {
  const descriptor = target instanceof HTMLInputElement
    ? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
    : Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(target, nextValue);
    return;
  }
  target.value = nextValue;
};

const findElementByText = (text: string, mode: 'contains' | 'exact' = 'contains'): HTMLElement | null => {
  const keyword = normalizeText(text);
  if (!keyword) return null;

  const primaryCandidates = Array.from(document.querySelectorAll([
    'button',
    'a',
    '[role="button"]',
    '[role="link"]',
    'input[type="button"]',
    'input[type="submit"]',
    '[aria-label]',
    '[onclick]',
    '[tabindex]',
  ].join(','))) as HTMLElement[];

  let best: HTMLElement | null = null;
  let bestScore = -1;

  const tryCandidate = (candidate: HTMLElement): void => {
    if (!isElementVisible(candidate)) return;
    if (isElementDisabled(candidate)) return;
    const rawText = getElementText(candidate);
    const value = normalizeText(rawText);
    if (!value) return;

    const matched = mode === 'exact' ? value === keyword : value.includes(keyword);
    if (!matched) return;

    const score = mode === 'exact'
      ? (value === keyword ? 9999 : 0)
      : Math.max(1, keyword.length * 10 - Math.max(0, value.length - keyword.length));

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  };

  for (const candidate of primaryCandidates) {
    tryCandidate(candidate);
  }

  if (best) return best;

  const textNodes = Array.from(document.querySelectorAll('body *')).slice(0, 4000) as HTMLElement[];
  for (const node of textNodes) {
    if (!isElementVisible(node)) continue;
    const value = normalizeText(getElementText(node));
    if (!value) continue;
    const matched = mode === 'exact' ? value === keyword : value.includes(keyword);
    if (!matched) continue;
    const target = getClickableTarget(node);
    if (!target || !isElementVisible(target) || isElementDisabled(target)) continue;
    tryCandidate(target);
  }

  return best;
};

/** 初始化页面动作执行处理器 */
export const initActionExecutor = () => {
  Channel.on('__execute_page_action', (data: any, _sender, sendResponse) => {
    try {
      const { action, selector, value, direction, amount, scroll_to } = data || {};

      switch (action) {
        case 'click': {
          if (!selector) {
            sendResponse?.({ success: false, error: '点击操作需要 selector' });
            return true;
          }
          const el = document.querySelector(selector) as HTMLElement;
          if (!el) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          sendResponse?.({
            success: true,
            data: { message: `已触发点击: ${selector}`, tagName: el.tagName },
          });
          window.setTimeout(() => {
            try {
              el.click();
            } catch {
              // ignore
            }
          }, 0);
          return true;
        }

        case 'click_text': {
          const targetText = (data?.text || '').trim();
          if (!targetText) {
            sendResponse?.({ success: false, error: 'click_text 需要 text' });
            return true;
          }
          const matchMode = data?.match_mode === 'exact' ? 'exact' : 'contains';
          const el = findElementByText(targetText, matchMode);
          if (!el) {
            sendResponse?.({ success: false, error: `未找到包含文本 "${targetText}" 的可点击元素` });
            return true;
          }
          sendResponse?.({
            success: true,
            data: {
              message: `已触发文本点击: ${targetText}`,
              tagName: el.tagName,
              text: (getElementText(el) || '').trim().slice(0, 80),
            },
          });
          window.setTimeout(() => {
            try {
              el.click();
            } catch {
              // ignore
            }
          }, 0);
          return true;
        }

        case 'fill': {
          if (!selector) {
            sendResponse?.({ success: false, error: '填写操作需要 selector' });
            return true;
          }
          const input = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
          if (!input) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          setNativeInputValue(input, value || '');
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse?.({
            success: true,
            data: { message: `已填写: ${selector}`, value },
          });
          return true;
        }

        case 'clear': {
          if (!selector) {
            sendResponse?.({ success: false, error: '清空操作需要 selector' });
            return true;
          }
          const target = document.querySelector(selector) as HTMLElement | null;
          if (!target) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            setNativeInputValue(target, '');
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (target instanceof HTMLSelectElement) {
            target.selectedIndex = -1;
            target.dispatchEvent(new Event('change', { bubbles: true }));
          } else if (target.isContentEditable) {
            target.textContent = '';
            target.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            sendResponse?.({ success: false, error: `${selector} 不是可清空的输入元素` });
            return true;
          }
          sendResponse?.({
            success: true,
            data: { message: `已清空: ${selector}` },
          });
          return true;
        }

        case 'focus': {
          if (!selector) {
            sendResponse?.({ success: false, error: '聚焦操作需要 selector' });
            return true;
          }
          const target = document.querySelector(selector) as HTMLElement | null;
          if (!target) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          if (typeof target.focus !== 'function') {
            sendResponse?.({ success: false, error: `${selector} 不支持 focus()` });
            return true;
          }
          target.focus();
          sendResponse?.({
            success: true,
            data: { message: `已聚焦: ${selector}` },
          });
          return true;
        }

        case 'select': {
          if (!selector) {
            sendResponse?.({ success: false, error: '选择操作需要 selector' });
            return true;
          }
          const selectEl = document.querySelector(selector) as HTMLSelectElement;
          if (!selectEl) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          selectEl.value = value || '';
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse?.({
            success: true,
            data: { message: `已选择: ${selector}`, value },
          });
          return true;
        }

        case 'scroll': {
          if (scroll_to === 'top') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            sendResponse?.({ success: true, data: { message: '已滚动到顶部' } });
          } else if (scroll_to === 'bottom') {
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
            sendResponse?.({ success: true, data: { message: '已滚动到底部' } });
          } else if (selector) {
            const target = document.querySelector(selector) as HTMLElement;
            if (!target) {
              sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
              return true;
            }
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            sendResponse?.({ success: true, data: { message: `已滚动到: ${selector}` } });
          } else if (direction) {
            const px = amount || 500;
            const top = direction === 'up' ? -px : px;
            window.scrollBy({ top, behavior: 'smooth' });
            sendResponse?.({ success: true, data: { message: `已滚动 ${direction} ${px}px` } });
          } else {
            sendResponse?.({ success: false, error: '滚动操作需要 selector、scroll_to 或 direction' });
          }
          return true;
        }

        case 'hover': {
          if (!selector) {
            sendResponse?.({ success: false, error: '悬停操作需要 selector' });
            return true;
          }
          const el = document.querySelector(selector) as HTMLElement;
          if (!el) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
          sendResponse?.({
            success: true,
            data: { message: `已悬停元素: ${selector}`, tagName: el.tagName },
          });
          return true;
        }

        case 'press_key': {
          const { key, modifiers } = data || {};
          if (!key) {
            sendResponse?.({ success: false, error: '按键操作需要 key' });
            return true;
          }

          const modifierSet = new Set(Array.isArray(modifiers) ? modifiers : []);
          const target = selector
            ? document.querySelector(selector) as HTMLElement | null
            : (document.activeElement as HTMLElement | null) || document.body;

          if (!target) {
            sendResponse?.({ success: false, error: selector ? `未找到元素: ${selector}` : '未找到可输入的目标元素' });
            return true;
          }

          if (typeof (target as HTMLElement).focus === 'function') {
            target.focus();
          }

          const eventInit: KeyboardEventInit = {
            key,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifierSet.has('ctrl'),
            shiftKey: modifierSet.has('shift'),
            altKey: modifierSet.has('alt'),
            metaKey: modifierSet.has('meta'),
          };
          target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
          target.dispatchEvent(new KeyboardEvent('keyup', eventInit));

          sendResponse?.({
            success: true,
            data: {
              message: `已触发按键: ${key}`,
              key,
              modifiers: Array.from(modifierSet),
              selector: selector || undefined,
            },
          });
          return true;
        }

        case 'wait_for_element': {
          if (!selector) {
            sendResponse?.({ success: false, error: '等待元素需要 selector' });
            return true;
          }
          const timeoutMs = Math.max(50, Math.floor(Number(data?.timeout_ms) || 5000));
          const requireVisible = data?.visible !== false;
          const startedAt = Date.now();

          const resolveIfMatched = (): HTMLElement | null => {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) return null;
            if (requireVisible && !isElementVisible(el)) return null;
            return el;
          };

          const initialMatched = resolveIfMatched();
          if (initialMatched) {
            sendResponse?.({
              success: true,
              data: {
                message: `元素已存在: ${selector}`,
                selector,
                elapsed_ms: 0,
              },
            });
            return true;
          }

          let settled = false;
          let timeoutHandle: number | undefined;
          const done = (payload: { success: boolean; data?: any; error?: string }) => {
            if (settled) return;
            settled = true;
            if (typeof timeoutHandle === 'number') clearTimeout(timeoutHandle);
            observer.disconnect();
            sendResponse?.(payload);
          };

          const observer = new MutationObserver(() => {
            const matched = resolveIfMatched();
            if (!matched) return;
            done({
              success: true,
              data: {
                message: `等待到元素: ${selector}`,
                selector,
                elapsed_ms: Date.now() - startedAt,
              },
            });
          });

          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
          });

          timeoutHandle = setTimeout(() => {
            done({
              success: false,
              error: `等待元素超时: ${selector}（${timeoutMs}ms）`,
            });
          }, timeoutMs);

          return true;
        }

        case 'wait_text': {
          const targetText = (data?.text || '').trim();
          if (!targetText) {
            sendResponse?.({ success: false, error: 'wait_text 需要 text' });
            return true;
          }
          const timeoutMs = Math.max(50, Math.floor(Number(data?.timeout_ms) || 5000));
          const matchMode = data?.match_mode === 'exact' ? 'exact' : 'contains';
          const startedAt = Date.now();

          const findMatched = (): HTMLElement | null => findElementByText(targetText, matchMode);
          const initial = findMatched();
          if (initial) {
            sendResponse?.({
              success: true,
              data: {
                message: `文本元素已存在: ${targetText}`,
                elapsed_ms: 0,
              },
            });
            return true;
          }

          let settled = false;
          let timeoutHandle: number | undefined;
          const done = (payload: { success: boolean; data?: any; error?: string }) => {
            if (settled) return;
            settled = true;
            if (typeof timeoutHandle === 'number') clearTimeout(timeoutHandle);
            observer.disconnect();
            sendResponse?.(payload);
          };

          const observer = new MutationObserver(() => {
            const matched = findMatched();
            if (!matched) return;
            done({
              success: true,
              data: {
                message: `等待到文本元素: ${targetText}`,
                elapsed_ms: Date.now() - startedAt,
              },
            });
          });

          observer.observe(document.documentElement, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });

          timeoutHandle = setTimeout(() => {
            done({
              success: false,
              error: `等待文本元素超时: ${targetText}（${timeoutMs}ms）`,
            });
          }, timeoutMs);

          return true;
        }

        case 'wait_navigation': {
          const timeoutMs = Math.max(200, Math.floor(Number(data?.timeout_ms) || 10000));
          const stableMs = Math.max(200, Math.floor(Number(data?.stable_ms) || 1200));
          const startedAt = Date.now();
          const initialUrl = window.location.href;
          let lastUrl = initialUrl;
          let lastChangedAt = Date.now();
          let hasChanged = false;

          const timer = window.setInterval(() => {
            const now = Date.now();
            const currentUrl = window.location.href;
            if (currentUrl !== lastUrl) {
              hasChanged = true;
              lastUrl = currentUrl;
              lastChangedAt = now;
            }

            const stableEnough = now - lastChangedAt >= stableMs;
            if (hasChanged && stableEnough) {
              window.clearInterval(timer);
              sendResponse?.({
                success: true,
                data: {
                  message: '页面导航已稳定',
                  from_url: initialUrl,
                  to_url: currentUrl,
                  elapsed_ms: now - startedAt,
                },
              });
              return;
            }

            if (now - startedAt >= timeoutMs) {
              window.clearInterval(timer);
              sendResponse?.({
                success: false,
                error: `等待页面导航稳定超时（${timeoutMs}ms）`,
              });
            }
          }, 160);

          return true;
        }

        case 'get_element_info': {
          if (!selector) {
            sendResponse?.({ success: false, error: '获取元素信息需要 selector' });
            return true;
          }
          const elements = document.querySelectorAll(selector);
          if (elements.length === 0) {
            sendResponse?.({ success: false, error: `未找到元素: ${selector}` });
            return true;
          }
          // 最多返回 10 个元素的信息
          const infos = Array.from(elements).slice(0, 10).map(el => {
            const htmlEl = el as HTMLElement;
            return {
              tagName: el.tagName.toLowerCase(),
              text: (el.textContent || '').trim().slice(0, 200),
              id: el.id || undefined,
              className: el.className || undefined,
              href: (el as HTMLAnchorElement).href || undefined,
              value: (el as HTMLInputElement).value || undefined,
              type: el.getAttribute('type') || undefined,
              placeholder: el.getAttribute('placeholder') || undefined,
              disabled: (el as HTMLInputElement).disabled || undefined,
              visible: htmlEl.offsetParent !== null,
            };
          });
          sendResponse?.({
            success: true,
            data: { count: elements.length, elements: infos },
          });
          return true;
        }

        default:
          sendResponse?.({ success: false, error: `不支持的操作: ${action}` });
          return true;
      }
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '页面操作执行失败' });
      return true;
    }
  });

  // 剪贴板操作
  Channel.on('__clipboard_ops', async (data: any, _sender: any, sendResponse: any) => {
    try {
      const { action, text } = data || {};
      if (action === 'write') {
        if (!text) {
          sendResponse?.({ success: false, error: '写入剪贴板需要提供 text' });
          return true;
        }
        await navigator.clipboard.writeText(text);
        sendResponse?.({ success: true, data: { message: '已复制到剪贴板' } });
      } else if (action === 'read') {
        const content = await navigator.clipboard.readText();
        sendResponse?.({ success: true, data: { text: content } });
      } else {
        sendResponse?.({ success: false, error: `不支持的操作: ${action}` });
      }
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '剪贴板操作失败' });
    }
    return true;
  });

  // 获取用户选中文本
  Channel.on('__get_selection', (_data: any, _sender: any, sendResponse: any) => {
    try {
      const selection = window.getSelection();
      const text = selection?.toString().trim() || '';

      if (!text) {
        sendResponse?.({ success: true, data: { text: '', message: '用户未选中任何文本' } });
        return true;
      }

      // 获取选区周围的上下文（选区所在元素的文本）
      let surroundingText = '';
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer;
        const parentEl = container.nodeType === Node.TEXT_NODE ? container.parentElement : container as HTMLElement;
        if (parentEl) {
          surroundingText = (parentEl.textContent || '').trim().slice(0, 500);
        }
      }

      sendResponse?.({
        success: true,
        data: {
          text,
          length: text.length,
          surroundingText: surroundingText !== text ? surroundingText : undefined,
          pageUrl: window.location.href,
          pageTitle: document.title,
        },
      });
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '获取选中文本失败' });
    }
    return true;
  });
};

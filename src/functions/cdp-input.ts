/**
 * CDP 输入工具
 * 通过 chrome.debugger (Chrome DevTools Protocol) 发送可信鼠标/键盘事件
 * 事件在浏览器进程层面注入，绕过 isTrusted 检测
 * 同时集成表单操作、元素定位、等待操作等页面交互能力
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { CDPSessionManager } from '../lib/cdp-session';
import { sendToTabWithRetry } from './tab-message';
import { sleep } from './tab-utils';

// ============ 辅助函数 ============

/** 获取当前活动标签页 ID */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

/** 修饰键字符串数组转 CDP 位掩码（Alt=1, Ctrl=2, Meta=4, Shift=8） */
const buildModifiersMask = (modifiers?: string[]): number => {
  if (!modifiers || !Array.isArray(modifiers)) return 0;
  let mask = 0;
  for (const mod of modifiers) {
    switch (String(mod).toLowerCase()) {
      case 'alt': mask |= 1; break;
      case 'ctrl': case 'control': mask |= 2; break;
      case 'meta': case 'cmd': case 'command': mask |= 4; break;
      case 'shift': mask |= 8; break;
    }
  }
  return mask;
};

/** 常用按键的 keyCode 和 code 映射 */
const KEY_INFO_MAP: Record<string, { keyCode: number; code: string }> = {
  Enter: { keyCode: 13, code: 'Enter' },
  Tab: { keyCode: 9, code: 'Tab' },
  Escape: { keyCode: 27, code: 'Escape' },
  Backspace: { keyCode: 8, code: 'Backspace' },
  Delete: { keyCode: 46, code: 'Delete' },
  Space: { keyCode: 32, code: 'Space' },
  ArrowUp: { keyCode: 38, code: 'ArrowUp' },
  ArrowDown: { keyCode: 40, code: 'ArrowDown' },
  ArrowLeft: { keyCode: 37, code: 'ArrowLeft' },
  ArrowRight: { keyCode: 39, code: 'ArrowRight' },
  Home: { keyCode: 36, code: 'Home' },
  End: { keyCode: 35, code: 'End' },
  PageUp: { keyCode: 33, code: 'PageUp' },
  PageDown: { keyCode: 34, code: 'PageDown' },
  F1: { keyCode: 112, code: 'F1' },
  F5: { keyCode: 116, code: 'F5' },
  F12: { keyCode: 123, code: 'F12' },
};

/** 向 content script 查询 element_id 对应元素的视口坐标 */
const resolveElementRect = async (
  tabId: number,
  elementId: string,
  signal?: AbortSignal,
): Promise<{ success: true; cx: number; cy: number } | { success: false; error: string }> => {
  try {
    const response = await sendToTabWithRetry<{
      success: boolean;
      rect?: { x: number; y: number; width: number; height: number };
      error?: string;
    }>(
      tabId,
      '__get_element_rect',
      { element_id: elementId },
      { signal, deadlineMs: 5000, timeoutMessage: '查询元素坐标超时' },
    );
    if (!response?.success || !response.rect) {
      return { success: false, error: response?.error || '元素坐标查询失败' };
    }
    const { x, y, width, height } = response.rect;
    return {
      success: true,
      cx: Math.round(x + width / 2),
      cy: Math.round(y + height / 2),
    };
  } catch (err: any) {
    return { success: false, error: err.message || '元素坐标查询失败' };
  }
};

/** 解析目标坐标（element_id 优先，否则用直接坐标） */
const resolveTargetCoords = async (
  tabId: number,
  params: { element_id?: string; x?: number; y?: number },
  signal?: AbortSignal,
): Promise<{ success: true; x: number; y: number } | { success: false; error: string }> => {
  if (params.element_id) {
    const result = await resolveElementRect(tabId, params.element_id, signal);
    if (!result.success) return result;
    return { success: true, x: result.cx, y: result.cy };
  }
  if (typeof params.x === 'number' && typeof params.y === 'number') {
    return { success: true, x: Math.round(params.x), y: Math.round(params.y) };
  }
  return { success: false, error: '需要提供 element_id 或 (x, y) 坐标' };
};

/**
 * 在页面目标元素上执行 JS 代码的辅助函数
 * 支持 selector（直接 querySelector）和 element_id（先获取坐标再 elementFromPoint）两种定位
 * jsTemplate 中使用 __el__ 引用目标元素，需要返回一个对象
 */
const evaluateOnElement = async (
  tabId: number,
  params: { element_id?: string; selector?: string },
  jsTemplate: string,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  // 确保 debugger 已 attach
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: attachResult.error };

  let expression: string;
  if (params.selector) {
    // selector 模式：直接用 querySelector
    expression = `(function() {
      const __el__ = document.querySelector(${JSON.stringify(params.selector)});
      if (!__el__) return { success: false, error: '未找到匹配选择器的元素: ${params.selector.replace(/'/g, "\\'")}' };
      ${jsTemplate}
    })()`;
  } else if (params.element_id) {
    // element_id 模式：先获取坐标，再用 elementFromPoint
    const rect = await resolveElementRect(tabId, params.element_id, signal);
    if (!rect.success) return { success: false, error: rect.error };
    expression = `(function() {
      const __el__ = document.elementFromPoint(${rect.cx}, ${rect.cy});
      if (!__el__) return { success: false, error: '坐标 (${rect.cx}, ${rect.cy}) 处未找到元素' };
      ${jsTemplate}
    })()`;
  } else {
    return { success: false, error: '需要提供 element_id 或 selector' };
  }

  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });

  if (!result.success) return { success: false, error: result.error };
  const value = result.result?.result?.value;
  if (value && typeof value === 'object' && value.success === false) {
    return { success: false, error: value.error };
  }
  return { success: true, data: value };
};

// ============ 动作实现 ============

/** 鼠标点击（mousePressed + mouseReleased，可选前置 mouseMoved） */
const performClick = async (
  tabId: number,
  x: number,
  y: number,
  button: string,
  clickCount: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  // 先移动鼠标到目标位置
  const moveResult = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'none',
  });
  if (!moveResult.success) return { success: false, error: moveResult.error };

  await sleep(20, signal);

  // 按下
  const pressResult = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x, y, button, clickCount,
  });
  if (!pressResult.success) return { success: false, error: pressResult.error };

  await sleep(30, signal);

  // 释放
  const releaseResult = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x, y, button, clickCount,
  });
  if (!releaseResult.success) return { success: false, error: releaseResult.error };

  const buttonLabel = button === 'right' ? '右键' : button === 'middle' ? '中键' : '';
  const clickLabel = clickCount > 1 ? '双击' : '点击';
  return {
    success: true,
    data: { x, y, button, clickCount, message: `CDP ${buttonLabel}${clickLabel} (${x}, ${y})` },
  };
};

/** 鼠标悬停 */
const performHover = async (
  tabId: number,
  x: number,
  y: number,
): Promise<FunctionResult> => {
  const result = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'none',
  });
  if (!result.success) return { success: false, error: result.error };
  return {
    success: true,
    data: { x, y, message: `CDP 悬停 (${x}, ${y})` },
  };
};

/** 拖拽（mousePressed → 多个 mouseMoved → mouseReleased） */
const performDrag = async (
  tabId: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  // 移动到起点
  let r = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: fromX, y: fromY, button: 'none',
  });
  if (!r.success) return { success: false, error: r.error };

  await sleep(30, signal);

  // 按下
  r = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', x: fromX, y: fromY, button: 'left', clickCount: 1,
  });
  if (!r.success) return { success: false, error: r.error };

  await sleep(30, signal);

  // 线性插值轨迹（8 步，带微小随机抖动模拟人类行为）
  const STEPS = 8;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    // 微小随机偏移（±2px），最后一步精确到终点
    const jitterX = i < STEPS ? Math.round((Math.random() - 0.5) * 4) : 0;
    const jitterY = i < STEPS ? Math.round((Math.random() - 0.5) * 4) : 0;
    const mx = Math.round(fromX + (toX - fromX) * t) + jitterX;
    const my = Math.round(fromY + (toY - fromY) * t) + jitterY;

    r = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: mx, y: my, button: 'left',
    });
    if (!r.success) return { success: false, error: r.error };

    await sleep(16, signal);
  }

  // 释放
  r = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: toX, y: toY, button: 'left', clickCount: 1,
  });
  if (!r.success) return { success: false, error: r.error };

  return {
    success: true,
    data: {
      from: { x: fromX, y: fromY },
      to: { x: toX, y: toY },
      message: `CDP 拖拽 (${fromX},${fromY}) → (${toX},${toY})`,
    },
  };
};

/** 键盘输入文本（ASCII 走逐字符键盘事件，非 ASCII 走 insertText 避免重复） */
const performType = async (
  tabId: number,
  text: string,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  if (!text) return { success: true, data: { length: 0, message: 'CDP 输入 0 个字符' } };

  const normalizedInterval = Math.max(0, Math.min(200, Math.floor(intervalMs)));

  for (const char of text) {
    if (signal?.aborted) return { success: false, error: '已取消' };

    const code = char.charCodeAt(0);

    if (code >= 0x20 && code <= 0x7E) {
      // ASCII 可打印字符：keyDown → char → keyUp（保持键盘事件兼容，autocomplete 等场景需要）
      const r1 = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown', text: char,
      });
      if (!r1.success) return { success: false, error: r1.error };

      await CDPSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'char', text: char,
      });

      await CDPSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp', text: char,
      });
    } else {
      // 非 ASCII 字符（中文、日文、emoji 等）：使用 Input.insertText
      // keyDown + char 双事件会导致 CJK 字符被插入两次（"你好" → "你你好好"）
      // insertText 模拟 IME 提交，只产生一次输入
      const r = await CDPSessionManager.sendCommand(tabId, 'Input.insertText', { text: char });
      if (!r.success) return { success: false, error: r.error };
    }

    if (normalizedInterval > 0) {
      await sleep(normalizedInterval, signal);
    }
  }

  return {
    success: true,
    data: { length: text.length, message: `CDP 输入 ${text.length} 个字符` },
  };
};

/** 按键（功能键 / 组合键） */
const performKeyPress = async (
  tabId: number,
  key: string,
  modifiers: number,
): Promise<FunctionResult> => {
  const info = KEY_INFO_MAP[key] || {
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  };

  const baseParams = {
    key,
    code: info.code,
    windowsVirtualKeyCode: info.keyCode,
    nativeVirtualKeyCode: info.keyCode,
    modifiers,
  };

  const r1 = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'rawKeyDown', ...baseParams,
  });
  if (!r1.success) return { success: false, error: r1.error };

  const r2 = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp', ...baseParams,
  });
  if (!r2.success) return { success: false, error: r2.error };

  return {
    success: true,
    data: { key, modifiers, message: `CDP 按键 ${key}${modifiers ? `（修饰键: ${modifiers}）` : ''}` },
  };
};

/** 鼠标滚轮 */
const performScroll = async (
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<FunctionResult> => {
  const r = await CDPSessionManager.sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel', x, y, deltaX, deltaY,
  });
  if (!r.success) return { success: false, error: r.error };
  return {
    success: true,
    data: { x, y, deltaX, deltaY, message: `CDP 滚动 (${deltaX}, ${deltaY}) at (${x}, ${y})` },
  };
};

/** 使用 JS scrollTo/scrollBy 实现滚动（方向/目标模式） */
const performScrollJS = async (
  tabId: number,
  opts: { direction?: string; amount?: number; scroll_to?: string },
): Promise<FunctionResult> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: attachResult.error };

  let expression: string;
  if (opts.scroll_to === 'top') {
    expression = `(function() { window.scrollTo({ top: 0, behavior: 'instant' }); return { success: true, message: '已滚动到页面顶部' }; })()`;
  } else if (opts.scroll_to === 'bottom') {
    expression = `(function() { window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }); return { success: true, message: '已滚动到页面底部' }; })()`;
  } else if (opts.direction) {
    const amount = Math.max(1, Math.floor(Number(opts.amount) || 500));
    let scrollX = 0;
    let scrollY = 0;
    switch (opts.direction) {
      case 'up': scrollY = -amount; break;
      case 'down': scrollY = amount; break;
      case 'left': scrollX = -amount; break;
      case 'right': scrollX = amount; break;
    }
    expression = `(function() { window.scrollBy({ left: ${scrollX}, top: ${scrollY}, behavior: 'instant' }); return { success: true, message: '已滚动 ${opts.direction} ${amount}px' }; })()`;
  } else {
    return { success: false, error: '需要提供 direction 或 scroll_to' };
  }

  const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });

  if (!result.success) return { success: false, error: result.error };
  const value = result.result?.result?.value;
  return { success: true, data: value };
};

/** 填写表单元素值（setNativeInputValue 方式，兼容 React 受控组件） */
const performFill = async (
  tabId: number,
  params: { element_id?: string; selector?: string; value: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const value = params.value;
  // 将 value 安全注入 JS 代码
  const valueJson = JSON.stringify(value);
  const jsTemplate = `
    try {
      const tagName = __el__.tagName.toLowerCase();
      if (__el__.isContentEditable) {
        __el__.focus();
        __el__.textContent = ${valueJson};
        __el__.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: '已填写 contentEditable 元素' };
      }
      if (tagName === 'input' || tagName === 'textarea') {
        __el__.focus();
        var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (!nativeSet || !nativeSet.set) {
          nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        }
        if (nativeSet && nativeSet.set) {
          nativeSet.set.call(__el__, ${valueJson});
        } else {
          __el__.value = ${valueJson};
        }
        __el__.dispatchEvent(new Event('input', { bubbles: true }));
        __el__.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: '已填写 ' + tagName + ' 元素' };
      }
      return { success: false, error: '不支持填写的元素类型: ' + tagName };
    } catch (e) {
      return { success: false, error: '填写失败: ' + e.message };
    }
  `;
  return evaluateOnElement(tabId, params, jsTemplate, signal);
};

/** 清空表单元素值 */
const performClear = async (
  tabId: number,
  params: { element_id?: string; selector?: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const jsTemplate = `
    try {
      const tagName = __el__.tagName.toLowerCase();
      if (__el__.isContentEditable) {
        __el__.focus();
        __el__.textContent = '';
        __el__.dispatchEvent(new Event('input', { bubbles: true }));
        return { success: true, message: '已清空 contentEditable 元素' };
      }
      if (tagName === 'select') {
        __el__.selectedIndex = -1;
        __el__.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: '已清空 select 元素' };
      }
      if (tagName === 'input' || tagName === 'textarea') {
        __el__.focus();
        var nativeSet = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        if (!nativeSet || !nativeSet.set) {
          nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
        }
        if (nativeSet && nativeSet.set) {
          nativeSet.set.call(__el__, '');
        } else {
          __el__.value = '';
        }
        __el__.dispatchEvent(new Event('input', { bubbles: true }));
        __el__.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: '已清空 ' + tagName + ' 元素' };
      }
      return { success: false, error: '不支持清空的元素类型: ' + tagName };
    } catch (e) {
      return { success: false, error: '清空失败: ' + e.message };
    }
  `;
  return evaluateOnElement(tabId, params, jsTemplate, signal);
};

/** 选择下拉选项 */
const performSelect = async (
  tabId: number,
  params: { element_id?: string; selector?: string; value: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const valueJson = JSON.stringify(params.value);
  const jsTemplate = `
    try {
      var selectEl = __el__;
      if (selectEl.tagName.toLowerCase() !== 'select') {
        selectEl = __el__.querySelector('select');
        if (!selectEl) return { success: false, error: '目标元素不是 select 且内部也未找到 select' };
      }
      var options = Array.from(selectEl.options);
      var targetValue = ${valueJson};
      var matched = options.find(function(o) { return o.value === targetValue; })
        || options.find(function(o) { return o.textContent.trim() === targetValue; })
        || options.find(function(o) { return o.textContent.includes(targetValue); });
      if (!matched) {
        var available = options.map(function(o) { return o.value + '(' + o.textContent.trim() + ')'; }).join(', ');
        return { success: false, error: '未找到匹配的选项: ' + targetValue + '。可用选项: ' + available };
      }
      selectEl.value = matched.value;
      selectEl.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true, message: '已选择: ' + matched.textContent.trim(), selectedValue: matched.value };
    } catch (e) {
      return { success: false, error: '选择失败: ' + e.message };
    }
  `;
  return evaluateOnElement(tabId, params, jsTemplate, signal);
};

/** 按文本内容点击元素：在页面中遍历 DOM 找到包含指定文本的可点击元素，获取坐标后用 CDP 点击 */
const performClickText = async (
  tabId: number,
  text: string,
  matchMode: string,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: attachResult.error };

  const textJson = JSON.stringify(text);
  const isExact = matchMode === 'exact';

  // 在页面中搜索匹配文本的可点击元素，返回其中心坐标
  const findExpression = `(function() {
    var targetText = ${textJson};
    var isExact = ${isExact};
    var clickable = ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY', 'DETAILS'];
    var isClickable = function(el) {
      if (!el || el.nodeType !== 1) return false;
      if (clickable.indexOf(el.tagName) >= 0) return true;
      if (el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link' || el.getAttribute('role') === 'tab' || el.getAttribute('role') === 'menuitem') return true;
      if (el.onclick || el.getAttribute('onclick')) return true;
      var cs = window.getComputedStyle(el);
      if (cs.cursor === 'pointer') return true;
      return false;
    };
    var findClickableAncestor = function(node) {
      var el = node.nodeType === 3 ? node.parentElement : node;
      while (el && el !== document.body) {
        if (isClickable(el)) return el;
        el = el.parentElement;
      }
      return null;
    };
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    var candidates = [];
    while (walker.nextNode()) {
      var textNode = walker.currentNode;
      var nodeText = textNode.textContent || '';
      var matched = isExact ? nodeText.trim() === targetText : nodeText.includes(targetText);
      if (!matched) continue;
      var clickEl = findClickableAncestor(textNode);
      if (!clickEl) continue;
      var rect = clickEl.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      var visible = rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0;
      if (!visible) continue;
      candidates.push({
        cx: Math.round(rect.left + rect.width / 2),
        cy: Math.round(rect.top + rect.height / 2),
        text: clickEl.textContent ? clickEl.textContent.trim().substring(0, 80) : '',
        tag: clickEl.tagName.toLowerCase(),
      });
    }
    if (candidates.length === 0) {
      return { success: false, error: '未找到包含文本 "' + targetText + '" 的可点击元素' };
    }
    return { success: true, element: candidates[0] };
  })()`;

  const findResult = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
    expression: findExpression,
    returnByValue: true,
    awaitPromise: false,
  });

  if (!findResult.success) return { success: false, error: findResult.error };
  const findValue = findResult.result?.result?.value;
  if (!findValue || findValue.success === false) {
    return { success: false, error: findValue?.error || '查找文本元素失败' };
  }

  const { cx, cy } = findValue.element;
  // 用 CDP 可信点击
  const clickResult = await performClick(tabId, cx, cy, 'left', 1, signal);
  if (!clickResult.success) return clickResult;

  return {
    success: true,
    data: {
      ...findValue.element,
      message: `CDP 点击文本 "${text}" → (${cx}, ${cy}) [${findValue.element.tag}]`,
    },
  };
};

/** 滚动元素到可视区域 */
const performScrollIntoView = async (
  tabId: number,
  params: { element_id?: string; selector?: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const jsTemplate = `
    try {
      __el__.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      return { success: true, message: '已滚动元素到可视区域' };
    } catch (e) {
      return { success: false, error: '滚动失败: ' + e.message };
    }
  `;
  return evaluateOnElement(tabId, params, jsTemplate, signal);
};

/** 聚焦元素 */
const performFocus = async (
  tabId: number,
  params: { element_id?: string; selector?: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const jsTemplate = `
    try {
      __el__.focus();
      return { success: true, message: '已聚焦元素: ' + __el__.tagName.toLowerCase() };
    } catch (e) {
      return { success: false, error: '聚焦失败: ' + e.message };
    }
  `;
  return evaluateOnElement(tabId, params, jsTemplate, signal);
};

/** 等待元素出现（轮询） */
const performWaitForElement = async (
  tabId: number,
  selector: string,
  timeoutMs: number,
  visible: boolean,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: attachResult.error };

  const normalizedTimeout = Math.max(200, Math.floor(Number(timeoutMs) || 5000));
  const selectorJson = JSON.stringify(selector);
  const startedAt = Date.now();

  while (Date.now() - startedAt < normalizedTimeout) {
    if (signal?.aborted) return { success: false, error: '已取消' };

    const checkExpression = `(function() {
      var el = document.querySelector(${selectorJson});
      if (!el) return { found: false };
      if (${visible}) {
        var rect = el.getBoundingClientRect();
        var cs = window.getComputedStyle(el);
        if (rect.width === 0 && rect.height === 0) return { found: false };
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return { found: false };
      }
      return { found: true, tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().substring(0, 60) };
    })()`;

    const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
      expression: checkExpression,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.success) {
      const value = result.result?.result?.value;
      if (value?.found) {
        return {
          success: true,
          data: {
            message: `元素已找到: ${selector}`,
            tag: value.tag,
            text: value.text,
            elapsed_ms: Date.now() - startedAt,
          },
        };
      }
    }

    await sleep(300, signal);
  }

  return { success: false, error: `等待元素超时（${normalizedTimeout}ms）: ${selector}` };
};

/** 等待页面中出现指定文本（轮询） */
const performWaitText = async (
  tabId: number,
  text: string,
  matchMode: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const attachResult = await CDPSessionManager.attach(tabId);
  if (!attachResult.success) return { success: false, error: attachResult.error };

  const normalizedTimeout = Math.max(200, Math.floor(Number(timeoutMs) || 5000));
  const textJson = JSON.stringify(text);
  const isExact = matchMode === 'exact';
  const startedAt = Date.now();

  while (Date.now() - startedAt < normalizedTimeout) {
    if (signal?.aborted) return { success: false, error: '已取消' };

    const checkExpression = `(function() {
      var bodyText = document.body ? document.body.innerText : '';
      var target = ${textJson};
      var matched = ${isExact} ? bodyText.trim() === target : bodyText.includes(target);
      return { matched: matched };
    })()`;

    const result = await CDPSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
      expression: checkExpression,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.success) {
      const value = result.result?.result?.value;
      if (value?.matched) {
        return {
          success: true,
          data: {
            message: `已找到文本: "${text}"`,
            elapsed_ms: Date.now() - startedAt,
          },
        };
      }
    }

    await sleep(300, signal);
  }

  return { success: false, error: `等待文本超时（${normalizedTimeout}ms）: "${text}"` };
};

/** 等待页面导航稳定（从 page-action.ts 搬迁） */
interface WaitNavigationOptions {
  timeoutMs: number;
  stableMs: number;
  requireUrlChange: boolean;
  expectedUrlContains?: string;
  expectedUrlRegex?: string;
}

const waitForTabNavigationStable = async (
  tabId: number,
  options: WaitNavigationOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> => {
  const timeoutMs = Math.max(200, Math.floor(Number(options.timeoutMs) || 10_000));
  const stableMs = Math.max(200, Math.floor(Number(options.stableMs) || 1_200));
  const requireUrlChange = options.requireUrlChange !== false;
  const expectedUrlContains = String(options.expectedUrlContains || '').trim();
  const expectedUrlRegexText = String(options.expectedUrlRegex || '').trim();
  const expectedUrlRegex = expectedUrlRegexText
    ? (() => {
      try {
        return new RegExp(expectedUrlRegexText);
      } catch {
        return null;
      }
    })()
    : null;

  const urlMatched = (url: string): boolean => {
    if (!url) return false;
    if (expectedUrlContains && url.includes(expectedUrlContains)) return true;
    if (expectedUrlRegex && expectedUrlRegex.test(url)) return true;
    return false;
  };

  const initialTab = await chrome.tabs.get(tabId);
  const fromUrl = initialTab.url || initialTab.pendingUrl || '';
  let currentUrl = fromUrl;
  let currentStatus = initialTab.status || 'complete';
  let sawUrlChange = false;
  let sawLoading = currentStatus === 'loading';
  let expectedMatched = urlMatched(currentUrl);
  let lastActivityAt = Date.now();
  const startedAt = Date.now();

  const applyTabSnapshot = (tab?: chrome.tabs.Tab | null): void => {
    if (!tab) return;
    const nextUrl = tab.url || tab.pendingUrl || '';
    const nextStatus = tab.status || currentStatus;
    const now = Date.now();
    if (nextUrl && nextUrl !== currentUrl) {
      currentUrl = nextUrl;
      sawUrlChange = true;
      lastActivityAt = now;
    } else if (!currentUrl && nextUrl) {
      currentUrl = nextUrl;
    }
    if (urlMatched(nextUrl)) expectedMatched = true;
    if (nextStatus !== currentStatus) {
      currentStatus = nextStatus;
      lastActivityAt = now;
    } else {
      currentStatus = nextStatus;
    }
    if (nextStatus === 'loading') {
      sawLoading = true;
      lastActivityAt = now;
    }
  };

  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (pollHandle) clearInterval(pollHandle);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      signal?.removeEventListener('abort', handleAbort);
    };

    const done = (payload: { success: true; data: Record<string, unknown> } | { success: false; error: string }) => {
      if (settled) return;
      cleanup();
      if (payload.success) {
        resolve(payload.data);
      } else {
        reject(new Error(payload.error));
      }
    };

    const maybeResolve = () => {
      const now = Date.now();
      const hasTrigger = requireUrlChange
        ? (sawUrlChange || sawLoading || expectedMatched)
        : true;
      if (!hasTrigger) return;
      if (currentStatus !== 'complete') return;
      if (now - lastActivityAt < stableMs) return;
      done({
        success: true,
        data: {
          message: '页面导航已稳定',
          from_url: fromUrl,
          to_url: currentUrl,
          elapsed_ms: now - startedAt,
          require_url_change: requireUrlChange,
          url_changed: sawUrlChange,
          saw_loading: sawLoading,
          expected_url_matched: expectedMatched,
        },
      });
    };

    const handleUpdated = (updatedTabId: number, _changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (updatedTabId !== tabId) return;
      applyTabSnapshot(tab);
      maybeResolve();
    };

    const handleAbort = () => {
      done({
        success: false,
        error: 'aborted',
      });
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    signal?.addEventListener('abort', handleAbort, { once: true });

    timeoutHandle = setTimeout(() => {
      done({
        success: false,
        error: `等待页面导航稳定超时（${timeoutMs}ms）`,
      });
    }, timeoutMs);

    pollHandle = setInterval(() => {
      void chrome.tabs.get(tabId)
        .then((tab) => {
          applyTabSnapshot(tab);
          maybeResolve();
        })
        .catch(() => {
          done({
            success: false,
            error: `目标标签页不可用: ${tabId}`,
          });
        });
    }, 180);

    maybeResolve();
  });
};

/** 获取元素信息 */
const performGetInfo = async (
  tabId: number,
  params: { element_id?: string; selector?: string },
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const jsTemplate = `
    try {
      var rect = __el__.getBoundingClientRect();
      var cs = window.getComputedStyle(__el__);
      var visible = rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
      return {
        success: true,
        info: {
          tagName: __el__.tagName.toLowerCase(),
          id: __el__.id || '',
          classes: Array.from(__el__.classList).join(' '),
          text: (__el__.textContent || '').trim().substring(0, 200),
          value: __el__.value !== undefined ? String(__el__.value) : '',
          type: __el__.type || '',
          disabled: !!__el__.disabled,
          checked: !!__el__.checked,
          href: __el__.href || '',
          src: __el__.src || '',
          placeholder: __el__.placeholder || '',
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
          visible: visible,
        },
      };
    } catch (e) {
      return { success: false, error: '获取元素信息失败: ' + e.message };
    }
  `;
  const result = await evaluateOnElement(tabId, params, jsTemplate, signal);
  if (!result.success) return result;
  // evaluateOnElement 返回的 data 是 { success: true, info: {...} }
  if (result.data?.info) {
    return { success: true, data: result.data.info };
  }
  return result;
};

// ============ 工具定义 ============

export const cdpInputFunction: FunctionDefinition = {
  name: 'cdp_input',
  description: [
    'Perform interaction actions on the page the user is currently browsing. This is the primary tool for operating on pages.',
    'Click: click/double_click/right_click/click_text (click by visible text).',
    'Input: fill (fill form)/clear/select (dropdown)/type (character-by-character input)/key_press/focus.',
    'Scroll: scroll/scroll_into_view.',
    'Wait: wait_for_element/wait_text/wait_navigation.',
    'Other: hover/drag/get_info.',
    'Targeting: element_id (from page_snapshot, preferred) or selector (CSS selector) or x/y coordinates.',
  ].join(' ') + '\n\n⚠️ Do NOT use this tool for:\n- Reading page content (use page_viewer)\n- Checking element existence (use page_snapshot or page_assert)\n- Getting element text (use cdp_dom get_text)',
  supportsParallel: false,
  permissionLevel: 'interact',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'click', 'double_click', 'right_click', 'hover', 'drag', 'type', 'key_press', 'scroll',
          'fill', 'clear', 'select', 'click_text', 'scroll_into_view', 'focus',
          'wait_for_element', 'wait_text', 'wait_navigation', 'get_info',
        ],
        description: 'Action type',
      },
      element_id: {
        type: 'string',
        description: 'Element handle returned by page_snapshot. Used to locate the target element, takes priority over selector and x/y coordinates',
      },
      selector: {
        type: 'string',
        description: 'CSS selector. Available for fill/clear/select/focus/scroll_into_view/get_info/wait_for_element/click_text',
      },
      x: {
        type: 'number',
        description: 'Target X coordinate (viewport). Used when element_id is not available',
      },
      y: {
        type: 'number',
        description: 'Target Y coordinate (viewport). Used when element_id is not available',
      },
      to_x: {
        type: 'number',
        description: 'End X coordinate for drag action',
      },
      to_y: {
        type: 'number',
        description: 'End Y coordinate for drag action',
      },
      text: {
        type: 'string',
        description: 'Text to input for type action, or matching text for click_text/wait_text',
      },
      value: {
        type: 'string',
        description: 'Target value for fill/select',
      },
      key: {
        type: 'string',
        description: 'Key name for key_press, e.g. Enter, Tab, Escape, ArrowDown, Backspace, Space',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description: 'Modifier keys for key_press, options: ctrl/shift/alt/meta',
      },
      match_mode: {
        type: 'string',
        enum: ['contains', 'exact'],
        description: 'Text matching mode for click_text/wait_text, default contains',
      },
      delta_x: {
        type: 'number',
        description: 'Horizontal scroll amount in pixels for scroll, positive means right. Default 0',
      },
      delta_y: {
        type: 'number',
        description: 'Vertical scroll amount in pixels for scroll, positive means down. Default 120',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction (mutually exclusive with scroll_to, no coordinates needed)',
      },
      scroll_to: {
        type: 'string',
        enum: ['top', 'bottom'],
        description: 'Scroll target top/bottom (no coordinates needed)',
      },
      amount: {
        type: 'number',
        description: 'Scroll pixel amount (used with direction), default 500',
      },
      interval_ms: {
        type: 'number',
        description: 'Character interval in milliseconds for type action, default 30, range 0-200',
      },
      timeout_ms: {
        type: 'number',
        description: 'Wait timeout in milliseconds (wait_for_element/wait_text default 5000, wait_navigation default 10000)',
      },
      visible: {
        type: 'boolean',
        description: 'Whether wait_for_element requires the element to be visible, default true',
      },
      stable_ms: {
        type: 'number',
        description: 'Navigation stability duration for wait_navigation, default 1200ms',
      },
      require_url_change: {
        type: 'boolean',
        description: 'Whether wait_navigation requires URL change, default true',
      },
      url_contains: {
        type: 'string',
        description: 'URL substring match for wait_navigation',
      },
      url_regex: {
        type: 'string',
        description: 'URL regex match for wait_navigation (string form)',
      },
      tab_id: {
        type: 'number',
        description: 'Target tab ID. Uses the current active tab if not provided.',
      },
    },
    required: ['action'],
  },
  validate: (params: {
    action?: string;
    element_id?: string;
    selector?: string;
    x?: number;
    y?: number;
    to_x?: number;
    to_y?: number;
    text?: string;
    value?: string;
    key?: string;
    direction?: string;
    scroll_to?: string;
  }) => {
    if (!params?.action) return 'Missing action parameter';

    // 需要坐标的原始鼠标操作（不包含 scroll，scroll 有多种模式）
    const needCoords = ['click', 'double_click', 'right_click', 'hover'];
    if (needCoords.includes(params.action) && !params.element_id && (typeof params.x !== 'number' || typeof params.y !== 'number')) {
      return `${params.action} requires element_id or (x, y) coordinates`;
    }

    if (params.action === 'drag') {
      if (!params.element_id && (typeof params.x !== 'number' || typeof params.y !== 'number')) {
        return 'drag requires origin element_id or (x, y)';
      }
      if (typeof params.to_x !== 'number' || typeof params.to_y !== 'number') {
        return 'drag requires destination (to_x, to_y)';
      }
    }

    if (params.action === 'type' && !params.text) {
      return 'type requires text parameter';
    }

    if (params.action === 'key_press' && !params.key) {
      return 'key_press requires key parameter';
    }

    // scroll 支持三种模式：坐标+delta / direction / scroll_to
    if (params.action === 'scroll') {
      const hasCoords = params.element_id || (typeof params.x === 'number' && typeof params.y === 'number');
      const hasDirection = !!params.direction;
      const hasScrollTo = !!params.scroll_to;
      if (!hasCoords && !hasDirection && !hasScrollTo) {
        return 'scroll requires element_id/(x,y) coordinates or direction or scroll_to';
      }
    }

    // fill/select 需要定位器 + value
    if (params.action === 'fill' || params.action === 'select') {
      if (!params.element_id && !params.selector) {
        return `${params.action} requires element_id or selector`;
      }
      if (typeof params.value !== 'string') {
        return `${params.action} requires value parameter (string)`;
      }
    }

    // clear/focus/scroll_into_view/get_info 需要定位器
    const needLocator = ['clear', 'focus', 'scroll_into_view', 'get_info'];
    if (needLocator.includes(params.action) && !params.element_id && !params.selector) {
      return `${params.action} requires element_id or selector`;
    }

    // click_text/wait_text 需要 text
    if ((params.action === 'click_text' || params.action === 'wait_text') && !params.text) {
      return `${params.action} requires text parameter`;
    }

    // wait_for_element 需要 selector
    if (params.action === 'wait_for_element' && !params.selector) {
      return 'wait_for_element requires selector parameter';
    }

    return null;
  },
  execute: async (
    params: {
      action: string;
      element_id?: string;
      selector?: string;
      x?: number;
      y?: number;
      to_x?: number;
      to_y?: number;
      text?: string;
      value?: string;
      key?: string;
      modifiers?: string[];
      match_mode?: string;
      delta_x?: number;
      delta_y?: number;
      direction?: string;
      scroll_to?: string;
      amount?: number;
      interval_ms?: number;
      timeout_ms?: number;
      visible?: boolean;
      stable_ms?: number;
      require_url_change?: boolean;
      url_contains?: string;
      url_regex?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    // 确定目标 tabId（优先级：params.tab_id > context.tabId > 当前活动标签页）
    const { tab_id } = params;
    let tabId: number;
    if (typeof tab_id === 'number' && tab_id > 0) {
      tabId = tab_id;
    } else if (typeof context?.tabId === 'number' && context.tabId > 0) {
      tabId = context.tabId;
    } else {
      const activeTabId = await getActiveTabId();
      if (!activeTabId) {
        return { success: false, error: '无法获取当前标签页' };
      }
      tabId = activeTabId;
    }

    // wait_navigation 不需要 CDP debugger（使用 chrome.tabs.onUpdated）
    // 其他操作需要检查 CDP 可用性
    if (params.action !== 'wait_navigation') {
      if (!CDPSessionManager.isSupported()) {
        return { success: false, error: 'chrome.debugger API 不可用' };
      }
    }

    const signal = context?.signal;

    switch (params.action) {
      case 'click':
      case 'double_click':
      case 'right_click': {
        const coords = await resolveTargetCoords(tabId, params, signal);
        if (!coords.success) return { success: false, error: coords.error };

        const button = params.action === 'right_click' ? 'right' : 'left';
        const clickCount = params.action === 'double_click' ? 2 : 1;
        return performClick(tabId, coords.x, coords.y, button, clickCount, signal);
      }

      case 'hover': {
        const coords = await resolveTargetCoords(tabId, params, signal);
        if (!coords.success) return { success: false, error: coords.error };
        return performHover(tabId, coords.x, coords.y);
      }

      case 'drag': {
        const fromCoords = await resolveTargetCoords(tabId, params, signal);
        if (!fromCoords.success) return { success: false, error: fromCoords.error };
        return performDrag(tabId, fromCoords.x, fromCoords.y, params.to_x!, params.to_y!, signal);
      }

      case 'type': {
        return performType(tabId, params.text || '', params.interval_ms ?? 30, signal);
      }

      case 'key_press': {
        const modMask = buildModifiersMask(params.modifiers);
        return performKeyPress(tabId, params.key!, modMask);
      }

      case 'scroll': {
        // 优先使用 direction/scroll_to 模式（JS 方式，不需要坐标）
        if (params.direction || params.scroll_to) {
          return performScrollJS(tabId, {
            direction: params.direction,
            amount: params.amount,
            scroll_to: params.scroll_to,
          });
        }
        // 传统 delta 模式（需要坐标）
        const coords = await resolveTargetCoords(tabId, params, signal);
        if (!coords.success) return { success: false, error: coords.error };
        return performScroll(tabId, coords.x, coords.y, params.delta_x ?? 0, params.delta_y ?? 120);
      }

      case 'fill': {
        return performFill(tabId, { element_id: params.element_id, selector: params.selector, value: params.value! }, signal);
      }

      case 'clear': {
        return performClear(tabId, { element_id: params.element_id, selector: params.selector }, signal);
      }

      case 'select': {
        return performSelect(tabId, { element_id: params.element_id, selector: params.selector, value: params.value! }, signal);
      }

      case 'click_text': {
        return performClickText(tabId, params.text!, params.match_mode || 'contains', signal);
      }

      case 'scroll_into_view': {
        return performScrollIntoView(tabId, { element_id: params.element_id, selector: params.selector }, signal);
      }

      case 'focus': {
        return performFocus(tabId, { element_id: params.element_id, selector: params.selector }, signal);
      }

      case 'wait_for_element': {
        return performWaitForElement(tabId, params.selector!, params.timeout_ms ?? 5000, params.visible !== false, signal);
      }

      case 'wait_text': {
        return performWaitText(tabId, params.text!, params.match_mode || 'contains', params.timeout_ms ?? 5000, signal);
      }

      case 'wait_navigation': {
        try {
          const data = await waitForTabNavigationStable(
            tabId,
            {
              timeoutMs: params.timeout_ms ?? 10_000,
              stableMs: params.stable_ms ?? 1_200,
              requireUrlChange: params.require_url_change !== false,
              expectedUrlContains: params.url_contains,
              expectedUrlRegex: params.url_regex,
            },
            signal,
          );
          return { success: true, data };
        } catch (err: any) {
          return { success: false, error: err?.message || '等待页面导航稳定失败' };
        }
      }

      case 'get_info': {
        return performGetInfo(tabId, { element_id: params.element_id, selector: params.selector }, signal);
      }

      default:
        return { success: false, error: `不支持的动作: ${params.action}` };
    }
  },
};

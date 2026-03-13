/**
 * CDP 输入工具
 * 通过 chrome.debugger (Chrome DevTools Protocol) 发送可信鼠标/键盘事件
 * 事件在浏览器进程层面注入，绕过 isTrusted 检测
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

/** 键盘输入文本（逐字符 keyDown → char → keyUp） */
const performType = async (
  tabId: number,
  text: string,
  intervalMs: number,
  signal?: AbortSignal,
): Promise<FunctionResult> => {
  const normalizedInterval = Math.max(0, Math.min(200, Math.floor(intervalMs)));

  for (const char of text) {
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

// ============ 工具定义 ============

export const cdpInputFunction: FunctionDefinition = {
  name: 'cdp_input',
  description: [
    '通过 Chrome DevTools Protocol 发送可信鼠标/键盘事件（绕过 isTrusted 检测）。',
    '适用场景：普通 page_action 点击无效（被反爬拦截）、需要拖拽操作（滑块验证）、需要精确坐标操作。',
    '定位方式：优先传 element_id（来自 page_snapshot），也可直接传 x/y 坐标。',
    '支持动作：click / double_click / right_click / hover / drag / type / key_press / scroll。',
    '注意：首次使用时会 attach debugger，页面顶部会出现调试提示条。',
  ].join(' '),
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['click', 'double_click', 'right_click', 'hover', 'drag', 'type', 'key_press', 'scroll'],
        description: '输入动作类型',
      },
      element_id: {
        type: 'string',
        description: 'page_snapshot 返回的元素句柄。click/double_click/right_click/hover/drag(起点)/scroll 可用，优先于 x/y 坐标',
      },
      x: {
        type: 'number',
        description: '目标 X 坐标（视口坐标）。element_id 不可用时使用',
      },
      y: {
        type: 'number',
        description: '目标 Y 坐标（视口坐标）。element_id 不可用时使用',
      },
      to_x: {
        type: 'number',
        description: 'drag 动作的终点 X 坐标',
      },
      to_y: {
        type: 'number',
        description: 'drag 动作的终点 Y 坐标',
      },
      text: {
        type: 'string',
        description: 'type 动作要输入的文本',
      },
      key: {
        type: 'string',
        description: 'key_press 的按键名，如 Enter、Tab、Escape、ArrowDown、Backspace、Space',
      },
      modifiers: {
        type: 'array',
        items: { type: 'string' },
        description: 'key_press 的修饰键，可选 ctrl/shift/alt/meta',
      },
      delta_x: {
        type: 'number',
        description: 'scroll 水平滚动量（像素），正数向右。默认 0',
      },
      delta_y: {
        type: 'number',
        description: 'scroll 垂直滚动量（像素），正数向下。默认 120',
      },
      interval_ms: {
        type: 'number',
        description: 'type 动作的字符间隔毫秒数，默认 30，范围 0-200',
      },
    },
    required: ['action'],
  },
  validate: (params: {
    action?: string;
    element_id?: string;
    x?: number;
    y?: number;
    to_x?: number;
    to_y?: number;
    text?: string;
    key?: string;
  }) => {
    if (!params?.action) return '缺少 action';
    const needCoords = ['click', 'double_click', 'right_click', 'hover', 'scroll'];
    if (needCoords.includes(params.action) && !params.element_id && (typeof params.x !== 'number' || typeof params.y !== 'number')) {
      return `${params.action} 需要提供 element_id 或 (x, y) 坐标`;
    }
    if (params.action === 'drag') {
      if (!params.element_id && (typeof params.x !== 'number' || typeof params.y !== 'number')) {
        return 'drag 需要提供起点 element_id 或 (x, y)';
      }
      if (typeof params.to_x !== 'number' || typeof params.to_y !== 'number') {
        return 'drag 需要提供终点 (to_x, to_y)';
      }
    }
    if (params.action === 'type' && !params.text) {
      return 'type 需要提供 text';
    }
    if (params.action === 'key_press' && !params.key) {
      return 'key_press 需要提供 key';
    }
    return null;
  },
  execute: async (
    params: {
      action: string;
      element_id?: string;
      x?: number;
      y?: number;
      to_x?: number;
      to_y?: number;
      text?: string;
      key?: string;
      modifiers?: string[];
      delta_x?: number;
      delta_y?: number;
      interval_ms?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    // 获取 tabId
    let tabId = context?.tabId;
    if (!tabId) {
      tabId = (await getActiveTabId()) ?? undefined;
    }
    if (!tabId) {
      return { success: false, error: '无法获取当前标签页' };
    }

    // 检查 CDP 可用性
    if (!CDPSessionManager.isSupported()) {
      return { success: false, error: 'chrome.debugger API 不可用' };
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
        const coords = await resolveTargetCoords(tabId, params, signal);
        if (!coords.success) return { success: false, error: coords.error };
        return performScroll(tabId, coords.x, coords.y, params.delta_x ?? 0, params.delta_y ?? 120);
      }

      default:
        return { success: false, error: `不支持的动作: ${params.action}` };
    }
  },
};

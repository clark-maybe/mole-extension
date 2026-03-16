/**
 * DOM 操作工具
 * 使用 chrome.scripting.executeScript() 在页面主世界中操作 DOM
 * 提供结构化的 DOM 读写能力，覆盖查询、修改、插入、删除、样式、类名等操作
 */

import type { FunctionDefinition, ToolExecutionContext } from './types';

/** 获取当前活动标签页 ID 作为 fallback */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

/** 注入到页面中执行的 DOM 操作调度器 */
const injectedDomDispatcher = (
  action: string,
  selector: string,
  params: Record<string, any>,
): any => {
  // 工具函数：获取目标元素
  const getElements = (sel: string, all: boolean): Element[] => {
    if (!sel) return [];
    if (all) return Array.from(document.querySelectorAll(sel));
    const el = document.querySelector(sel);
    return el ? [el] : [];
  };

  // 工具函数：序列化元素信息
  const serializeElement = (el: Element, index: number) => {
    const rect = el.getBoundingClientRect();
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      attrs[attr.name] = attr.value;
    }
    return {
      index,
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: Array.from(el.classList),
      text: (el.textContent || '').trim().substring(0, 300),
      attributes: attrs,
      visible: rect.width > 0 && rect.height > 0,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  };

  try {
    const all = params.all === true;
    const elements = getElements(selector, all || action === 'query');

    if (action !== 'waitFor' && action !== 'query' && elements.length === 0) {
      return { success: false, error: `未找到匹配 "${selector}" 的元素` };
    }

    switch (action) {
      // ============ 查询 ============
      case 'query': {
        const limit = params.limit || 20;
        const items = elements.slice(0, limit).map((el, i) => serializeElement(el, i));
        return { success: true, data: { total: elements.length, showing: items.length, elements: items } };
      }

      // ============ 读取 ============
      case 'getText': {
        if (all) {
          return { success: true, data: { results: elements.map((el, i) => ({ index: i, text: (el.textContent || '').trim() })) } };
        }
        return { success: true, data: { text: (elements[0].textContent || '').trim() } };
      }

      case 'getHTML': {
        const outer = params.outer === true;
        if (all) {
          return { success: true, data: { results: elements.map((el, i) => ({ index: i, html: outer ? el.outerHTML : el.innerHTML })) } };
        }
        return { success: true, data: { html: outer ? elements[0].outerHTML : elements[0].innerHTML } };
      }

      case 'getAttribute': {
        const attr = params.attribute;
        if (!attr) return { success: false, error: '需要指定 attribute 参数' };
        if (all) {
          return { success: true, data: { results: elements.map((el, i) => ({ index: i, value: el.getAttribute(attr) })) } };
        }
        return { success: true, data: { value: elements[0].getAttribute(attr) } };
      }

      case 'getStyle': {
        const prop = params.property;
        if (!prop) return { success: false, error: '需要指定 property 参数（CSS 属性名）' };
        const computed = window.getComputedStyle(elements[0]);
        return { success: true, data: { property: prop, value: (computed as any)[prop] || computed.getPropertyValue(prop) } };
      }

      // ============ 修改内容 ============
      case 'setText': {
        const value = params.value ?? '';
        // 保护 #mole-root：操作前保存引用，操作后恢复
        const moleRoot = document.getElementById('mole-root');
        elements.forEach(el => { el.textContent = value; });
        if (moleRoot && !moleRoot.isConnected) {
          document.body.appendChild(moleRoot);
        }
        return { success: true, data: { message: `已设置 ${elements.length} 个元素的文本内容` } };
      }

      case 'setHTML': {
        const html = params.value ?? '';
        // 保护 #mole-root：操作前保存引用，操作后恢复
        const moleRoot = document.getElementById('mole-root');
        elements.forEach(el => { el.innerHTML = html; });
        if (moleRoot && !moleRoot.isConnected) {
          document.body.appendChild(moleRoot);
        }
        return { success: true, data: { message: `已设置 ${elements.length} 个元素的 HTML` } };
      }

      case 'insertHTML': {
        const position = (params.position || 'beforeend') as InsertPosition;
        const html = params.value ?? '';
        if (!['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(position)) {
          return { success: false, error: `无效的 position: ${position}，可选: beforebegin/afterbegin/beforeend/afterend` };
        }
        elements.forEach(el => { el.insertAdjacentHTML(position, html); });
        return { success: true, data: { message: `已在 ${elements.length} 个元素的 ${position} 位置插入 HTML` } };
      }

      // ============ 属性操作 ============
      case 'setAttribute': {
        const attr = params.attribute;
        const value = params.value ?? '';
        if (!attr) return { success: false, error: '需要指定 attribute 参数' };
        elements.forEach(el => { el.setAttribute(attr, value); });
        return { success: true, data: { message: `已设置 ${elements.length} 个元素的 ${attr} 属性` } };
      }

      case 'removeAttribute': {
        const attr = params.attribute;
        if (!attr) return { success: false, error: '需要指定 attribute 参数' };
        elements.forEach(el => { el.removeAttribute(attr); });
        return { success: true, data: { message: `已移除 ${elements.length} 个元素的 ${attr} 属性` } };
      }

      // ============ 样式操作 ============
      case 'setStyle': {
        const styles = params.styles;
        if (!styles || typeof styles !== 'object') return { success: false, error: '需要指定 styles 参数（对象格式，如 {"color":"red","fontSize":"16px"}）' };
        elements.forEach(el => {
          const htmlEl = el as HTMLElement;
          for (const [prop, val] of Object.entries(styles)) {
            htmlEl.style.setProperty(prop, String(val));
          }
        });
        return { success: true, data: { message: `已设置 ${elements.length} 个元素的样式` } };
      }

      // ============ 类名操作 ============
      case 'addClass': {
        const classes = (params.value || '').split(/\s+/).filter(Boolean);
        if (classes.length === 0) return { success: false, error: '需要指定 value（空格分隔的类名）' };
        elements.forEach(el => { el.classList.add(...classes); });
        return { success: true, data: { message: `已为 ${elements.length} 个元素添加类名: ${classes.join(', ')}` } };
      }

      case 'removeClass': {
        const classes = (params.value || '').split(/\s+/).filter(Boolean);
        if (classes.length === 0) return { success: false, error: '需要指定 value（空格分隔的类名）' };
        elements.forEach(el => { el.classList.remove(...classes); });
        return { success: true, data: { message: `已从 ${elements.length} 个元素移除类名: ${classes.join(', ')}` } };
      }

      case 'toggleClass': {
        const classes = (params.value || '').split(/\s+/).filter(Boolean);
        if (classes.length === 0) return { success: false, error: '需要指定 value（空格分隔的类名）' };
        elements.forEach(el => { classes.forEach(c => el.classList.toggle(c)); });
        return { success: true, data: { message: `已切换 ${elements.length} 个元素的类名: ${classes.join(', ')}` } };
      }

      // ============ 结构操作 ============
      case 'removeElement': {
        // 过滤掉 #mole-root 元素，不允许删除
        const safeElements = elements.filter(el => el.id !== 'mole-root');
        const count = safeElements.length;
        safeElements.forEach(el => el.remove());
        return { success: true, data: { message: `已删除 ${count} 个元素` } };
      }

      case 'cloneElement': {
        const position = params.position || 'afterend';
        if (!['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(position)) {
          return { success: false, error: `无效的 position: ${position}` };
        }
        const el = elements[0];
        const clone = el.cloneNode(true) as Element;
        // 若指定了新 id，避免重复
        if (params.new_id) {
          clone.id = params.new_id;
        }
        el.insertAdjacentElement(position as InsertPosition, clone);
        return { success: true, data: { message: '已克隆元素' } };
      }

      // ============ 等待元素 ============
      case 'waitFor': {
        // 同步检查一次
        const found = document.querySelector(selector);
        if (found) {
          return { success: true, data: { found: true, element: serializeElement(found, 0) } };
        }
        // 返回未找到，由外层轮询处理
        return { success: false, error: `__WAIT_NOT_FOUND__` };
      }

      default:
        return { success: false, error: `不支持的操作: ${action}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'DOM 操作执行失败' };
  }
};

export const domManipulateFunction: FunctionDefinition = {
  name: 'dom_manipulate',
  description: [
    '操作当前页面的 DOM 结构。提供完备的 DOM 读写能力，包括：',
    '- 查询：query(查找元素并返回详细信息)',
    '- 读取：getText / getHTML / getAttribute / getStyle',
    '- 修改：setText / setHTML / insertHTML',
    '- 属性：setAttribute / removeAttribute',
    '- 样式：setStyle（设置内联样式）',
    '- 类名：addClass / removeClass / toggleClass',
    '- 结构：removeElement(删除元素) / cloneElement(克隆元素)',
    '- 等待：waitFor(等待元素出现)',
    '建议：先用 query 了解页面结构和元素选择器，再执行修改操作。',
  ].join('\n'),
  supportsParallel: false,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'query', 'getText', 'getHTML', 'getAttribute', 'getStyle',
          'setText', 'setHTML', 'insertHTML',
          'setAttribute', 'removeAttribute',
          'setStyle',
          'addClass', 'removeClass', 'toggleClass',
          'removeElement', 'cloneElement',
          'waitFor',
        ],
        description: '操作类型',
      },
      selector: {
        type: 'string',
        description: 'CSS 选择器，定位目标元素。如 "#app"、".header"、"div[data-id=123]"、"table > tbody > tr"',
      },
      value: {
        type: 'string',
        description: '值。setText/setHTML/insertHTML 时为内容；addClass/removeClass/toggleClass 时为空格分隔的类名；setAttribute 时为属性值',
      },
      attribute: {
        type: 'string',
        description: '属性名（getAttribute / setAttribute / removeAttribute 时使用）',
      },
      property: {
        type: 'string',
        description: 'CSS 属性名（getStyle 时使用，如 "color"、"font-size"、"display"）',
      },
      styles: {
        type: 'object',
        description: '样式对象（setStyle 时使用，如 {"color":"red","font-size":"16px","display":"none"}）',
      },
      position: {
        type: 'string',
        enum: ['beforebegin', 'afterbegin', 'beforeend', 'afterend'],
        description: '插入位置（insertHTML / cloneElement 时使用）。beforebegin=元素前、afterbegin=元素内开头、beforeend=元素内末尾、afterend=元素后',
      },
      all: {
        type: 'boolean',
        description: '是否操作所有匹配元素。默认 false（仅第一个匹配）',
      },
      outer: {
        type: 'boolean',
        description: 'getHTML 时是否返回 outerHTML（含元素本身标签）。默认 false（返回 innerHTML）',
      },
      limit: {
        type: 'number',
        description: 'query 返回的最大元素数量，默认 20',
      },
      timeout: {
        type: 'number',
        description: 'waitFor 的超时时间（毫秒），默认 5000',
      },
      new_id: {
        type: 'string',
        description: 'cloneElement 时为克隆体指定新 ID（避免重复）',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则操作当前活动标签页。',
      },
    },
    required: ['action', 'selector'],
  },
  execute: async (
    params: {
      action: string;
      selector: string;
      value?: string;
      attribute?: string;
      property?: string;
      styles?: Record<string, string>;
      position?: string;
      all?: boolean;
      outer?: boolean;
      limit?: number;
      timeout?: number;
      new_id?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ) => {
    const { action, selector, timeout = 5000, tab_id, ...rest } = params;
    const signal = context?.signal;

    // 确定目标 tabId（优先级：params.tab_id > context.tabId > 当前活动标签页）
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

    // waitFor 需要轮询
    if (action === 'waitFor') {
      return waitForElement(tabId, selector, timeout, rest, signal);
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedDomDispatcher,
        args: [action, selector, rest],
        world: 'MAIN',
      });

      const result = results?.[0]?.result;
      if (!result) {
        return { success: false, error: '未获取到执行结果' };
      }
      return result;
    } catch (err: any) {
      return { success: false, error: err.message || 'DOM 操作执行失败' };
    }
  },
};

/**
 * 等待元素出现（轮询机制）
 * 每 300ms 检查一次，直到超时
 */
const waitForElement = async (
  tabId: number,
  selector: string,
  timeout: number,
  params: Record<string, any>,
  signal?: AbortSignal,
): Promise<{ success: boolean; data?: any; error?: string }> => {
  const startTime = Date.now();
  const interval = 300;

  while (Date.now() - startTime < timeout) {
    if (signal?.aborted) {
      return { success: false, error: 'aborted by user' };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedDomDispatcher,
        args: ['waitFor', selector, params],
        world: 'MAIN',
      });

      const result = results?.[0]?.result;
      if (result?.success) {
        return result;
      }

      // 元素未找到，继续轮询
      if (result?.error === '__WAIT_NOT_FOUND__') {
        await new Promise<void>((resolve, reject) => {
          if (!signal) {
            setTimeout(resolve, interval);
            return;
          }
          if (signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, interval);
          const onAbort = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            reject(new Error('aborted'));
          };
          signal.addEventListener('abort', onAbort, { once: true });
        }).catch(() => {
          throw new Error('aborted');
        });
        continue;
      }

      // 其他错误直接返回
      return result || { success: false, error: '检查元素失败' };
    } catch (err: any) {
      return { success: false, error: err.message || '等待元素失败' };
    }
  }

  return { success: false, error: `等待超时（${timeout}ms）：未找到匹配 "${selector}" 的元素` };
};

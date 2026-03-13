/**
 * 页面 grounding 能力
 * 提供语义化页面快照和基于 element_id 的通用动作执行
 */

import Channel from '../lib/channel';

interface PageSnapshotParams {
  query?: string;
  scope_selector?: string;
  include_non_interactive?: boolean;
  include_hidden?: boolean;
  only_viewport?: boolean;
  limit?: number;
}

interface ElementHandleActionParams {
  action: 'click' | 'fill' | 'focus' | 'get_info' | 'press_key' | 'scroll_into_view' | 'select' | 'hover';
  element_id?: string;
  selector?: string;
  value?: string;
  key?: string;
  modifiers?: string[];
}

interface PageAssertionItem {
  type: 'url_includes' | 'title_includes' | 'text_includes' | 'selector_exists' | 'selector_visible' | 'selector_text_includes';
  value?: string;
  selector?: string;
}

interface PageAssertParams {
  mode?: 'all' | 'any';
  scope_selector?: string;
  assertions?: PageAssertionItem[];
}

export const HANDLE_PREFIX = `ec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let handleSeq = 0;
export const elementHandleMap = new Map<string, Element>();
export const elementToHandleMap = new WeakMap<Element, string>();

export const INTERACTIVE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'textarea',
  'select',
  '[role]',
  '[tabindex]',
  '[contenteditable="true"]',
  '[data-testid]',
  '[data-test]',
  '[aria-label]',
  '[name]',
  'label',
  'summary',
].join(',');

export const normalizeText = (raw: unknown): string => String(raw || '').replace(/\s+/g, ' ').trim();

export const clipText = (raw: unknown, max: number = 180): string => {
  const text = normalizeText(raw);
  return text.length > max ? `${text.slice(0, max)}...` : text;
};

const escapeCssValue = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value).replace(/(["\\#.:\[\]\s>+~()])/g, '\\$1');
};

export const isElementVisible = (el: Element): boolean => {
  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = window.getComputedStyle(htmlEl);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number(style.opacity) === 0) return false;
  return true;
};

const isInViewport = (el: Element): boolean => {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return rect.bottom >= 0
    && rect.right >= 0
    && rect.top <= window.innerHeight
    && rect.left <= window.innerWidth;
};

const isElementDisabled = (el: Element): boolean => {
  const htmlEl = el as HTMLElement & { disabled?: boolean };
  return htmlEl.hasAttribute('disabled') || htmlEl.getAttribute('aria-disabled') === 'true' || htmlEl.disabled === true;
};

export const isElementEditable = (el: Element): boolean => {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(type);
  }
  return (el as HTMLElement).isContentEditable;
};

export const isElementClickable = (el: Element): boolean => {
  const htmlEl = el as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a' && (el as HTMLAnchorElement).href) return true;
  if (tag === 'button') return true;
  if (tag === 'summary') return true;
  if (el instanceof HTMLInputElement) {
    return ['button', 'submit', 'reset', 'checkbox', 'radio'].includes((el.type || '').toLowerCase());
  }
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (['button', 'link', 'tab', 'menuitem', 'checkbox', 'radio', 'option'].includes(role)) return true;
  if (htmlEl.hasAttribute('onclick')) return true;
  const style = window.getComputedStyle(htmlEl);
  return style.cursor === 'pointer';
};

const getElementText = (el: Element): string => {
  const htmlEl = el as HTMLElement;
  const innerText = 'innerText' in htmlEl ? (htmlEl.innerText || '') : '';
  return clipText(innerText || el.textContent || '', 220);
};

const getElementLabel = (el: Element): string => {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return clipText(ariaLabel, 120);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelText = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => clipText(node?.textContent || '', 80))
      .filter(Boolean)
      .join(' ');
    if (labelText) return labelText;
  }

  if ('labels' in el) {
    const labels = Array.from((el as HTMLInputElement).labels || [])
      .map((label) => clipText(label.textContent || '', 80))
      .filter(Boolean);
    if (labels.length > 0) return labels.join(' ');
  }

  const parentLabel = el.closest('label');
  if (parentLabel) return clipText(parentLabel.textContent || '', 120);
  return '';
};

const getSurroundingText = (el: Element): string => {
  const parent = el.parentElement;
  if (!parent) return '';
  return clipText(parent.textContent || '', 60);
};

const getScopeText = (scopeSelector?: string): string => {
  if (!scopeSelector) return normalizeText(document.body?.innerText || document.body?.textContent || '');
  const scopeRoot = document.querySelector(scopeSelector);
  if (!scopeRoot) return '';
  const htmlRoot = scopeRoot as HTMLElement;
  return normalizeText(htmlRoot.innerText || scopeRoot.textContent || '');
};

export const getOrCreateElementHandle = (el: Element): string => {
  const existing = elementToHandleMap.get(el);
  if (existing) {
    elementHandleMap.set(existing, el);
    return existing;
  }
  handleSeq += 1;
  const handleId = `${HANDLE_PREFIX}-${handleSeq.toString(36)}`;
  elementToHandleMap.set(el, handleId);
  elementHandleMap.set(handleId, el);
  return handleId;
};

const buildSelectorCandidates = (el: Element): string[] => {
  const selectors: string[] = [];
  const tag = el.tagName.toLowerCase();
  const htmlEl = el as HTMLElement;

  if (el.id) selectors.push(`#${escapeCssValue(el.id)}`);

  const attrCandidates: Array<[string, string | null]> = [
    ['data-testid', el.getAttribute('data-testid')],
    ['data-test', el.getAttribute('data-test')],
    ['name', el.getAttribute('name')],
    ['aria-label', el.getAttribute('aria-label')],
    ['placeholder', el.getAttribute('placeholder')],
    ['role', el.getAttribute('role')],
    ['type', el.getAttribute('type')],
  ];
  for (const [name, value] of attrCandidates) {
    if (!value) continue;
    selectors.push(`${tag}[${name}="${escapeCssValue(value)}"]`);
  }

  const classes = Array.from(el.classList).filter((name) => /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/.test(name));
  if (classes.length > 0) {
    selectors.push(`${tag}.${classes.slice(0, 2).map((name) => escapeCssValue(name)).join('.')}`);
  }

  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((node) => node.tagName === el.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1;
      selectors.push(`${parent.tagName.toLowerCase()} > ${tag}:nth-of-type(${index})`);
    }
  }

  if (htmlEl.dataset?.moleHandle) {
    selectors.unshift(`[data-mole-handle="${escapeCssValue(htmlEl.dataset.moleHandle)}"]`);
  }

  return Array.from(new Set(selectors)).slice(0, 2);
};

const buildElementDescriptor = (el: Element, score: number = 0, matchReasons?: string[]) => {
  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect();
  const handleId = getOrCreateElementHandle(el);
  htmlEl.dataset.moleHandle = handleId;
  const role = el.getAttribute('role') || undefined;
  const label = getElementLabel(el);
  const text = getElementText(el);
  const placeholder = el.getAttribute('placeholder') || undefined;
  const href = el instanceof HTMLAnchorElement ? el.href || undefined : undefined;
  const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    ? clipText(el.value || '', 120)
    : undefined;

  return {
    element_id: handleId,
    tag: el.tagName.toLowerCase(),
    role,
    type: el.getAttribute('type') || undefined,
    text: text || undefined,
    label: label || undefined,
    placeholder,
    aria_label: el.getAttribute('aria-label') || undefined,
    name: el.getAttribute('name') || undefined,
    href,
    value,
    clickable: isElementClickable(el),
    editable: isElementEditable(el),
    disabled: isElementDisabled(el),
    visible: isElementVisible(el),
    in_viewport: isInViewport(el),
    selector_candidates: buildSelectorCandidates(el),
    surrounding_text: getSurroundingText(el) || undefined,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    score,
    match_reasons: matchReasons && matchReasons.length > 0 ? matchReasons : undefined,
  };
};

const getScopeRoot = (scopeSelector?: string): Element | null => {
  if (!scopeSelector) return document.body;
  return document.querySelector(scopeSelector);
};

const scoreElementAgainstQuery = (el: Element, query: string): { score: number; reasons: string[] } => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) return { score: 0, reasons: [] };

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields: Array<[string, string]> = [
    ['text', getElementText(el)],
    ['label', getElementLabel(el)],
    ['placeholder', el.getAttribute('placeholder') || ''],
    ['aria_label', el.getAttribute('aria-label') || ''],
    ['name', el.getAttribute('name') || ''],
    ['href', el instanceof HTMLAnchorElement ? el.href || '' : ''],
    ['surrounding_text', getSurroundingText(el)],
  ];

  let score = 0;
  const reasons: string[] = [];
  for (const [fieldName, rawFieldValue] of fields) {
    const fieldValue = normalizeText(rawFieldValue).toLowerCase();
    if (!fieldValue) continue;
    if (fieldValue === normalizedQuery) {
      score += 12;
      reasons.push(`${fieldName}:exact`);
    } else if (fieldValue.includes(normalizedQuery)) {
      score += 8;
      reasons.push(`${fieldName}:contains`);
    }

    for (const token of tokens) {
      if (token.length < 2) continue;
      if (fieldValue.includes(token)) {
        score += fieldName === 'text' || fieldName === 'label' ? 3 : 2;
      }
    }
  }

  if (isElementClickable(el)) score += 3;
  if (isElementEditable(el)) score += 3;
  if (isElementVisible(el)) score += 2;
  if (isInViewport(el)) score += 2;
  return { score, reasons: Array.from(new Set(reasons)).slice(0, 4) };
};

const collectSnapshotElements = (params: PageSnapshotParams) => {
  const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 60);
  const query = normalizeText(params.query || '');
  const includeHidden = params.include_hidden === true;
  const onlyViewport = params.only_viewport === true;
  const selector = params.include_non_interactive || query ? '*' : INTERACTIVE_SELECTOR;
  const scopeRoot = getScopeRoot(params.scope_selector);

  if (!scopeRoot) {
    return { success: false, error: `未找到 scope_selector: ${params.scope_selector}` };
  }

  const nodes = selector === '*' ? Array.from(scopeRoot.querySelectorAll('*')) : Array.from(scopeRoot.querySelectorAll(selector));
  const scored = nodes
    .filter((el) => includeHidden || isElementVisible(el))
    .filter((el) => !onlyViewport || isInViewport(el))
    .map((el) => {
      const match = scoreElementAgainstQuery(el, query);
      let baseScore = match.score;
      if (!query) {
        if (isElementClickable(el)) baseScore += 6;
        if (isElementEditable(el)) baseScore += 6;
        if (isInViewport(el)) baseScore += 4;
        if (isElementVisible(el)) baseScore += 3;
      }
      return {
        el,
        score: baseScore,
        reasons: match.reasons,
      };
    })
    .filter((item) => !query || item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const items = scored.map((item) => buildElementDescriptor(item.el, item.score, item.reasons));
  return {
    success: true,
    data: {
      url: window.location.href,
      title: document.title,
      matched_query: query || undefined,
      scope_selector: params.scope_selector || undefined,
      total_candidates: items.length,
      elements: items,
      message: query
        ? `已找到 ${items.length} 个与“${clipText(query, 24)}”相关的候选元素`
        : `已生成页面语义快照（${items.length} 个候选元素）`,
    },
  };
};

const setNativeInputValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string): void => {
  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }
};

const resolveActionTarget = (params: ElementHandleActionParams): Element | null => {
  const elementId = normalizeText(params.element_id || '');
  if (elementId) {
    const found = elementHandleMap.get(elementId);
    if (found?.isConnected) return found;
    if (found && !found.isConnected) {
      elementHandleMap.delete(elementId);
    }
  }
  if (params.selector) {
    return document.querySelector(params.selector);
  }
  return null;
};

const buildActionInfo = (target: Element) => ({
  ...buildElementDescriptor(target),
  message: `已获取元素信息：${target.tagName.toLowerCase()}`,
});

const runPageAssertions = (params: PageAssertParams) => {
  const mode = params.mode === 'any' ? 'any' : 'all';
  const assertions = Array.isArray(params.assertions) ? params.assertions : [];
  const scopeText = getScopeText(params.scope_selector).toLowerCase();
  const results = assertions.map((assertion, index) => {
    const type = assertion?.type;
    const expectedValue = normalizeText(assertion?.value || '');
    const selector = normalizeText(assertion?.selector || '');
    let passed = false;
    let detail = '';

    switch (type) {
      case 'url_includes': {
        passed = window.location.href.toLowerCase().includes(expectedValue.toLowerCase());
        detail = `URL ${passed ? '包含' : '未包含'} ${expectedValue}`;
        break;
      }
      case 'title_includes': {
        passed = document.title.toLowerCase().includes(expectedValue.toLowerCase());
        detail = `标题 ${passed ? '包含' : '未包含'} ${expectedValue}`;
        break;
      }
      case 'text_includes': {
        passed = scopeText.includes(expectedValue.toLowerCase());
        detail = `${params.scope_selector ? `范围 ${params.scope_selector}` : '页面文本'} ${passed ? '包含' : '未包含'} ${expectedValue}`;
        break;
      }
      case 'selector_exists': {
        const el = selector ? document.querySelector(selector) : null;
        passed = Boolean(el);
        detail = `${selector || '(empty selector)'} ${passed ? '存在' : '不存在'}`;
        break;
      }
      case 'selector_visible': {
        const el = selector ? document.querySelector(selector) : null;
        passed = Boolean(el && isElementVisible(el));
        detail = `${selector || '(empty selector)'} ${passed ? '可见' : '不可见或不存在'}`;
        break;
      }
      case 'selector_text_includes': {
        const el = selector ? document.querySelector(selector) : null;
        const text = normalizeText((el as HTMLElement | null)?.innerText || el?.textContent || '');
        passed = Boolean(el) && text.toLowerCase().includes(expectedValue.toLowerCase());
        detail = `${selector || '(empty selector)'} 的文本${passed ? '包含' : '未包含'} ${expectedValue}`;
        break;
      }
      default: {
        detail = `不支持的断言类型: ${String(type || '')}`;
        passed = false;
      }
    }

    return {
      index,
      type,
      selector: selector || undefined,
      value: expectedValue || undefined,
      passed,
      detail,
    };
  });

  const passed = mode === 'any'
    ? results.some((item) => item.passed)
    : results.every((item) => item.passed);

  return {
    success: true,
    data: {
      passed,
      mode,
      url: window.location.href,
      title: document.title,
      total: results.length,
      passed_count: results.filter((item) => item.passed).length,
      results,
      message: passed
        ? `页面断言通过（${results.filter((item) => item.passed).length}/${results.length}）`
        : `页面断言未通过（${results.filter((item) => item.passed).length}/${results.length}）`,
    },
  };
};

const initElementHandleAction = () => {
  Channel.on('__page_grounding_action', (data: ElementHandleActionParams, _sender, sendResponse) => {
    try {
      const action = data?.action;
      if (!action) {
        sendResponse?.({ success: false, error: '缺少 action' });
        return true;
      }

      const target = resolveActionTarget(data);
      if (!target) {
        sendResponse?.({ success: false, error: '未找到 element_id 对应元素，请重新调用 page_snapshot 获取最新句柄' });
        return true;
      }

      const htmlTarget = target as HTMLElement;
      if (typeof htmlTarget.scrollIntoView === 'function') {
        htmlTarget.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' as ScrollBehavior });
      }

      switch (action) {
        case 'get_info': {
          sendResponse?.({ success: true, data: buildActionInfo(target) });
          return true;
        }

        case 'focus': {
          htmlTarget.focus?.();
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), message: '已聚焦目标元素' } });
          return true;
        }

        case 'hover': {
          htmlTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          htmlTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), message: '已悬停目标元素' } });
          return true;
        }

        case 'scroll_into_view': {
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), message: '已滚动到目标元素附近' } });
          return true;
        }

        case 'click': {
          if (isElementDisabled(target)) {
            sendResponse?.({ success: false, error: '目标元素处于禁用状态，无法点击' });
            return true;
          }
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), message: '已触发目标元素点击' } });
          window.setTimeout(() => {
            try {
              htmlTarget.click?.();
            } catch {
              // ignore
            }
          }, 0);
          return true;
        }

        case 'fill': {
          const value = String(data?.value ?? '');
          if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            htmlTarget.focus?.();
            setNativeInputValue(target, value);
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));
            sendResponse?.({ success: true, data: { ...buildActionInfo(target), value, message: '已填写目标元素' } });
            return true;
          }
          if (htmlTarget.isContentEditable) {
            htmlTarget.focus?.();
            htmlTarget.textContent = value;
            htmlTarget.dispatchEvent(new Event('input', { bubbles: true }));
            sendResponse?.({ success: true, data: { ...buildActionInfo(target), value, message: '已填写可编辑区域' } });
            return true;
          }
          sendResponse?.({ success: false, error: '目标元素不支持 fill，请改用 click/focus/get_info' });
          return true;
        }

        case 'select': {
          const value = String(data?.value ?? '');
          if (!(target instanceof HTMLSelectElement)) {
            sendResponse?.({ success: false, error: '目标元素不是 select，无法执行 select 动作' });
            return true;
          }
          const options = Array.from(target.options);
          const matched = options.find((option) => option.value === value)
            || options.find((option) => normalizeText(option.textContent || '') === normalizeText(value))
            || options.find((option) => normalizeText(option.textContent || '').includes(normalizeText(value)));
          if (!matched) {
            sendResponse?.({ success: false, error: `未找到匹配选项：${value}` });
            return true;
          }
          target.value = matched.value;
          target.dispatchEvent(new Event('change', { bubbles: true }));
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), value: matched.value, message: '已选择目标选项' } });
          return true;
        }

        case 'press_key': {
          const key = String(data?.key || '').trim();
          if (!key) {
            sendResponse?.({ success: false, error: 'press_key 需要 key' });
            return true;
          }
          const modifiers = new Set(Array.isArray(data?.modifiers) ? data.modifiers : []);
          htmlTarget.focus?.();
          const eventInit: KeyboardEventInit = {
            key,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.has('ctrl'),
            shiftKey: modifiers.has('shift'),
            altKey: modifiers.has('alt'),
            metaKey: modifiers.has('meta'),
          };
          htmlTarget.dispatchEvent(new KeyboardEvent('keydown', eventInit));
          htmlTarget.dispatchEvent(new KeyboardEvent('keyup', eventInit));
          sendResponse?.({ success: true, data: { ...buildActionInfo(target), key, modifiers: Array.from(modifiers), message: `已触发按键：${key}` } });
          return true;
        }

        default:
          sendResponse?.({ success: false, error: `不支持的 action: ${action}` });
          return true;
      }
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || 'element_action 执行失败' });
      return true;
    }
  });
};

export const initPageGrounding = () => {
  Channel.on('__page_grounding_snapshot', (data: PageSnapshotParams, _sender, sendResponse) => {
    try {
      sendResponse?.(collectSnapshotElements(data || {}));
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || 'page_snapshot 执行失败' });
    }
    return true;
  });

  Channel.on('__page_grounding_assert', (data: PageAssertParams, _sender, sendResponse) => {
    try {
      sendResponse?.(runPageAssertions(data || {}));
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || 'page_assert 执行失败' });
    }
    return true;
  });

  initElementHandleAction();

  // CDP 输入工具的坐标查询：根据 element_id 返回元素视口坐标
  Channel.on('__get_element_rect', (data: { element_id?: string }, _sender, sendResponse) => {
    try {
      const elementId = normalizeText(data?.element_id || '');
      if (!elementId) {
        sendResponse?.({ success: false, error: '缺少 element_id' });
        return true;
      }
      const el = elementHandleMap.get(elementId);
      if (!el || !el.isConnected) {
        if (el) elementHandleMap.delete(elementId);
        sendResponse?.({ success: false, error: '元素已失效，请重新调用 page_snapshot 获取最新句柄' });
        return true;
      }
      const rect = (el as HTMLElement).getBoundingClientRect();
      sendResponse?.({
        success: true,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '坐标查询失败' });
    }
    return true;
  });
};

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

/** 缓存的元素信息，避免在 filter/score/build 三阶段重复调用昂贵 DOM API */
interface CachedElementInfo {
  rect: DOMRect;
  visible: boolean;
  inViewport: boolean;
  clickable: boolean;
  editable: boolean;
  disabled: boolean;
  text: string;
  label: string;
  surroundingText: string;
}

/** 需要跳过的无意义标签集合 */
const SKIP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'br', 'hr', 'noscript',
  'template', 'iframe', 'object', 'embed', 'head', 'title',
  'col', 'colgroup', 'source', 'track', 'wbr', 'path', 'defs',
  'clippath', 'lineargradient', 'radialgradient', 'stop', 'symbol', 'use',
]);

/** 节点遍历上限，避免超大 DOM 页面卡死 */
const MAX_NODES = 8000;

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

/**
 * 判断元素是否可见
 * @param el 目标元素
 * @param rect 可选，预先获取的 DOMRect，避免重复调用 getBoundingClientRect
 * @param style 可选，预先获取的 CSSStyleDeclaration，避免重复调用 getComputedStyle
 */
export const isElementVisible = (el: Element, rect?: DOMRect, style?: CSSStyleDeclaration): boolean => {
  const htmlEl = el as HTMLElement;
  const r = rect || htmlEl.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const s = style || window.getComputedStyle(htmlEl);
  if (s.display === 'none' || s.visibility === 'hidden') return false;
  if (Number(s.opacity) === 0) return false;
  return true;
};

const isInViewport = (el: Element, rect?: DOMRect): boolean => {
  const r = rect || (el as HTMLElement).getBoundingClientRect();
  return r.bottom >= 0
    && r.right >= 0
    && r.top <= window.innerHeight
    && r.left <= window.innerWidth;
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

/**
 * 判断元素是否可点击
 * @param el 目标元素
 * @param style 可选，预先获取的 CSSStyleDeclaration，避免重复调用 getComputedStyle
 */
export const isElementClickable = (el: Element, style?: CSSStyleDeclaration): boolean => {
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
  // 只在前面都没命中时才 fallback 到 getComputedStyle（最昂贵的检查）
  const s = style || window.getComputedStyle(htmlEl);
  return s.cursor === 'pointer';
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

/**
 * 获取元素的缓存信息，首次调用时计算所有字段并存入缓存，后续直接返回
 * 将 getBoundingClientRect、getComputedStyle、getElementText 等昂贵调用合并为一次
 */
const getElementInfo = (el: Element, cache: Map<Element, CachedElementInfo>): CachedElementInfo => {
  const cached = cache.get(el);
  if (cached) return cached;

  const htmlEl = el as HTMLElement;
  const rect = htmlEl.getBoundingClientRect();
  const style = window.getComputedStyle(htmlEl);
  const visible = isElementVisible(el, rect, style);
  const inViewport = isInViewport(el, rect);
  const clickable = isElementClickable(el, style);
  const editable = isElementEditable(el);
  const disabled = isElementDisabled(el);
  const text = getElementText(el);
  const label = getElementLabel(el);
  const surroundingText = getSurroundingText(el);

  const info: CachedElementInfo = {
    rect, visible, inViewport, clickable, editable, disabled, text, label, surroundingText,
  };
  cache.set(el, info);
  return info;
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

/**
 * 构建元素描述符
 * @param cache 可选，元素信息缓存，传入时复用缓存数据避免重复 DOM 查询
 */
const buildElementDescriptor = (el: Element, score: number = 0, matchReasons?: string[], cache?: Map<Element, CachedElementInfo>) => {
  const htmlEl = el as HTMLElement;
  const handleId = getOrCreateElementHandle(el);
  htmlEl.dataset.moleHandle = handleId;
  const role = el.getAttribute('role') || undefined;
  const placeholder = el.getAttribute('placeholder') || undefined;
  const href = el instanceof HTMLAnchorElement ? el.href || undefined : undefined;
  const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
    ? clipText(el.value || '', 120)
    : undefined;

  // 有缓存时复用缓存数据，避免重复调用昂贵 DOM API
  if (cache) {
    const info = getElementInfo(el, cache);
    return {
      element_id: handleId,
      tag: el.tagName.toLowerCase(),
      role,
      type: el.getAttribute('type') || undefined,
      text: info.text || undefined,
      label: info.label || undefined,
      placeholder,
      aria_label: el.getAttribute('aria-label') || undefined,
      name: el.getAttribute('name') || undefined,
      href,
      value,
      clickable: info.clickable,
      editable: info.editable,
      disabled: info.disabled,
      visible: info.visible,
      in_viewport: info.inViewport,
      selector_candidates: buildSelectorCandidates(el),
      surrounding_text: info.surroundingText || undefined,
      rect: {
        x: Math.round(info.rect.x),
        y: Math.round(info.rect.y),
        width: Math.round(info.rect.width),
        height: Math.round(info.rect.height),
      },
      score,
      match_reasons: matchReasons && matchReasons.length > 0 ? matchReasons : undefined,
    };
  }

  // 无缓存时走原始路径（向后兼容 buildActionInfo 等外部调用）
  const rect = htmlEl.getBoundingClientRect();
  const label = getElementLabel(el);
  const text = getElementText(el);

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

/**
 * 对元素进行 query 匹配评分
 * @param cache 可选，元素信息缓存，传入时复用缓存的 text/label 等数据
 */
const scoreElementAgainstQuery = (el: Element, query: string, cache?: Map<Element, CachedElementInfo>): { score: number; reasons: string[] } => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) return { score: 0, reasons: [] };

  // 有缓存时使用缓存数据，否则实时计算
  const info = cache ? getElementInfo(el, cache) : null;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const fields: Array<[string, string]> = [
    ['text', info ? info.text : getElementText(el)],
    ['label', info ? info.label : getElementLabel(el)],
    ['placeholder', el.getAttribute('placeholder') || ''],
    ['aria_label', el.getAttribute('aria-label') || ''],
    ['name', el.getAttribute('name') || ''],
    ['href', el instanceof HTMLAnchorElement ? el.href || '' : ''],
    ['surrounding_text', info ? info.surroundingText : getSurroundingText(el)],
  ];

  let score = 0;
  const reasons: string[] = [];

  // 先检查 text 和 label 两个主要字段
  for (let i = 0; i < fields.length; i++) {
    const [fieldName, rawFieldValue] = fields[i];
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

    // 优化 5：检查完 text 和 label 后，如果 score 仍为 0 且元素既不可点击也不可编辑，提前退出
    if (i === 1 && score === 0) {
      const clickable = info ? info.clickable : isElementClickable(el);
      const editable = info ? info.editable : isElementEditable(el);
      if (!clickable && !editable) {
        return { score: 0, reasons: [] };
      }
    }
  }

  const clickable = info ? info.clickable : isElementClickable(el);
  const editable = info ? info.editable : isElementEditable(el);
  const visible = info ? info.visible : isElementVisible(el);
  const inViewport = info ? info.inViewport : isInViewport(el);

  if (clickable) score += 3;
  if (editable) score += 3;
  if (visible) score += 2;
  if (inViewport) score += 2;
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

  // 创建本次快照的元素信息缓存，函数返回后自动回收
  const cache = new Map<Element, CachedElementInfo>();

  let nodes = Array.from(scopeRoot.querySelectorAll(selector));

  // 优化 1：提前剪枝——过滤掉无意义标签和 SVG 内部元素
  if (selector === '*') {
    nodes = nodes.filter((el) => {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return false;
      // SVG 内部的 path/rect/circle 等不是用户可交互元素，只保留 svg 根元素
      if (tag !== 'svg' && el.closest('svg')) return false;
      return true;
    });
  }

  // 优化 2：节点数上限保护
  if (nodes.length > MAX_NODES) {
    nodes.length = MAX_NODES;
  }

  const scored = nodes
    .filter((el) => {
      // 优化 3：使用缓存的 visible 和 inViewport 判断
      const info = getElementInfo(el, cache);
      if (!includeHidden && !info.visible) return false;
      if (onlyViewport && !info.inViewport) return false;
      return true;
    })
    .map((el) => {
      const match = scoreElementAgainstQuery(el, query, cache);
      let baseScore = match.score;
      if (!query) {
        // 使用缓存数据避免重复 DOM 查询
        const info = getElementInfo(el, cache);
        if (info.clickable) baseScore += 6;
        if (info.editable) baseScore += 6;
        if (info.inViewport) baseScore += 4;
        if (info.visible) baseScore += 3;
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

  const items = scored.map((item) => buildElementDescriptor(item.el, item.score, item.reasons, cache));
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
        ? `已找到 ${items.length} 个与"${clipText(query, 24)}"相关的候选元素`
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
        sendResponse?.({ success: false, error: '未找到 element_id 对应元素，请重新调用 page(action="snapshot") 获取最新句柄' });
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

// ============ 视觉标注 ============

/** 标注容器的 data 属性标识 */
const ANNOTATION_CONTAINER_ATTR = 'data-mole-annotations';

/** 标注编号上限 */
const MAX_ANNOTATION_COUNT = 50;

/** 标注项信息（返回给 background） */
export interface AnnotationEntry {
  index: number;
  element_id: string;
  tag: string;
  text: string;
  role?: string;
  placeholder?: string;
  aria_label?: string;
  name?: string;
  href?: string;
  rect: { x: number; y: number; width: number; height: number };
}

/**
 * 收集视口内可见的可交互元素，注入 DOM 标记，返回映射表
 */
const annotateInteractiveElements = (): { success: boolean; annotations?: AnnotationEntry[]; error?: string } => {
  // 移除旧标注（以防重复调用）
  removeAnnotations();

  // 收集候选元素
  const cache = new Map<Element, CachedElementInfo>();
  const nodes = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));

  // 过滤：可见 + 视口内 + 有尺寸
  const candidates = nodes.filter(el => {
    const info = getElementInfo(el, cache);
    return info.visible && info.inViewport && info.rect.width > 0 && info.rect.height > 0;
  });

  // 按位置排序（上到下、左到右，40px 行容差）
  candidates.sort((a, b) => {
    const ra = cache.get(a)!.rect;
    const rb = cache.get(b)!.rect;
    const rowDiff = Math.floor(ra.y / 40) - Math.floor(rb.y / 40);
    return rowDiff !== 0 ? rowDiff : ra.x - rb.x;
  });

  const selected = candidates.slice(0, MAX_ANNOTATION_COUNT);
  if (selected.length === 0) {
    return { success: true, annotations: [] };
  }

  // 创建标注容器（position:fixed，覆盖整个视口，不接收鼠标事件）
  const container = document.createElement('div');
  container.setAttribute(ANNOTATION_CONTAINER_ATTR, 'true');
  container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';

  const annotations: AnnotationEntry[] = [];

  for (let i = 0; i < selected.length; i++) {
    const el = selected[i];
    const index = i + 1;
    const info = cache.get(el)!;
    const rect = info.rect;
    const elementId = getOrCreateElementHandle(el);
    (el as HTMLElement).dataset.moleHandle = elementId;

    // 半透明高亮边框
    const highlight = document.createElement('div');
    highlight.style.cssText = `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;border:2px solid rgba(229,62,62,0.6);border-radius:3px;background:rgba(229,62,62,0.08);pointer-events:none;`;
    container.appendChild(highlight);

    // 编号圆圈标记（放在元素上方或内部）
    const badge = document.createElement('div');
    const badgeTop = rect.y >= 22 ? rect.y - 22 : rect.y + 2;
    const badgeLeft = Math.max(rect.x - 2, 0);
    badge.style.cssText = `position:fixed;left:${badgeLeft}px;top:${badgeTop}px;min-width:20px;height:20px;border-radius:10px;background:#e53e3e;color:#fff;font-size:11px;font-weight:bold;display:flex;align-items:center;justify-content:center;line-height:1;font-family:Arial,sans-serif;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,0.3);padding:0 4px;`;
    badge.textContent = String(index);
    container.appendChild(badge);

    annotations.push({
      index,
      element_id: elementId,
      tag: el.tagName.toLowerCase(),
      text: clipText(info.text, 60),
      role: el.getAttribute('role') || undefined,
      placeholder: el.getAttribute('placeholder') || undefined,
      aria_label: el.getAttribute('aria-label') || undefined,
      name: el.getAttribute('name') || undefined,
      href: el instanceof HTMLAnchorElement ? clipText(el.href, 100) : undefined,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    });
  }

  document.documentElement.appendChild(container);
  return { success: true, annotations };
};

/** 移除所有视觉标注 DOM 节点 */
const removeAnnotations = (): void => {
  const containers = document.querySelectorAll(`[${ANNOTATION_CONTAINER_ATTR}]`);
  containers.forEach(c => c.remove());
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
        sendResponse?.({ success: false, error: '元素已失效，请重新调用 page(action="snapshot") 获取最新句柄' });
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

  // 视觉标注：注入交互元素编号标记
  Channel.on('__annotate_elements', (_data: unknown, _sender: unknown, sendResponse?: (response: any) => void) => {
    try {
      const result = annotateInteractiveElements();
      // 双 rAF 确保标记已渲染到屏幕
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          sendResponse?.(result);
        });
      });
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '标注失败' });
    }
    return true;
  });

  // 视觉标注：移除所有标记
  Channel.on('__remove_annotations', (_data: unknown, _sender: unknown, sendResponse?: (response: any) => void) => {
    try {
      removeAnnotations();
      sendResponse?.({ success: true });
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || '移除标注失败' });
    }
    return true;
  });
};

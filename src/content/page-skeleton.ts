/**
 * 页面骨架树
 * 将页面 DOM 简化为层级化文本表示，让 AI 用极少 token 理解页面结构
 * 支持渐进展开（expand_selector）和交互元素 element_id 分配
 */

import Channel from '../lib/channel';
import {
  getOrCreateElementHandle,
  isElementVisible,
  isElementClickable,
  isElementEditable,
  clipText,
  normalizeText,
  INTERACTIVE_SELECTOR,
} from './page-grounding';

// ============ 类型定义 ============

interface SkeletonParams {
  scope_selector?: string;
  expand_selector?: string;
  max_depth?: number;
  max_nodes?: number;
  include_hidden?: boolean;
}

/** 骨架树中间节点 */
interface SkeletonNode {
  /** 节点类型 */
  kind: 'semantic' | 'interactive' | 'text' | 'container';
  /** HTML 标签名（小写） */
  tag: string;
  /** 语义角色 */
  role?: string;
  /** 节点显示文本 */
  text?: string;
  /** element_id（仅交互元素） */
  elementId?: string;
  /** 关键属性 */
  attrs?: Record<string, string>;
  /** 有意义的 CSS 类名 */
  className?: string;
  /** 子节点 */
  children: SkeletonNode[];
  /** 重复压缩数量 */
  repeatCount?: number;
  /** 原始 DOM 元素引用（不序列化） */
  _el?: Element;
}

// ============ 常量 ============

/** 跳过的非内容标签 */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME',
  'OBJECT', 'EMBED', 'TEMPLATE', 'META', 'LINK',
  'BR', 'HR', 'WBR', 'COL', 'SOURCE', 'TRACK',
]);

/** 语义标签（保留层级） */
const SEMANTIC_TAGS = new Set([
  'MAIN', 'NAV', 'HEADER', 'FOOTER', 'SECTION',
  'ARTICLE', 'ASIDE', 'FORM', 'DIALOG', 'DETAILS',
  'SUMMARY', 'TABLE', 'THEAD', 'TBODY', 'TFOOT',
  'UL', 'OL', 'DL', 'FIELDSET', 'FIGURE', 'FIGCAPTION',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

/** 内联交互元素标签（在骨架树中用 [...] 表示） */
const INLINE_INTERACTIVE_TAGS = new Set([
  'A', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'SUMMARY',
]);

/** DOM 遍历安全上限 */
const MAX_VISIT_COUNT = 5000;

/** 序列化输出字符数上限 */
const MAX_OUTPUT_CHARS = 3000;

// ============ 工具函数 ============

/** 获取元素的直接文本内容（不含子元素文本） */
const getDirectTextContent = (el: Element): string => {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').trim();
      if (t) text += t + ' ';
    }
  }
  return normalizeText(text);
};

/** 提取有意义的 CSS 类名（过滤哈希类名和过长类名） */
const getMeaningfulClassName = (el: Element): string | undefined => {
  for (const cls of el.classList) {
    // 跳过哈希类名（如 css-1a2b3c、sc-xxx）和过长类名
    if (/^[a-zA-Z][a-zA-Z0-9_-]{2,30}$/.test(cls) && !/^(css|sc|_|__)-/.test(cls)) {
      return cls;
    }
  }
  return undefined;
};

/** 判断节点是否匹配交互选择器 */
const isInteractive = (el: Element): boolean => {
  try {
    return el.matches(INTERACTIVE_SELECTOR);
  } catch {
    return false;
  }
};

/** 节点分类 */
const categorizeNode = (el: Element): SkeletonNode['kind'] => {
  if (isInteractive(el)) return 'interactive';
  if (SEMANTIC_TAGS.has(el.tagName)) return 'semantic';
  if (el.children.length === 0 && (el.textContent || '').trim()) return 'text';
  return 'container';
};

/** 标注交互元素的关键属性 */
const annotateInteractiveAttrs = (node: SkeletonNode, el: Element): void => {
  const attrs: Record<string, string> = {};

  const placeholder = el.getAttribute('placeholder');
  if (placeholder) attrs.placeholder = clipText(placeholder, 20);

  const type = el.getAttribute('type');
  if (type && type !== 'text') attrs.type = type;

  if (el.tagName === 'A' && (el as HTMLAnchorElement).href) {
    try {
      const url = new URL((el as HTMLAnchorElement).href);
      if (url.origin !== window.location.origin) {
        attrs.href = clipText(url.hostname + url.pathname, 30);
      }
    } catch {
      // 忽略无效 URL
    }
  }

  if (isElementEditable(el)) {
    const value = (el as HTMLInputElement).value;
    if (value) attrs.value = clipText(value, 20);
  }

  if (Object.keys(attrs).length > 0) node.attrs = attrs;
};

// ============ 核心算法 ============

/** 递归构建骨架树 */
const buildSkeletonTree = (
  root: Element,
  depth: number,
  maxDepth: number,
  includeHidden: boolean,
  counter: { visited: number },
): SkeletonNode | null => {
  // 安全计数
  counter.visited++;
  if (counter.visited >= MAX_VISIT_COUNT) return null;
  if (depth > maxDepth) return null;

  const tag = root.tagName;
  if (SKIP_TAGS.has(tag)) return null;
  if (!includeHidden && !isElementVisible(root)) return null;

  const kind = categorizeNode(root);
  const node: SkeletonNode = {
    kind,
    tag: tag.toLowerCase(),
    children: [],
    _el: root,
  };

  // 语义角色
  if (SEMANTIC_TAGS.has(tag)) {
    node.role = tag.toLowerCase();
  }
  const ariaRole = root.getAttribute('role');
  if (ariaRole) node.role = ariaRole;

  // 交互元素：分配 element_id
  if (kind === 'interactive') {
    node.elementId = getOrCreateElementHandle(root);
    (root as HTMLElement).dataset.moleHandle = node.elementId;
    annotateInteractiveAttrs(node, root);
  }

  // 直接文本内容
  const directText = getDirectTextContent(root);
  if (directText) {
    node.text = clipText(directText, 40);
  }

  // 有意义的 class
  const meaningfulClass = getMeaningfulClassName(root);
  if (meaningfulClass) node.className = meaningfulClass;

  // 递归子节点（包括 shadow DOM）
  const childElements = root.shadowRoot
    ? Array.from(root.shadowRoot.children)
    : Array.from(root.children);

  for (const child of childElements) {
    const childNode = buildSkeletonTree(child, depth + 1, maxDepth, includeHidden, counter);
    if (childNode) {
      node.children.push(childNode);
    }
  }

  // 跳过空容器节点（无文本也无子节点的非交互容器）
  if (kind === 'container' && !node.text && node.children.length === 0) {
    return null;
  }

  return node;
};

/** 折叠无意义的单子 div/span 中间层 */
const collapsePassthroughNodes = (node: SkeletonNode): SkeletonNode => {
  // 先递归处理子节点
  node.children = node.children.map(collapsePassthroughNodes);

  // 折叠条件：container + div/span + 只有一个子节点 + 没有自己的文本
  if (
    node.kind === 'container' &&
    (node.tag === 'div' || node.tag === 'span') &&
    node.children.length === 1 &&
    !node.text
  ) {
    const child = node.children[0];
    // 传递 className 给子节点
    if (node.className && !child.className) {
      child.className = node.className;
    }
    return child;
  }

  return node;
};

/** 计算节点的结构签名（用于重复检测） */
const structuralSignature = (node: SkeletonNode): string => {
  const childSigs = node.children.map(structuralSignature);
  const attrKeys = node.attrs ? Object.keys(node.attrs).sort().join(',') : '';
  return `${node.tag}:${node.kind}:${node.className || ''}:${attrKeys}:[${childSigs.join(',')}]`;
};

/** 压缩重复兄弟节点 */
const compressRepeatingChildren = (node: SkeletonNode): SkeletonNode => {
  // 先递归
  node.children = node.children.map(compressRepeatingChildren);

  if (node.children.length < 3) return node;

  // 按结构签名分组连续兄弟
  const groups: Array<{ signature: string; nodes: SkeletonNode[] }> = [];
  for (const child of node.children) {
    const sig = structuralSignature(child);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.signature === sig) {
      lastGroup.nodes.push(child);
    } else {
      groups.push({ signature: sig, nodes: [child] });
    }
  }

  // 3 个及以上同构兄弟 → 保留代表 + repeatCount
  const compressed: SkeletonNode[] = [];
  for (const group of groups) {
    if (group.nodes.length >= 3) {
      const representative = group.nodes[0];
      representative.repeatCount = group.nodes.length;
      compressed.push(representative);
    } else {
      compressed.push(...group.nodes);
    }
  }

  node.children = compressed;
  return node;
};

/** 剪枝到最大节点数 */
const pruneToMaxNodes = (root: SkeletonNode, maxNodes: number): SkeletonNode => {
  let count = 0;

  const prune = (node: SkeletonNode): SkeletonNode => {
    count++;
    if (count >= maxNodes) {
      if (node.children.length > 0) {
        node.text = (node.text ? node.text + ' ' : '') + '[...]';
      }
      node.children = [];
      return node;
    }
    node.children = node.children.map(prune);
    return node;
  };

  return prune(root);
};

// ============ 文本序列化 ============

/** 格式化属性为紧凑字符串 */
const formatAttrs = (attrs?: Record<string, string>): string => {
  if (!attrs) return '';
  return Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
};

/** 将骨架树序列化为紧凑缩进文本 */
const serializeToText = (node: SkeletonNode, indent: number = 0): string => {
  const prefix = '  '.repeat(indent);
  const lines: string[] = [];
  const repeat = node.repeatCount ? ` x${node.repeatCount}` : '';

  // 交互元素：用 [...] 内联表示
  if (node.kind === 'interactive') {
    const parts: string[] = [node.tag];
    if (node.elementId) parts.push(`@${node.elementId}`);
    const attrStr = formatAttrs(node.attrs);
    if (attrStr) parts.push(attrStr);
    const textStr = node.text ? ` "${clipText(node.text, 30)}"` : '';
    lines.push(`${prefix}[${parts.join(' ')}${textStr}]${repeat}`);
    // 交互元素的子节点通常不需要展示
    return lines.join('\n');
  }

  // 纯文本节点：短文本内联
  if (node.kind === 'text' && node.children.length === 0) {
    if (node.text) {
      lines.push(`${prefix}"${clipText(node.text, 40)}"`);
    }
    return lines.join('\n');
  }

  // 语义/容器节点：用 <tag> 形式
  let tagStr = `<${node.tag}`;
  if (node.className) tagStr += `.${node.className}`;
  if (node.role && node.role !== node.tag) tagStr += ` role="${node.role}"`;
  tagStr += '>';

  // 如果所有子节点都是内联交互元素且 ≤4 个，一行展示
  const allInlineInteractive = node.children.length > 0 &&
    node.children.length <= 4 &&
    node.children.every(c => c.kind === 'interactive' && c.children.length === 0);

  if (allInlineInteractive) {
    const inlineChildren = node.children
      .map(c => serializeToText(c, 0).trim())
      .join(' ');
    lines.push(`${prefix}${tagStr}${repeat} ${inlineChildren}`);
    return lines.join('\n');
  }

  lines.push(`${prefix}${tagStr}${repeat}`);
  for (const child of node.children) {
    const childText = serializeToText(child, indent + 1);
    if (childText.trim()) lines.push(childText);
  }

  return lines.join('\n');
};

// ============ 主入口 ============

/** 构建页面骨架 */
const buildPageSkeleton = (params: SkeletonParams) => {
  const maxDepth = Math.min(Math.max(Number(params.max_depth) || 6, 3), 12);
  let maxNodes = Math.min(Math.max(Number(params.max_nodes) || 150, 50), 300);
  const includeHidden = params.include_hidden === true;

  // 确定根节点
  const scopeRoot = params.scope_selector
    ? document.querySelector(params.scope_selector)
    : document.body;

  if (!scopeRoot) {
    return { success: false, error: `未找到 scope_selector: ${params.scope_selector}` };
  }

  const counter = { visited: 0 };

  // 构建骨架树
  let tree = buildSkeletonTree(scopeRoot, 0, maxDepth, includeHidden, counter);
  if (!tree) {
    return { success: false, error: '页面为空或无可见内容' };
  }

  // 展开特定区域（更大深度）
  if (params.expand_selector) {
    const expandRoot = scopeRoot.querySelector(params.expand_selector)
      || document.querySelector(params.expand_selector);
    if (expandRoot) {
      const expandCounter = { visited: 0 };
      const expandedSubtree = buildSkeletonTree(
        expandRoot, 0, maxDepth + 4, includeHidden, expandCounter,
      );
      if (expandedSubtree) {
        replaceSubtree(tree, expandRoot, expandedSubtree);
      }
    }
  }

  // 折叠 → 压缩 → 剪枝
  tree = collapsePassthroughNodes(tree);
  tree = compressRepeatingChildren(tree);
  tree = pruneToMaxNodes(tree, maxNodes);

  // 序列化
  const header = `[页面骨架] ${clipText(document.title, 50)}\n[URL] ${window.location.href}\n---\n`;
  let output = header + serializeToText(tree);

  // 如果输出过长，减少节点数重试
  if (output.length > MAX_OUTPUT_CHARS && maxNodes > 80) {
    maxNodes = Math.floor(maxNodes * 0.6);
    tree = pruneToMaxNodes(tree, maxNodes);
    output = header + serializeToText(tree);
  }

  return {
    success: true,
    data: {
      skeleton: output,
      stats: {
        dom_nodes_visited: counter.visited,
        max_depth: maxDepth,
        max_nodes: maxNodes,
      },
      message: `已生成页面骨架（遍历 ${counter.visited} 个 DOM 节点）`,
    },
  };
};

/** 在骨架树中替换匹配子树 */
const replaceSubtree = (
  tree: SkeletonNode,
  targetEl: Element,
  replacement: SkeletonNode,
): boolean => {
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (child._el === targetEl) {
      tree.children[i] = replacement;
      return true;
    }
    if (replaceSubtree(child, targetEl, replacement)) return true;
  }
  return false;
};

// ============ 初始化 ============

export const initPageSkeleton = () => {
  Channel.on('__page_skeleton_build', (data: SkeletonParams, _sender, sendResponse) => {
    try {
      sendResponse?.(buildPageSkeleton(data || {}));
    } catch (err: any) {
      sendResponse?.({ success: false, error: err.message || 'page_skeleton 执行失败' });
    }
    return true;
  });
};

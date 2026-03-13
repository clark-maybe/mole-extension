/**
 * 网页内容解析器（Content Script 侧）
 * 接收来自 background 的 __parse_page_content 消息，解析当前页面信息
 * 支持按 sections 参数选择性返回不同维度的页面数据
 */

import Channel from '../lib/channel';

/** 页面基础信息（始终返回） */
interface PageBasicInfo {
  /** 页面 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 页面 favicon URL */
  favicon: string;
}

/** 页面 meta 信息 */
interface PageMetaInfo {
  /** 页面描述 */
  description: string;
  /** 页面关键词 */
  keywords: string;
  /** Open Graph 标签 */
  og: Record<string, string>;
}

/** 页面标题层级条目 */
interface HeadingItem {
  /** 标题级别（1-6） */
  level: number;
  /** 标题文本 */
  text: string;
}

/** 页面链接条目 */
interface LinkItem {
  /** 链接文本 */
  text: string;
  /** 链接 URL */
  url: string;
}

/** 解析请求参数 */
interface ParsePageParams {
  /** 要获取的信息部分 */
  sections?: string[];
  /** 正文最大字符数，默认 3000 */
  max_content_length?: number;
}

/** 需要跳过的非内容标签名 */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NAV', 'FOOTER', 'HEADER',
  'NOSCRIPT', 'SVG', 'IFRAME', 'OBJECT', 'EMBED',
]);

/** 提取页面 favicon */
const getFavicon = (): string => {
  // 尝试从 link 标签获取
  const iconLink = document.querySelector(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'
  ) as HTMLLinkElement | null;

  if (iconLink?.href) {
    return iconLink.href;
  }

  // 使用默认 favicon 路径
  return `${window.location.origin}/favicon.ico`;
};

/** 提取页面 meta 信息 */
const extractMeta = (): PageMetaInfo => {
  const description = (
    document.querySelector('meta[name="description"]') as HTMLMetaElement
  )?.content || '';

  const keywords = (
    document.querySelector('meta[name="keywords"]') as HTMLMetaElement
  )?.content || '';

  // 提取 Open Graph 标签
  const og: Record<string, string> = {};
  const ogMetas = document.querySelectorAll('meta[property^="og:"]');
  ogMetas.forEach((meta) => {
    const property = meta.getAttribute('property');
    const content = (meta as HTMLMetaElement).content;
    if (property && content) {
      // 去掉 og: 前缀
      const key = property.replace('og:', '');
      og[key] = content;
    }
  });

  return { description, keywords, og };
};

/** 提取页面正文内容 */
const extractContent = (maxLength: number): string => {
  const textParts: string[] = [];
  let totalLength = 0;

  /** 递归遍历 DOM 节点提取文本 */
  const walk = (node: Node): boolean => {
    if (totalLength >= maxLength) return false;

    // 跳过非内容元素
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (SKIP_TAGS.has(el.tagName)) return true;
      // 跳过隐藏元素
      if (el.getAttribute('aria-hidden') === 'true') return true;
      if ((el as HTMLElement).style?.display === 'none') return true;
    }

    // 文本节点
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent || '').trim();
      if (text) {
        const remaining = maxLength - totalLength;
        const truncated = text.length > remaining ? text.slice(0, remaining) : text;
        textParts.push(truncated);
        totalLength += truncated.length;
        if (totalLength >= maxLength) return false;
      }
      return true;
    }

    // 递归子节点
    for (const child of Array.from(node.childNodes)) {
      if (!walk(child)) return false;
    }
    return true;
  };

  // 优先从 main、article 等内容区域提取
  const contentRoot = document.querySelector('main')
    || document.querySelector('article')
    || document.querySelector('[role="main"]')
    || document.body;

  walk(contentRoot);

  return textParts.join(' ').replace(/\s+/g, ' ').trim();
};

/** 提取页面链接列表 */
const extractLinks = (): LinkItem[] => {
  const links: LinkItem[] = [];
  const maxLinks = 50; // 最多返回 50 条链接
  const anchors = document.querySelectorAll('a[href]');

  for (const anchor of anchors) {
    if (links.length >= maxLinks) break;

    const a = anchor as HTMLAnchorElement;
    const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const url = a.href;

    // 跳过空链接、锚点链接、javascript 链接
    if (!text || !url) continue;
    if (url.startsWith('javascript:')) continue;
    if (url === window.location.href + '#') continue;
    // 跳过过短的文本（可能是图标或装饰性链接）
    if (text.length < 2) continue;

    links.push({ text: text.slice(0, 100), url });
  }

  return links;
};

/** 提取页面标题层级 */
const extractHeadings = (): HeadingItem[] => {
  const headings: HeadingItem[] = [];
  const maxHeadings = 50; // 最多返回 50 个标题
  const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');

  for (const el of elements) {
    if (headings.length >= maxHeadings) break;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const level = parseInt(el.tagName.charAt(1), 10);
    headings.push({ level, text: text.slice(0, 200) });
  }

  return headings;
};

/** 初始化网页内容解析处理器 */
export const initPageParser = () => {
  Channel.on('__parse_page_content', (data: ParsePageParams, _sender, sendResponse) => {
    try {
      const sections = data?.sections;
      const maxContentLength = Math.min(
        Math.max(data?.max_content_length || 3000, 500),
        10000
      );

      // 判断是否需要某个 section（未指定 sections 时返回全部）
      const needSection = (name: string): boolean => {
        if (!sections || sections.length === 0) return true;
        return sections.includes(name);
      };

      // 基础信息始终返回
      const basic: PageBasicInfo = {
        url: window.location.href,
        title: document.title,
        favicon: getFavicon(),
      };

      // 按需提取各部分信息
      const result: Record<string, any> = { ...basic };

      if (needSection('meta')) {
        result.meta = extractMeta();
      }

      if (needSection('content')) {
        result.content = extractContent(maxContentLength);
      }

      if (needSection('links')) {
        result.links = extractLinks();
      }

      if (needSection('headings')) {
        result.headings = extractHeadings();
      }

      if (sendResponse) {
        sendResponse({ success: true, data: result });
      }
    } catch (err: any) {
      if (sendResponse) {
        sendResponse({ success: false, error: err.message || '页面内容解析失败' });
      }
    }

    // 返回 true 以支持异步 sendResponse
    return true;
  });
};

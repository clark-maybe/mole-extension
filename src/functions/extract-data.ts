/**
 * 结构化数据提取工具
 * 从当前页面提取结构化数据（表格、列表、重复元素等）
 * 通过 chrome.scripting.executeScript({ world: 'MAIN' }) 注入提取逻辑到页面
 */

import type { FunctionDefinition, FunctionResult, ToolExecutionContext } from './types';
import { appendToBuffer, getOrCreateBuffer } from './data-pipeline';

/** 获取当前活动标签页 ID 作为 fallback */
const getActiveTabId = (): Promise<number | null> => {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs?.[0]?.id ?? null);
    });
  });
};

/** 注入到页面中执行的数据提取调度器 */
const injectedExtractDispatcher = (
  mode: string,
  scope: string | null,
  maxItems: number,
  schema: any | null,
): any => {
  try {
    // 获取提取范围
    const scopeEl = scope ? document.querySelector(scope) : document.body;
    if (!scopeEl) {
      return { success: false, error: `未找到匹配 "${scope}" 的范围元素` };
    }

    // ============ 工具函数 ============

    /** 获取元素的文本内容（去除多余空白） */
    const getText = (el: Element): string => {
      return (el.textContent || '').trim().replace(/\s+/g, ' ');
    };

    /** 从元素提取字段值 */
    const extractFieldValue = (el: Element, attribute?: string, type?: string): any => {
      let value: any;
      if (!attribute || attribute === 'textContent') {
        value = (el.textContent || '').trim();
      } else if (attribute === 'innerText') {
        value = ((el as HTMLElement).innerText || '').trim();
      } else if (attribute === 'href') {
        value = (el as HTMLAnchorElement).href || el.getAttribute('href') || '';
      } else if (attribute === 'src') {
        value = (el as HTMLImageElement).src || el.getAttribute('src') || '';
      } else if (attribute === 'value') {
        value = (el as HTMLInputElement).value || '';
      } else {
        value = el.getAttribute(attribute) || '';
      }

      // 类型转换
      if (type === 'number') {
        const num = parseFloat(String(value).replace(/[^\d.\-]/g, ''));
        return isNaN(num) ? null : num;
      }
      if (type === 'boolean') {
        const lower = String(value).toLowerCase();
        return lower === 'true' || lower === '1' || lower === 'yes';
      }
      return value;
    };

    /** 提取表格数据 */
    const extractTable = (tableEl: Element): { items: Record<string, any>[]; fields: string[]; selector: string } => {
      const rows = tableEl.querySelectorAll('tr');
      if (rows.length === 0) {
        return { items: [], fields: [], selector: '' };
      }

      // 提取列名：优先用 <th>，否则用第一行 <td>
      let headers: string[] = [];
      let dataStartIndex = 0;

      const thCells = tableEl.querySelectorAll('thead th, tr:first-child th');
      if (thCells.length > 0) {
        headers = Array.from(thCells).map(th => getText(th));
        // 找到 th 所在行的下一行开始数据
        const thRow = thCells[0].closest('tr');
        if (thRow) {
          for (let i = 0; i < rows.length; i++) {
            if (rows[i] === thRow) {
              dataStartIndex = i + 1;
              break;
            }
          }
        }
      } else {
        // 用第一行作为列名
        const firstRowCells = rows[0].querySelectorAll('td');
        headers = Array.from(firstRowCells).map(td => getText(td));
        dataStartIndex = 1;
      }

      // 去重列名（空列名自动编号）
      headers = headers.map((h, i) => h || `列${i + 1}`);

      // 提取数据行
      const items: Record<string, any>[] = [];
      for (let i = dataStartIndex; i < rows.length && items.length < maxItems; i++) {
        const cells = rows[i].querySelectorAll('td');
        if (cells.length === 0) continue;

        const item: Record<string, any> = {};
        for (let j = 0; j < headers.length && j < cells.length; j++) {
          item[headers[j]] = getText(cells[j]);
        }
        // 检查是否全空
        const hasValue = Object.values(item).some(v => v !== '');
        if (hasValue) {
          items.push(item);
        }
      }

      // 构造选择器
      let selector = 'table';
      if (tableEl.id) {
        selector = `#${tableEl.id}`;
      } else if (tableEl.className) {
        const cls = String(tableEl.className).split(/\s+/).filter(Boolean)[0];
        if (cls) selector = `table.${cls}`;
      }

      return { items, fields: headers, selector };
    };

    /** 提取列表数据 */
    const extractList = (listEl: Element): { items: Record<string, any>[]; fields: string[]; selector: string } => {
      const listItems = listEl.querySelectorAll(':scope > li');
      if (listItems.length === 0) {
        return { items: [], fields: [], selector: '' };
      }

      const items: Record<string, any>[] = [];
      // 检查 li 内是否有结构化子元素
      const firstLi = listItems[0];
      const hasLinks = firstLi.querySelector('a') !== null;
      const hasImages = firstLi.querySelector('img') !== null;
      const childElements = firstLi.children;

      let fields: string[];
      if (hasLinks || hasImages || childElements.length > 1) {
        // 结构化提取
        fields = ['text'];
        if (hasLinks) fields.push('link', 'link_text');
        if (hasImages) fields.push('image');

        for (let i = 0; i < listItems.length && items.length < maxItems; i++) {
          const li = listItems[i];
          const item: Record<string, any> = { text: getText(li) };
          if (hasLinks) {
            const a = li.querySelector('a');
            if (a) {
              item.link = (a as HTMLAnchorElement).href || '';
              item.link_text = getText(a);
            }
          }
          if (hasImages) {
            const img = li.querySelector('img');
            if (img) {
              item.image = (img as HTMLImageElement).src || '';
            }
          }
          items.push(item);
        }
      } else {
        // 简单文本列表
        fields = ['text'];
        for (let i = 0; i < listItems.length && items.length < maxItems; i++) {
          items.push({ text: getText(listItems[i]) });
        }
      }

      // 构造选择器
      let selector = listEl.tagName.toLowerCase();
      if (listEl.id) {
        selector = `#${listEl.id}`;
      } else if (listEl.className) {
        const cls = String(listEl.className).split(/\s+/).filter(Boolean)[0];
        if (cls) selector = `${listEl.tagName.toLowerCase()}.${cls}`;
      }

      return { items, fields, selector };
    };

    /** 检测并提取重复元素 */
    const extractRepeat = (container: Element): { items: Record<string, any>[]; fields: string[]; selector: string } | null => {
      // 统计直接子元素的 tagName+className 组合
      const childGroups = new Map<string, Element[]>();
      for (const child of Array.from(container.children)) {
        // 跳过 script/style/mole-root 等非内容元素
        const tag = child.tagName.toLowerCase();
        if (['script', 'style', 'link', 'meta', 'br', 'hr'].includes(tag)) continue;
        if (child.id === 'mole-root') continue;

        const key = tag + (child.className ? '.' + String(child.className).split(/\s+/).sort().join('.') : '');
        const group = childGroups.get(key) || [];
        group.push(child);
        childGroups.set(key, group);
      }

      // 找到出现 3+ 次的最大组
      let bestGroup: Element[] = [];
      let bestKey = '';
      for (const [key, group] of childGroups) {
        if (group.length >= 3 && group.length > bestGroup.length) {
          bestGroup = group;
          bestKey = key;
        }
      }

      if (bestGroup.length === 0) return null;

      // 自动推断字段：分析第一个元素的内容
      const sampleEl = bestGroup[0];
      const fieldDefs: { name: string; extractor: (el: Element) => any }[] = [];

      // 文本内容
      fieldDefs.push({ name: 'text', extractor: el => getText(el) });

      // 链接
      if (sampleEl.querySelector('a')) {
        fieldDefs.push({
          name: 'link',
          extractor: el => {
            const a = el.querySelector('a');
            return a ? (a as HTMLAnchorElement).href : '';
          },
        });
        fieldDefs.push({
          name: 'link_text',
          extractor: el => {
            const a = el.querySelector('a');
            return a ? getText(a) : '';
          },
        });
      }

      // 图片
      if (sampleEl.querySelector('img')) {
        fieldDefs.push({
          name: 'image',
          extractor: el => {
            const img = el.querySelector('img');
            return img ? (img as HTMLImageElement).src : '';
          },
        });
      }

      // 标题（h1-h6）
      const headingEl = sampleEl.querySelector('h1, h2, h3, h4, h5, h6');
      if (headingEl) {
        fieldDefs.push({
          name: 'title',
          extractor: el => {
            const h = el.querySelector('h1, h2, h3, h4, h5, h6');
            return h ? getText(h) : '';
          },
        });
      }

      // 时间
      const timeEl = sampleEl.querySelector('time');
      if (timeEl) {
        fieldDefs.push({
          name: 'time',
          extractor: el => {
            const t = el.querySelector('time');
            return t ? (t.getAttribute('datetime') || getText(t)) : '';
          },
        });
      }

      // 提取数据
      const items: Record<string, any>[] = [];
      for (let i = 0; i < bestGroup.length && items.length < maxItems; i++) {
        const item: Record<string, any> = {};
        for (const fd of fieldDefs) {
          item[fd.name] = fd.extractor(bestGroup[i]);
        }
        items.push(item);
      }

      const fields = fieldDefs.map(fd => fd.name);

      // 构造选择器
      const parts = bestKey.split('.');
      const tag = parts[0];
      const cls = parts.slice(1).filter(Boolean)[0];
      let selector = cls ? `${tag}.${cls}` : tag;
      if (scope) {
        selector = `${scope} > ${selector}`;
      }

      return { items, fields, selector };
    };

    /** Schema 模式提取 */
    const extractSchema = (
      container: Element,
      schemaDef: { item_selector: string; fields: Array<{ name: string; selector: string; attribute?: string; type?: string }> },
    ): { items: Record<string, any>[]; fields: string[]; selector: string } => {
      const containers = container.querySelectorAll(schemaDef.item_selector);
      const items: Record<string, any>[] = [];
      const fields = schemaDef.fields.map(f => f.name);

      for (let i = 0; i < containers.length && items.length < maxItems; i++) {
        const itemEl = containers[i];
        const item: Record<string, any> = {};
        for (const fieldDef of schemaDef.fields) {
          const targetEl = itemEl.querySelector(fieldDef.selector);
          if (targetEl) {
            item[fieldDef.name] = extractFieldValue(targetEl, fieldDef.attribute, fieldDef.type);
          } else {
            item[fieldDef.name] = null;
          }
        }
        items.push(item);
      }

      return { items, fields, selector: schemaDef.item_selector };
    };

    // ============ 模式分发 ============

    let result: { items: Record<string, any>[]; fields: string[]; selector: string } | null = null;
    let actualMode = mode;

    switch (mode) {
      case 'auto': {
        // 优先找 table
        const table = scopeEl.querySelector('table');
        if (table) {
          const tableResult = extractTable(table);
          if (tableResult.items.length > 0) {
            result = tableResult;
            actualMode = 'table';
            break;
          }
        }

        // 其次检测重复元素
        const repeatResult = extractRepeat(scopeEl);
        if (repeatResult && repeatResult.items.length > 0) {
          result = repeatResult;
          actualMode = 'repeat';
          break;
        }

        // 最后找列表
        const list = scopeEl.querySelector('ul, ol');
        if (list) {
          const listResult = extractList(list);
          if (listResult.items.length > 0) {
            result = listResult;
            actualMode = 'list';
            break;
          }
        }

        // 都没找到
        result = null;
        break;
      }

      case 'table': {
        const table = scopeEl.querySelector('table');
        if (!table) {
          return { success: false, error: '未在指定范围内找到 <table> 元素' };
        }
        result = extractTable(table);
        break;
      }

      case 'list': {
        const list = scopeEl.querySelector('ul, ol');
        if (!list) {
          return { success: false, error: '未在指定范围内找到 <ul> 或 <ol> 元素' };
        }
        result = extractList(list);
        break;
      }

      case 'repeat': {
        result = extractRepeat(scopeEl);
        if (!result || result.items.length === 0) {
          return { success: false, error: '未在指定范围内检测到重复的同类元素（需要同 tagName+className 出现 3 次以上）' };
        }
        break;
      }

      case 'schema': {
        if (!schema || !schema.item_selector || !Array.isArray(schema.fields)) {
          return { success: false, error: 'schema 模式需要提供包含 item_selector 和 fields 的 schema 参数' };
        }
        result = extractSchema(scopeEl, schema);
        break;
      }

      default:
        return { success: false, error: `不支持的提取模式: ${mode}` };
    }

    if (!result || result.items.length === 0) {
      return { success: false, error: '未能提取到有效数据，请尝试使用 scope 缩小范围或使用 schema 模式精确提取' };
    }

    return {
      success: true,
      data: {
        items: result.items,
        fields: result.fields,
        count: result.items.length,
        source: {
          mode: actualMode,
          selector: result.selector,
          page_url: window.location.href,
          page_title: document.title,
        },
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || '数据提取执行失败' };
  }
};

export const extractDataFunction: FunctionDefinition = {
  name: 'extract_data',
  description: '从当前页面提取结构化数据（表格、列表、重复元素等），支持自动识别和 Schema 精确提取\n\n⚠️ 不要用此工具来：\n- 获取单个元素的文本（用 cdp_dom 的 get_text）\n- 读取页面正文内容（用 page_viewer）\n- 适合提取表格、列表等批量结构化数据',
  supportsParallel: false,
  permissionLevel: 'read',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['auto', 'table', 'list', 'repeat', 'schema'],
        description: '提取模式。auto=自动识别（table→repeat→list），table=提取表格，list=提取列表，repeat=检测重复元素，schema=按 Schema 精确提取',
      },
      scope: {
        type: 'string',
        description: '限定提取范围的 CSS 选择器（可选），如 "#content"、".main-area"',
      },
      schema: {
        type: 'object',
        description: 'Schema 定义（mode=schema 时必填）',
        properties: {
          item_selector: {
            type: 'string',
            description: '单条数据的容器选择器（重复元素）',
          },
          fields: {
            type: 'array',
            description: '字段定义列表',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '字段名' },
                selector: { type: 'string', description: '字段在容器内的 CSS 选择器' },
                attribute: {
                  type: 'string',
                  description: '提取内容类型，默认 textContent。可选：textContent/innerText/href/src/value 或任意属性名',
                },
                type: {
                  type: 'string',
                  enum: ['string', 'number', 'boolean'],
                  description: '数据类型转换',
                },
              },
              required: ['name', 'selector'],
            },
          },
        },
        required: ['item_selector', 'fields'],
      },
      max_items: {
        type: 'number',
        description: '最大提取条数，默认 100，上限 500',
      },
      buffer_id: {
        type: 'string',
        description: '提取后直接写入缓冲区（旁路 LLM），仅返回统计摘要。传入已有缓冲区 ID 则追加，传入新 ID 则自动创建',
      },
      tab_id: {
        type: 'number',
        description: '目标标签页 ID。不传则操作当前活动标签页。',
      },
    },
    required: ['mode'],
  },

  execute: async (
    params: {
      mode: string;
      scope?: string;
      schema?: any;
      max_items?: number;
      buffer_id?: string;
      tab_id?: number;
    },
    context?: ToolExecutionContext,
  ): Promise<FunctionResult> => {
    const { mode, scope, schema, buffer_id, tab_id } = params;
    const maxItems = Math.min(Math.max(params.max_items || 100, 1), 500);

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

    try {
      // 注入提取逻辑到页面执行
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: injectedExtractDispatcher,
        args: [mode, scope || null, maxItems, schema || null],
        world: 'MAIN',
      });

      const result = results?.[0]?.result;
      if (!result) {
        return { success: false, error: '未获取到执行结果' };
      }

      if (!result.success) {
        return result;
      }

      // 如果指定了 buffer_id，走旁路存储模式
      if (buffer_id) {
        getOrCreateBuffer(buffer_id);
        const appendResult = appendToBuffer(buffer_id, result.data.items);
        return {
          success: true,
          data: {
            buffer_id,
            appended_count: appendResult.appended,
            total_count: appendResult.total,
            fields: result.data.fields,
            sample: result.data.items.slice(0, 3),
          },
        };
      }

      // 正常模式：直接返回数据
      return result;
    } catch (err: any) {
      return { success: false, error: err.message || '数据提取执行失败' };
    }
  },
};

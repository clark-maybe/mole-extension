/**
 * 悬浮胶囊 — Markdown 解析工具
 */

/** 转义 HTML 特殊字符 */
export const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
};

/** 内联 Markdown：加粗、斜体、删除线、行内代码、链接 */
export const inlineMarkdown = (escaped: string): string => {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
};

/** 将原始文本拆分为段落，代码块作为完整单元保留不被打断 */
const splitBlocks = (text: string): string[] => {
  const result: string[] = [];
  const lines = text.split('\n');
  let buf: string[] = [];
  let inFence = false;

  const flushBuf = () => {
    if (buf.length === 0) return;
    const joined = buf.join('\n');
    // 按双换行拆分非代码块内容，标题和水平线独立成 block
    const preprocessed = joined
      .replace(/^(#{1,6}\s+.+)$/gm, '\n\n$1\n\n')
      .replace(/^([-*_]{3,})\s*$/gm, '\n\n$1\n\n');
    for (const b of preprocessed.split(/\n{2,}/)) {
      const t = b.trim();
      if (t) result.push(t);
    }
    buf = [];
  };

  for (const line of lines) {
    if (!inFence && /^```/.test(line.trim())) {
      // 进入代码块：先 flush 之前的普通内容
      flushBuf();
      inFence = true;
      buf.push(line);
      // 单行自闭合 ```code``` 的情况（不含换行的简单围栏）
      // 开始行同时也是结束行：```lang\ncode\n``` 不会在同一行
      continue;
    }
    if (inFence && /^```\s*$/.test(line.trim())) {
      // 代码块结束
      buf.push(line);
      result.push(buf.join('\n'));
      buf = [];
      inFence = false;
      continue;
    }
    buf.push(line);
  }
  // 处理未闭合的围栏（当作普通文本）或剩余内容
  flushBuf();
  return result;
};

/** Markdown 文本转 HTML（支持标题、列表、表格、水平线、代码块、段落、内联格式） */
export const markdownToHtml = (text: string): string => {
  const blocks = splitBlocks(text);
  let html = '';

  for (const trimmed of blocks) {
    if (!trimmed) continue;
    const lines = trimmed.split('\n');

    // 代码块（围栏完整保留，含空行）
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]*)[ \t]*\n([\s\S]*?)\n?```\s*$/);
    if (fenceMatch) {
      const language = (fenceMatch[1] || '').trim();
      const codeText = fenceMatch[2];
      const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      html += `<pre><code${langClass}>${escapeHtml(codeText)}</code></pre>`;
      continue;
    }

    // 水平分割线（---、***、___）
    if (/^[-*_]{3,}\s*$/.test(trimmed)) {
      html += '<hr>';
      continue;
    }

    // 标题（支持 1-6 级，映射为 h3-h5 适配小面板）
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length + 2, 5);
      const tag = `h${level}`;
      html += `<${tag}>${inlineMarkdown(escapeHtml(headingMatch[2]))}</${tag}>`;
      continue;
    }

    // 引用
    if (lines.every((line) => line.trim().startsWith('>'))) {
      const quote = lines
        .map((line) => line.trim().replace(/^>\s?/, ''))
        .map((line) => inlineMarkdown(escapeHtml(line)))
        .join('<br>');
      html += `<blockquote>${quote}</blockquote>`;
      continue;
    }

    // 表格（首行含 |，第二行是分隔行 |---|）
    if (lines.length >= 2 && lines[0].includes('|') && /^\|?[\s:]*-+[\s:]*/.test(lines[1])) {
      const parseRow = (row: string): string[] =>
        row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

      const headers = parseRow(lines[0]);
      const bodyRows = lines.slice(2).filter(l => l.includes('|'));

      html += '<table><thead><tr>';
      for (const h of headers) {
        html += `<th>${inlineMarkdown(escapeHtml(h))}</th>`;
      }
      html += '</tr></thead>';

      if (bodyRows.length > 0) {
        html += '<tbody>';
        for (const row of bodyRows) {
          const cells = parseRow(row);
          html += '<tr>';
          for (const cell of cells) {
            html += `<td>${inlineMarkdown(escapeHtml(cell))}</td>`;
          }
          html += '</tr>';
        }
        html += '</tbody>';
      }
      html += '</table>';
      continue;
    }

    // 无序列表（支持混合普通行 + 列表项）
    if (lines.some(l => /^[-*]\s/.test(l.trim()))) {
      html += '<ul>' + lines
        .filter(l => /^[-*]\s/.test(l.trim()))
        .map(l => `<li>${inlineMarkdown(escapeHtml(l.trim().replace(/^[-*]\s+/, '')))}</li>`)
        .join('') + '</ul>';
      continue;
    }

    // 有序列表
    if (lines.some(l => /^\d+\.\s/.test(l.trim()))) {
      html += '<ol>' + lines
        .filter(l => /^\d+\.\s/.test(l.trim()))
        .map(l => `<li>${inlineMarkdown(escapeHtml(l.trim().replace(/^\d+\.\s+/, '')))}</li>`)
        .join('') + '</ol>';
      continue;
    }

    // 普通段落
    html += `<p>${inlineMarkdown(escapeHtml(trimmed).replace(/\n/g, '<br>'))}</p>`;
  }

  return html;
};

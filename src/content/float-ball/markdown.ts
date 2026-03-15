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

/** 内联 Markdown：加粗、斜体、行内代码、链接 */
export const inlineMarkdown = (escaped: string): string => {
  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
};

/** Markdown 文本转 HTML（支持标题、列表、段落、内联格式） */
export const markdownToHtml = (text: string): string => {
  const blocks = text.split(/\n{2,}/);
  let html = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');

    // 代码块
    const fenceMatch = trimmed.match(/^```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/);
    if (fenceMatch) {
      const language = (fenceMatch[1] || '').trim();
      const codeText = fenceMatch[2].replace(/\n$/, '');
      const langClass = language ? ` class="language-${escapeHtml(language)}"` : '';
      html += `<pre><code${langClass}>${escapeHtml(codeText)}</code></pre>`;
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const tag = `h${headingMatch[1].length + 2}`;
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

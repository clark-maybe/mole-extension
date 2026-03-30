<script setup lang="ts">
import type { ReleaseData } from '../../release.data'

const props = withDefaults(
  defineProps<{
    release: ReleaseData
    lang?: string
  }>(),
  { lang: 'en' },
)

const isZh = props.lang === 'zh'

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString(isZh ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function formatSize(bytes: number) {
  if (!bytes) return ''
  const mb = bytes / 1024 / 1024
  return mb >= 1 ? mb.toFixed(1) + ' MB' : (bytes / 1024).toFixed(0) + ' KB'
}
</script>

<template>
  <!-- 有 release -->
  <div v-if="release.hasRelease" class="release-card">
    <div class="release-meta">
      <span class="version-badge">{{ release.version }}</span>
      <!-- <span class="release-date">{{ formatDate(release.publishedAt) }}</span> -->
      <span v-if="release.downloadSize" class="release-size">
        {{ formatSize(release.downloadSize) }}
      </span>
    </div>

    <div class="release-actions">
      <a :href="release.downloadUrl" class="download-btn" download>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z" />
          <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z" />
        </svg>
        {{ isZh ? '下载最新版本' : 'Download Latest' }}
      </a>
      <a :href="release.htmlUrl" class="github-link" target="_blank" rel="noopener">
        {{ isZh ? '在 GitHub 上查看' : 'View on GitHub' }}
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-left:4px">
          <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z" />
        </svg>
      </a>
    </div>

    <details v-if="release.body" class="changelog">
      <summary>{{ isZh ? '更新日志' : 'Changelog' }}</summary>
      <pre class="changelog-content">{{ release.body }}</pre>
    </details>
  </div>

  <!-- 无 release，引导从源码构建 -->
  <div v-else class="no-release">
    <div class="no-release-icon">📦</div>
    <p class="no-release-text">
      {{ isZh ? '暂无发布版本，你可以从源码构建安装。' : 'No releases yet. You can install by building from source.' }}
    </p>
    <a
      :href="isZh ? '/zh/guide/getting-started' : '/guide/getting-started'"
      class="source-link"
    >
      {{ isZh ? '查看源码构建指南 →' : 'Build from Source Guide →' }}
    </a>
  </div>
</template>

<style scoped>
.release-card {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 24px;
  margin: 16px 0 32px;
  background: var(--vp-c-bg-soft);
}

.release-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.version-badge {
  display: inline-block;
  padding: 4px 14px;
  border-radius: 20px;
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.release-date,
.release-size {
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.release-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.download-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 28px;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: var(--vp-c-brand-1);
  text-decoration: none;
  transition: background 0.2s;
}

.download-btn:hover {
  background: var(--vp-c-brand-2);
  text-decoration: none;
  color: #fff;
}

.github-link {
  display: inline-flex;
  align-items: center;
  font-size: 14px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s;
}

.github-link:hover {
  color: var(--vp-c-brand-1);
}

.changelog {
  margin-top: 20px;
  border-top: 1px solid var(--vp-c-border);
  padding-top: 16px;
}

.changelog summary {
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  user-select: none;
}

.changelog summary:hover {
  color: var(--vp-c-text-1);
}

.changelog-content {
  margin-top: 12px;
  padding: 16px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}

/* 无 release 状态 */
.no-release {
  text-align: center;
  padding: 40px 24px;
  margin: 16px 0 32px;
  border: 1px dashed var(--vp-c-border);
  border-radius: 12px;
}

.no-release-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.no-release-text {
  font-size: 15px;
  color: var(--vp-c-text-2);
  margin-bottom: 16px;
}

.source-link {
  display: inline-block;
  padding: 8px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  text-decoration: none;
  transition: all 0.2s;
}

.source-link:hover {
  color: #fff;
  background: var(--vp-c-brand-1);
  text-decoration: none;
}
</style>

/**
 * 录制覆盖层模块
 * 在 Shadow DOM 外部直接操作宿主页面 DOM
 * 提供：四角取景框标记、录制指示器（步数 + 时间）、完成/取消按钮
 */

import Channel from '../lib/channel';

/** 覆盖层容器 ID */
const OVERLAY_ID = 'mole-recorder-overlay';
/** 内联样式标签 ID */
const STYLE_ID = 'mole-recorder-overlay-style';
/** 步数文字元素的 data 属性标识 */
const STEP_ATTR = 'data-mole-step';
/** 时间文字元素的 data 属性标识 */
const TIME_ATTR = 'data-mole-time';

/** 回调 */
let onCompleteCallback: (() => void) | null = null;
let onCancelCallback: (() => void) | null = null;

/** 计时器 */
let timerInterval: ReturnType<typeof setInterval> | null = null;
let startTime = 0;

/** 格式化秒数为 mm:ss */
const formatTime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/** 注入覆盖层所需的 CSS */
const OVERLAY_CSS = `
#${OVERLAY_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483646;
}

/* 四角 L 形标记 */
#${OVERLAY_ID} .mole-corner {
  position: absolute;
  width: 48px;
  height: 48px;
}
#${OVERLAY_ID} .mole-corner-tl {
  top: 6px; left: 6px;
  border-top: 3px solid rgba(239, 68, 68, 0.75);
  border-left: 3px solid rgba(239, 68, 68, 0.75);
  border-radius: 6px 0 0 0;
}
#${OVERLAY_ID} .mole-corner-tr {
  top: 6px; right: 6px;
  border-top: 3px solid rgba(239, 68, 68, 0.75);
  border-right: 3px solid rgba(239, 68, 68, 0.75);
  border-radius: 0 6px 0 0;
}
#${OVERLAY_ID} .mole-corner-bl {
  bottom: 6px; left: 6px;
  border-bottom: 3px solid rgba(239, 68, 68, 0.75);
  border-left: 3px solid rgba(239, 68, 68, 0.75);
  border-radius: 0 0 0 6px;
}
#${OVERLAY_ID} .mole-corner-br {
  bottom: 6px; right: 6px;
  border-bottom: 3px solid rgba(239, 68, 68, 0.75);
  border-right: 3px solid rgba(239, 68, 68, 0.75);
  border-radius: 0 0 6px 0;
}

/* 右上角录制指示器 */
#${OVERLAY_ID} .mole-rec-indicator {
  position: fixed;
  top: 12px;
  right: 16px;
  background: rgba(0, 0, 0, 0.8);
  border-radius: 20px;
  padding: 6px 8px 6px 14px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: "SF Pro Text", system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: #fff;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: auto;
}

/* 红色呼吸圆点 */
#${OVERLAY_ID} .mole-rec-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  animation: mole-overlay-pulse 1.5s ease-in-out infinite;
}

/* 步数 + 时间信息 */
#${OVERLAY_ID} .mole-rec-info {
  display: flex;
  align-items: center;
  gap: 6px;
}
#${OVERLAY_ID} .mole-rec-time {
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
#${OVERLAY_ID} .mole-rec-sep {
  opacity: 0.3;
}

/* 按钮公共样式 */
#${OVERLAY_ID} .mole-rec-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  outline: none;
}
#${OVERLAY_ID} .mole-rec-btn svg {
  width: 10px;
  height: 10px;
  fill: currentColor;
}

/* 完成按钮 */
#${OVERLAY_ID} .mole-rec-btn.complete:hover {
  background: rgba(34, 197, 94, 0.5);
  border-color: rgba(34, 197, 94, 0.7);
}

/* 取消按钮 */
#${OVERLAY_ID} .mole-rec-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.18);
  border-color: rgba(255, 255, 255, 0.4);
}

@keyframes mole-overlay-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
`;

/** 显示录制覆盖层 */
export function showRecorderOverlay(onComplete?: () => void, onCancel?: () => void): void {
  if (document.getElementById(OVERLAY_ID)) return;

  onCompleteCallback = onComplete || null;
  onCancelCallback = onCancel || null;
  startTime = Date.now();

  // 注入样式
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = OVERLAY_CSS;
  document.head.appendChild(style);

  // 创建容器
  const container = document.createElement('div');
  container.id = OVERLAY_ID;

  // 四角标记
  for (const pos of ['tl', 'tr', 'bl', 'br']) {
    const corner = document.createElement('div');
    corner.className = `mole-corner mole-corner-${pos}`;
    container.appendChild(corner);
  }

  // 录制指示器
  const indicator = document.createElement('div');
  indicator.className = 'mole-rec-indicator';

  // 红色圆点
  const dot = document.createElement('div');
  dot.className = 'mole-rec-dot';

  // 信息区：步数 + 分隔 + 时间
  const info = document.createElement('span');
  info.className = 'mole-rec-info';

  const stepText = document.createElement('span');
  stepText.setAttribute(STEP_ATTR, '');
  stepText.textContent = '0 步';

  const sep = document.createElement('span');
  sep.className = 'mole-rec-sep';
  sep.textContent = '·';

  const timeText = document.createElement('span');
  timeText.className = 'mole-rec-time';
  timeText.setAttribute(TIME_ATTR, '');
  timeText.textContent = '00:00';

  info.appendChild(stepText);
  info.appendChild(sep);
  info.appendChild(timeText);

  // 完成按钮（绿色 hover）
  const completeBtn = document.createElement('button');
  completeBtn.className = 'mole-rec-btn complete';
  completeBtn.innerHTML = '<svg viewBox="0 0 10 10"><polyline points="2,5 4.5,7.5 8,2.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>完成';
  completeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCompleteCallback?.();
  });

  // 取消按钮
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mole-rec-btn cancel';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onCancelCallback?.();
  });

  indicator.appendChild(dot);
  indicator.appendChild(info);
  indicator.appendChild(completeBtn);
  indicator.appendChild(cancelBtn);
  container.appendChild(indicator);

  document.body.appendChild(container);

  // 启动计时器，每秒更新
  timerInterval = setInterval(() => {
    const el = document.querySelector(`#${OVERLAY_ID} [${TIME_ATTR}]`);
    if (el) el.textContent = formatTime(Date.now() - startTime);
  }, 1000);
}

/** 更新录制步数 */
export function updateRecorderStepCount(count: number): void {
  const el = document.querySelector(`#${OVERLAY_ID} [${STEP_ATTR}]`);
  if (!el) return;
  el.textContent = count >= 10 ? '10/10 步' : `${count} 步`;
}

/** 移除录制覆盖层 */
export function hideRecorderOverlay(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();

  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();

  onCompleteCallback = null;
  onCancelCallback = null;
}

// 截图时隐藏/恢复 overlay
Channel.on('__screenshot_hide', () => {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.style.display = 'none';
});
Channel.on('__screenshot_show', () => {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.style.display = '';
});

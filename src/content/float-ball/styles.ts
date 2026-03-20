/**
 * 悬浮胶囊 — 样式定义
 */

import {
  PILL_WIDTH,
  PILL_HEIGHT,
  PILL_COMPACT_WIDTH,
  LOGO_SIZE,
  TUCK_OFFSET,
} from './constants';

export const getStyles = () => `
  :host {
    all: initial;
    --ec-surface: rgba(255, 255, 255, 0.84);
    --ec-surface-strong: rgba(255, 255, 255, 0.95);
    --ec-surface-soft: rgba(255, 255, 255, 0.76);
    --ec-border: rgba(219, 227, 238, 0.92);
    --ec-border-soft: rgba(219, 227, 238, 0.74);
    --ec-text: #172033;
    --ec-text-muted: #667085;
    --ec-primary: #1677ff;
    --ec-primary-strong: #0f6adf;
    --ec-primary-soft: rgba(22, 119, 255, 0.1);
    --ec-success: #039855;
    --ec-success-soft: rgba(18, 183, 106, 0.12);
    --ec-danger: #d92d20;
    --ec-danger-soft: rgba(239, 68, 68, 0.1);
    --ec-focus-ring: 0 0 0 4px rgba(22, 119, 255, 0.14);
    --ec-shadow: 0 24px 68px rgba(15, 23, 42, 0.16), 0 10px 28px rgba(15, 23, 42, 0.08);
    --ec-pill-shadow: 0 12px 30px rgba(15, 23, 42, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.84);
    --ec-card-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }

  /* ---- 胶囊触发区域 ---- */
  .mole-trigger {
    position: absolute;
    z-index: 2147483647;
    width: ${PILL_WIDTH + 10}px;
    height: ${PILL_HEIGHT + 10}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    pointer-events: none;
  }

  /* hover 桥接已移至 JS .hovering class 管理，不再需要 ::before 拦截 */

  .mole-pill {
    position: relative;
    isolation: isolate;
    overflow: hidden;
    width: ${PILL_COMPACT_WIDTH}px;
    height: ${PILL_HEIGHT}px;
    padding: 0 12px 0 9px;
    border-radius: 999px;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, rgba(248, 251, 255, 0.96) 0%, var(--ec-surface) 100%);
    box-shadow: var(--ec-pill-shadow);
    backdrop-filter: blur(24px) saturate(170%);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
    -webkit-user-select: none;
    flex-shrink: 0;
    white-space: normal;
    pointer-events: auto;
    transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1),
                width 0.28s cubic-bezier(0.22, 1, 0.36, 1),
                box-shadow 0.28s ease,
                border-color 0.28s ease;
  }

  .mole-pill::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(140deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.28) 42%, rgba(255, 255, 255, 0) 72%);
    pointer-events: none;
    z-index: 0;
  }

  .mole-pill::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: radial-gradient(circle at 86% 50%, rgba(22, 119, 255, 0.16), rgba(22, 119, 255, 0));
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
    z-index: 0;
  }

  .mole-trigger.side-right .mole-pill {
    transform: translateX(${TUCK_OFFSET}px);
  }

  .mole-trigger.side-left .mole-pill {
    transform: translateX(-${TUCK_OFFSET}px);
    flex-direction: row-reverse;
    padding: 0 9px 0 12px;
  }

  .mole-trigger.side-left .mole-pill-info {
    align-items: flex-end;
    text-align: right;
  }

  .mole-trigger.side-left .mole-pill::before {
    background: linear-gradient(220deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.28) 42%, rgba(255, 255, 255, 0) 72%);
  }

  .mole-trigger.side-left .mole-pill::after {
    background: radial-gradient(circle at 14% 50%, rgba(22, 119, 255, 0.16), rgba(22, 119, 255, 0));
  }

  .mole-trigger.task-running .mole-pill,
  .mole-trigger.task-done .mole-pill,
  .mole-trigger.task-error .mole-pill,
  .mole-trigger.announce .mole-pill {
    width: ${PILL_WIDTH}px;
    transform: translateX(0);
  }

  .mole-trigger.side-right.hovering:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill,
  .mole-trigger.side-right.active:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill {
    transform: translateX(${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
    box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }

  .mole-trigger.side-left.hovering:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill,
  .mole-trigger.side-left.active:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-pill {
    transform: translateX(-${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
    box-shadow: 0 16px 34px rgba(15, 23, 42, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.9);
  }

  .mole-trigger.hovering .mole-pill::after,
  .mole-trigger.active .mole-pill::after {
    opacity: 1;
  }

  .mole-trigger.dragging .mole-pill {
    transform: translateX(0) scale(1.03);
    box-shadow: 0 18px 36px rgba(15, 23, 42, 0.2);
    transition: none;
  }

  .mole-pill img {
    position: relative;
    z-index: 1;
    width: ${LOGO_SIZE}px;
    height: ${LOGO_SIZE}px;
    border-radius: 8px;
    pointer-events: none;
    user-select: none;
    -webkit-user-drag: none;
    flex-shrink: 0;
  }

  .mole-pill-info {
    position: relative;
    z-index: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    flex: 1;
    overflow: hidden;
  }

  .mole-shortcut {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--ec-text);
    letter-spacing: 0.2px;
    line-height: 1.15;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    transition: color 0.2s ease;
  }

  .mole-shortcut:empty {
    display: none;
  }

  .mole-pill-meta {
    font-size: 10px;
    color: var(--ec-text-muted);
    line-height: 1.1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    transition: color 0.2s ease;
  }

  /* 胶囊任务状态 */
  .mole-task-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0%, var(--ec-primary) 60%);
    box-shadow: 0 0 0 3px var(--ec-primary-soft);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  .mole-trigger.task-running .mole-pill {
    border-color: rgba(0, 113, 227, 0.26);
  }

  .mole-trigger.task-running .mole-pill-meta {
    color: var(--ec-primary-strong);
  }

  .mole-trigger.task-done .mole-shortcut {
    color: var(--ec-success);
  }

  .mole-trigger.task-done .mole-pill {
    border-color: rgba(36, 138, 61, 0.24);
  }

  .mole-trigger.task-done .mole-pill-meta {
    color: var(--ec-success);
  }

  .mole-trigger.task-error .mole-shortcut {
    color: var(--ec-danger);
  }

  .mole-trigger.task-error .mole-pill {
    border-color: rgba(215, 0, 21, 0.24);
  }

  .mole-trigger.task-error .mole-pill-meta {
    color: var(--ec-danger);
  }

  .mole-pill-notice {
    position: absolute;
    top: -34px;
    left: 50%;
    transform: translate(-50%, 8px) scale(0.96);
    background: var(--ec-surface-strong);
    border: 1px solid var(--ec-border-soft);
    box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16);
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 11px;
    color: var(--ec-text);
    max-width: 220px;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.22s ease;
  }

  .mole-pill-notice.tone-success {
    border-color: rgba(36, 138, 61, 0.24);
    color: var(--ec-success);
  }

  .mole-pill-notice.tone-info {
    border-color: rgba(0, 113, 227, 0.24);
    color: var(--ec-primary-strong);
  }

  .mole-pill-notice.tone-error {
    border-color: rgba(215, 0, 21, 0.24);
    color: var(--ec-danger);
  }

  .mole-trigger::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    width: 56px;
    height: 18px;
    transform: translateX(-50%);
    z-index: 1;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce)::after {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce)::after {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.notice-visible .mole-pill-notice {
    opacity: 1;
    transform: translate(-50%, 0) scale(1);
  }

  .mole-settings-btn {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, -4px);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, rgba(248, 251, 255, 0.96) 0%, var(--ec-surface) 100%);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.14);
    color: var(--ec-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-settings-btn {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-settings-btn {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-settings-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mole-settings-btn:hover {
    transform: translate(-50%, -6px);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2);
  }

  .mole-settings-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.hovering .mole-settings-btn,
  .mole-trigger:focus-within .mole-settings-btn {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }

  .mole-trigger.dragging .mole-settings-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭按钮 ---- */
  .mole-close-btn {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, 4px);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, rgba(248, 251, 255, 0.96) 0%, var(--ec-surface) 100%);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.14);
    color: var(--ec-text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2;
  }

  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-close-btn {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-close-btn {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }

  .mole-close-btn svg {
    width: 14px;
    height: 14px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mole-close-btn:hover {
    transform: translate(-50%, 2px);
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.2);
  }

  .mole-close-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.hovering .mole-close-btn,
  .mole-trigger:focus-within .mole-close-btn {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }

  .mole-trigger.dragging .mole-close-btn {
    opacity: 0;
    pointer-events: none;
  }

  .mole-trigger.active .mole-close-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭菜单 ---- */
  .mole-close-menu {
    display: none;
    position: absolute;
    bottom: calc(100% + 44px);
    min-width: 180px;
    background: linear-gradient(180deg, var(--ec-surface-strong) 0%, var(--ec-surface) 100%);
    backdrop-filter: blur(22px) saturate(180%);
    -webkit-backdrop-filter: blur(22px) saturate(180%);
    border: 1px solid var(--ec-border);
    border-radius: 14px;
    box-shadow: 0 16px 40px rgba(15, 23, 42, 0.18);
    padding: 6px;
    z-index: 10;
    pointer-events: auto;
  }

  /* 右侧：菜单右对齐，向左展开，不会溢出屏幕右边 */
  .mole-trigger.side-right .mole-close-menu {
    right: 0;
  }

  /* 左侧：菜单左对齐，向右展开，不会溢出屏幕左边 */
  .mole-trigger.side-left .mole-close-menu {
    left: 0;
  }

  .mole-close-menu.visible {
    display: block;
  }

  .mole-close-menu-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--ec-text);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.15s ease;
    white-space: nowrap;
  }

  .mole-close-menu-item:hover {
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
  }

  .mole-trigger.side-right.booting .mole-pill {
    animation: mole-pill-enter-right 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-left.booting .mole-pill {
    animation: mole-pill-enter-left 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-right.snapping:not(.task-running):not(.announce) .mole-pill {
    animation: mole-pill-snap-right 480ms cubic-bezier(0.2, 1.18, 0.32, 1);
  }

  .mole-trigger.side-left.snapping:not(.task-running):not(.announce) .mole-pill {
    animation: mole-pill-snap-left 480ms cubic-bezier(0.2, 1.18, 0.32, 1);
  }

  /* 终止按钮 */
  .mole-stop-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(215, 0, 21, 0.18);
    outline: none;
    background: var(--ec-danger-soft);
    color: var(--ec-danger);
    border-radius: 9px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
  }

  .mole-stop-btn:hover {
    transform: translateY(-1px);
    background: rgba(215, 0, 21, 0.12);
    border-color: rgba(215, 0, 21, 0.24);
  }

  .mole-stop-btn.visible {
    display: flex;
  }

  .mole-stop-btn:focus-visible,
  .mole-new-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  .mole-trigger.snapping {
    transition: left 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94),
                top 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  /* ---- 遮罩层 ---- */
  .mole-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 2147483646;
    background:
      radial-gradient(circle at top left, rgba(137, 181, 255, 0.22), transparent 34%),
      radial-gradient(circle at top right, rgba(255, 255, 255, 0.92), transparent 36%),
      rgba(244, 248, 252, 0.56);
    backdrop-filter: blur(18px) saturate(125%);
    -webkit-backdrop-filter: blur(18px) saturate(125%);
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;

    /* 搜索框居中偏上 */
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 18vh;
  }

  .mole-overlay.visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* ---- 搜索框容器 ---- */
  .mole-searchbox {
    position: relative;
    width: 580px;
    max-width: 90vw;
    background: linear-gradient(180deg, rgba(250, 252, 255, 0.97) 0%, var(--ec-surface) 100%);
    backdrop-filter: blur(28px) saturate(155%);
    -webkit-backdrop-filter: blur(28px) saturate(155%);
    border: 1px solid var(--ec-border);
    border-radius: 26px;
    box-shadow: var(--ec-shadow);
    overflow: hidden;

    transform: scale(0.95) translateY(-10px);
    opacity: 0;
    transition: transform 0.25s cubic-bezier(0.34, 1.3, 0.64, 1),
                opacity 0.2s ease;
  }

  .mole-overlay.visible .mole-searchbox {
    transform: scale(1) translateY(0);
    opacity: 1;
  }

  .mole-searchbox.state-running {
    border-color: rgba(22, 119, 255, 0.24);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(22, 119, 255, 0.12);
  }

  .mole-searchbox.state-done {
    border-color: rgba(18, 183, 106, 0.24);
  }

  .mole-searchbox.state-error {
    border-color: rgba(239, 68, 68, 0.24);
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.14), 0 0 0 1px rgba(239, 68, 68, 0.1);
  }

  /* 输入行 */
  .mole-input-row {
    display: flex;
    align-items: center;
    margin: 12px 12px 8px;
    padding: 12px 14px;
    gap: 12px;
    border-radius: 18px;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, rgba(248, 251, 255, 0.96) 0%, rgba(255, 255, 255, 0.88) 100%);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
  }

  .mole-input-row:focus-within {
    border-color: rgba(22, 119, 255, 0.24);
    background: rgba(255, 255, 255, 0.96);
    box-shadow: var(--ec-focus-ring);
  }

  .mole-input-icon {
    width: 22px;
    height: 22px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .mole-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 15px;
    line-height: 1.45;
    color: var(--ec-text);
    caret-color: var(--ec-primary);
  }

  .mole-input::placeholder {
    color: var(--ec-text-muted);
    opacity: 0.78;
  }

  .mole-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mole-input-hint {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--ec-text-muted);
    padding: 5px 9px;
    border: 1px solid var(--ec-border-soft);
    background: rgba(255, 255, 255, 0.78);
    border-radius: 999px;
    line-height: 1;
  }

  /* 分割线 */
  .mole-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--ec-border-soft), transparent);
    margin: 0 12px;
  }

  /* ---- 结果展示区 ---- */
  .mole-result {
    display: none;
    max-height: 50vh;
    overflow-y: auto;
    padding: 14px 16px 16px;
    font-size: 15px;
    line-height: 1.72;
    letter-spacing: 0.01em;
    color: var(--ec-text);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0) 0%, rgba(0, 113, 227, 0.02) 100%);
  }

  .mole-result.visible {
    display: block;
  }

  /* 状态指示 */
  .mole-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    color: var(--ec-text);
    font-size: 12px;
    border-radius: 14px;
    border: 1px solid var(--ec-border-soft);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(248, 250, 252, 0.94));
    box-shadow: 0 8px 20px rgba(15, 23, 42, 0.04);
  }

  .mole-status .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ec-primary);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  /* 规划状态指示（与 thinking 类似，使用品牌蓝） */
  .mole-planning {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 8px 0;
    padding: 10px 12px;
    color: var(--ec-primary-strong);
    font-size: 12px;
    border-radius: 14px;
    border: 1px solid rgba(22, 119, 255, 0.14);
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.08), rgba(255, 255, 255, 0.92));
    box-shadow: 0 8px 20px rgba(22, 119, 255, 0.05);
  }

  .mole-planning .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--ec-primary-strong);
    animation: mole-pulse 1.2s ease-in-out infinite;
  }

  .mole-review-output {
    margin: 10px 0;
    border: 1px solid rgba(15, 23, 42, 0.08);
    border-radius: 12px;
    background: rgba(248, 250, 252, 0.85);
    padding: 10px 12px;
    color: var(--ec-text);
    font-size: 13px;
    line-height: 1.5;
  }

  .mole-review-summary {
    font-weight: 600;
    color: #0f172a;
    margin-bottom: 6px;
  }

  .mole-review-findings {
    margin: 0;
    padding-left: 18px;
  }

  .mole-review-findings li + li {
    margin-top: 6px;
  }

  .mole-review-priority {
    color: #b45309;
    font-weight: 700;
  }

  /* 调度状态机日志 */
  .mole-agent-state-panel {
    margin: 10px 0;
    border-radius: 18px;
    border: 1px solid var(--ec-border-soft);
    background: rgba(248, 251, 255, 0.92);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.04);
    overflow: hidden;
  }

  .mole-agent-state-title {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 12px 14px;
    font-size: 11px;
    color: var(--ec-primary-strong);
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.06), rgba(255, 255, 255, 0.38));
    font-weight: 600;
    user-select: none;
    cursor: pointer;
    transition: background 0.18s ease;
  }

  .mole-agent-state-panel.is-live .mole-agent-state-title {
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.08), rgba(255, 255, 255, 0.42));
  }

  .mole-agent-state-title-main {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: 11px;
    letter-spacing: 0.02em;
    color: var(--ec-text-soft);
  }

  .mole-agent-state-summary {
    min-width: 0;
    margin-left: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ec-text);
    font-weight: 600;
    padding: 9px 11px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(219, 227, 238, 0.78);
  }

  .mole-agent-state-panel.is-live .mole-agent-state-summary::before {
    content: '';
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 999px;
    background: rgba(0, 113, 227, 0.72);
    animation: mole-pulse 2.6s ease-in-out infinite;
    vertical-align: middle;
  }

  .mole-agent-state-ops-anchor {
    display: none;
    padding: 0 12px 12px;
  }

  .mole-agent-state-panel.open .mole-agent-state-ops-anchor {
    display: block;
  }

  .mole-agent-state-ops-anchor .mole-calls-group {
    margin: 0;
  }

  .mole-agent-state-title:hover {
    background: rgba(0, 113, 227, 0.08);
  }

  .mole-agent-state-title .arrow {
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-agent-state-panel.open .mole-agent-state-title .arrow {
    transform: rotate(90deg);
  }

  .mole-agent-state-panel.open .mole-agent-state-summary {
    display: none;
  }

  .mole-agent-state-log {
    display: none;
    padding: 6px 14px 4px;
  }

  .mole-agent-state-panel.open .mole-agent-state-log {
    display: block;
  }

  .mole-agent-state-item {
    font-size: 12px;
    color: var(--ec-text);
    line-height: 1.6;
    word-break: break-word;
  }

  .mole-agent-state-item + .mole-agent-state-item {
    margin-top: 4px;
  }

  .mole-task-runtime-board {
    display: none;
    gap: 8px;
    padding: 0 14px 14px;
    background: transparent;
  }

  .mole-agent-state-panel.open .mole-task-runtime-board {
    display: grid;
  }

  .mole-runtime-now {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.84);
    border: 1px solid rgba(219, 227, 238, 0.74);
    color: var(--ec-text);
    font-size: 12px;
    line-height: 1.5;
    font-weight: 600;
  }

  .mole-runtime-now-text {
    min-width: 0;
    flex: 1;
  }

  .mole-inline-loader {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .mole-inline-loader span {
    width: 4px;
    height: 4px;
    border-radius: 999px;
    background: rgba(22, 119, 255, 0.58);
    animation: mole-loader-fade 1.2s ease-in-out infinite;
  }

  .mole-inline-loader span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .mole-inline-loader span:nth-child(3) {
    animation-delay: 0.32s;
  }

  .mole-task-runtime-step-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    margin-top: 7px;
    background: rgba(22, 119, 255, 0.22);
  }

  @keyframes mole-pulse {
    0%, 100% {
      opacity: 0.55;
      transform: scale(1);
    }
    50% {
      opacity: 0.9;
      transform: scale(1.03);
    }
  }

  @keyframes mole-loader-fade {
    0%, 80%, 100% { opacity: 0.24; transform: scale(1); }
    40% { opacity: 0.9; transform: scale(1.15); }
  }

  @keyframes mole-breathe {
    0%, 100% { transform: scale(1); opacity: 0.98; }
    50% { transform: scale(1.004); opacity: 1; }
  }

  @keyframes mole-pill-enter-right {
    0% {
      opacity: 0;
      transform: translateX(${TUCK_OFFSET + 16}px) scale(0.9);
    }
    65% {
      opacity: 1;
      transform: translateX(${TUCK_OFFSET - 4}px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateX(${TUCK_OFFSET}px) scale(1);
    }
  }

  @keyframes mole-pill-enter-left {
    0% {
      opacity: 0;
      transform: translateX(-${TUCK_OFFSET + 16}px) scale(0.9);
    }
    65% {
      opacity: 1;
      transform: translateX(-${TUCK_OFFSET - 4}px) scale(1.02);
    }
    100% {
      opacity: 1;
      transform: translateX(-${TUCK_OFFSET}px) scale(1);
    }
  }

  @keyframes mole-pill-snap-right {
    0% { transform: translateX(0) scale(1.02); }
    60% { transform: translateX(${TUCK_OFFSET + 10}px) scale(0.98); }
    100% { transform: translateX(${TUCK_OFFSET}px) scale(1); }
  }

  @keyframes mole-pill-snap-left {
    0% { transform: translateX(0) scale(1.02); }
    60% { transform: translateX(-${TUCK_OFFSET + 10}px) scale(0.98); }
    100% { transform: translateX(-${TUCK_OFFSET}px) scale(1); }
  }

  /* 函数调用标签 */
  .mole-func-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px;
    margin: 4px 0;
    background: var(--ec-primary-soft);
    border: 1px solid rgba(0, 113, 227, 0.14);
    border-radius: 10px;
    font-size: 12px;
    color: var(--ec-primary-strong);
  }

  .mole-func-icon {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* ---- 函数调用折叠区 ---- */
  .mole-calls-group {
    margin: 4px 0 0;
  }

  .mole-calls-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 9px 11px;
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.08), rgba(255, 255, 255, 0.88));
    border: 1px solid rgba(22, 119, 255, 0.12);
    border-radius: 12px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: var(--ec-primary-strong);
    user-select: none;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .mole-calls-summary:hover {
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.1), rgba(255, 255, 255, 0.92));
    border-color: rgba(22, 119, 255, 0.18);
  }

  .mole-calls-summary .arrow {
    display: inline-block;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-calls-summary .arrow.open {
    transform: rotate(90deg);
  }

  .mole-calls-icons {
    display: flex;
    gap: 3px;
  }

  .mole-calls-icons img {
    width: 14px;
    height: 14px;
    border-radius: 3px;
  }

  .mole-calls-detail {
    display: none;
    padding: 8px 2px 0;
  }

  .mole-calls-detail.open {
    display: grid;
    gap: 6px;
  }

  .mole-calls-detail .mole-call-item {
    margin: 0;
  }

  .mole-call-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 9px 11px;
    border-radius: 12px;
    cursor: default;
    font-size: 12px;
    color: var(--ec-text);
    user-select: none;
    border: 1px solid rgba(219, 227, 238, 0.72);
    background: rgba(255, 255, 255, 0.82);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.03);
  }

  .mole-call-item.tone-status .mole-call-header {
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.06), rgba(255, 255, 255, 0.9));
  }

  .mole-call-item.tone-action .mole-call-header {
    background: linear-gradient(180deg, rgba(124, 58, 237, 0.06), rgba(255, 255, 255, 0.9));
  }

  .mole-call-item.tone-issue .mole-call-header {
    background: linear-gradient(180deg, rgba(245, 158, 11, 0.1), rgba(255, 255, 255, 0.9));
  }

  .mole-call-item.tone-done .mole-call-header {
    background: linear-gradient(180deg, rgba(18, 183, 106, 0.09), rgba(255, 255, 255, 0.9));
  }

  .mole-call-header.has-body {
    cursor: pointer;
  }

  .mole-call-header .arrow {
    display: inline-block;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-call-header .arrow.open {
    transform: rotate(90deg);
  }

  .mole-call-status {
    margin-left: auto;
    font-size: 10px;
    padding-top: 1px;
    color: var(--ec-text-muted);
    flex-shrink: 0;
  }

  .mole-call-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .mole-call-title {
    line-height: 1.4;
    font-weight: 600;
    color: var(--ec-text);
  }

  .mole-call-intent {
    font-size: 11px;
    line-height: 1.45;
    color: var(--ec-text-muted);
    font-weight: 400;
    word-break: break-word;
  }

  .mole-call-body {
    display: none;
    padding: 8px 0 8px 24px;
  }

  .mole-call-body.open {
    display: block;
  }

  /* ---- 推荐卡片 ---- */
  .mole-rec-cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 10px 0 4px;
  }

  .mole-rec-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: linear-gradient(160deg, var(--ec-surface-soft) 0%, rgba(0, 113, 227, 0.05) 100%);
    border: 1px solid var(--ec-border-soft);
    border-radius: 14px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    color: inherit;
  }

  .mole-rec-card:hover {
    background: linear-gradient(160deg, var(--ec-surface-strong) 0%, rgba(0, 113, 227, 0.09) 100%);
    border-color: rgba(0, 113, 227, 0.16);
    transform: translateY(-1px);
    box-shadow: var(--ec-card-shadow);
  }

  .mole-rec-card-body {
    flex: 1;
    min-width: 0;
  }

  .mole-rec-card-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--ec-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-rec-card-meta {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 2px;
  }

  .mole-rec-card-price {
    color: var(--ec-danger);
    font-weight: 600;
  }

  .mole-rec-tag {
    flex-shrink: 0;
    padding: 2px 8px;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }

  .mole-rec-arrow {
    flex-shrink: 0;
    color: var(--ec-text-muted);
    font-size: 16px;
    line-height: 1;
  }

  /* ---- 新对话按钮 ---- */
  .mole-new-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid var(--ec-border-soft);
    outline: none;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 9px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    padding: 0;
  }

  .mole-new-btn:hover {
    background: rgba(0, 113, 227, 0.12);
    color: var(--ec-primary-strong);
    border-color: rgba(0, 113, 227, 0.2);
    transform: translateY(-1px);
  }

  .mole-new-btn.visible {
    display: flex;
  }

  /* ---- 重试按钮（断点恢复） ---- */
  .mole-retry-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(245, 158, 11, 0.2);
    outline: none;
    background: rgba(245, 158, 11, 0.06);
    color: #d97706;
    border-radius: 9px;
    cursor: pointer;
    display: none;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    line-height: 1;
    transition: all 0.15s ease;
    padding: 0;
  }

  .mole-retry-btn:hover {
    background: rgba(245, 158, 11, 0.12);
    color: #b45309;
    border-color: rgba(245, 158, 11, 0.3);
    transform: translateY(-1px);
  }

  .mole-retry-btn.visible {
    display: flex;
  }

  .mole-retry-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  .mole-retry-btn:focus-visible {
    box-shadow: var(--ec-focus-ring);
  }

  /* ---- 定位到任务页签按钮 ---- */
  .mole-focus-tab-btn {
    flex-shrink: 0;
    height: 26px;
    border: 1px solid rgba(0, 113, 227, 0.2);
    outline: none;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    border-radius: 13px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    line-height: 1;
    transition: all 0.15s ease;
    padding: 0 10px;
    white-space: nowrap;
    pointer-events: auto;
  }
  .mole-focus-tab-btn:hover {
    background: rgba(0, 113, 227, 0.15);
    border-color: rgba(0, 113, 227, 0.3);
  }

  /* ---- 用户消息气泡 ---- */
  .mole-user-msg {
    margin: 12px 0 6px;
    padding: 9px 14px;
    background: linear-gradient(180deg, rgba(22, 119, 255, 0.12), rgba(255, 255, 255, 0.82));
    border: 1px solid rgba(22, 119, 255, 0.18);
    border-radius: 16px 16px 8px 16px;
    font-size: 13px;
    color: var(--ec-text);
    max-width: 85%;
    margin-left: auto;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
    word-break: break-word;
  }

  /* ---- 历史对话折叠 ---- */
  .mole-round-history {
    margin-bottom: 4px;
    border-bottom: 1px solid var(--ec-border-soft);
    padding-bottom: 4px;
  }
  .mole-round-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 2px;
    cursor: pointer;
    font-size: 12px;
    color: var(--ec-text-muted);
    user-select: none;
  }
  .mole-round-summary:hover {
    color: var(--ec-text);
  }
  .mole-round-summary .arrow {
    font-size: 9px;
    transition: transform 0.2s;
    color: var(--ec-text-muted);
  }
  .mole-round-summary .arrow.open {
    transform: rotate(90deg);
  }
  .mole-round-preview {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .mole-round-content {
    display: none;
    padding: 4px 0 2px;
  }
  .mole-round-content.open {
    display: block;
  }

  /* ---- 搜索结果卡片（带缩略图） ---- */
  .mole-result-card {
    display: flex;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid rgba(219, 227, 238, 0.84);
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.84), rgba(248, 251, 255, 0.78));
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.04);
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
    cursor: pointer;
  }

  .mole-result-card:hover {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(240, 247, 255, 0.8));
    border-color: rgba(22, 119, 255, 0.18);
    transform: translateY(-1px);
  }

  .mole-result-thumb {
    width: 58px;
    height: 58px;
    border-radius: 12px;
    object-fit: cover;
    flex-shrink: 0;
    background: rgba(148, 163, 184, 0.18);
    border: 1px solid rgba(219, 227, 238, 0.84);
  }

  .mole-result-body {
    flex: 1;
    min-width: 0;
  }

  /* AI 回复文本 */
  .mole-answer {
    margin: 8px 0 4px;
    padding: 13px 15px;
    border-radius: 18px;
    border: 1px solid rgba(219, 227, 238, 0.9);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 251, 255, 0.84));
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.05);
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 13px;
    line-height: 1.7;
  }

  .mole-answer p {
    margin: 0;
  }

  .mole-answer p + p {
    margin-top: 10px;
  }

  .mole-answer h3, .mole-answer h4, .mole-answer h5 {
    font-weight: 600;
    margin: 14px 0 6px;
    color: #111112;
  }

  .mole-answer h3 { font-size: 16px; letter-spacing: -0.01em; }
  .mole-answer h4 { font-size: 15px; letter-spacing: -0.01em; }

  .mole-answer ul, .mole-answer ol {
    padding-left: 20px;
    margin: 8px 0;
  }

  .mole-answer li {
    margin: 4px 0;
  }

  .mole-answer code {
    background: rgba(22, 119, 255, 0.08);
    border: 1px solid rgba(22, 119, 255, 0.12);
    padding: 2px 6px;
    border-radius: 7px;
    font-size: 12px;
    font-family: "SF Mono", Monaco, Consolas, monospace;
  }

  .mole-answer pre {
    margin: 10px 0 0;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid rgba(15, 23, 42, 0.1);
    background: rgba(15, 23, 42, 0.9);
    color: #f2f5f9;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    overflow-x: auto;
    white-space: pre;
  }

  .mole-answer pre code {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
  }

  .mole-answer blockquote {
    margin: 10px 0 0;
    padding: 9px 12px;
    border-left: 3px solid rgba(22, 119, 255, 0.42);
    border-radius: 0 12px 12px 0;
    background: rgba(22, 119, 255, 0.06);
    color: #314863;
  }

  .mole-answer strong {
    font-weight: 600;
    color: var(--ec-text);
  }

  .mole-answer a {
    color: var(--ec-primary-strong);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* 错误信息 */
  .mole-error {
    color: var(--ec-danger);
    padding: 4px 0;
    font-size: 13px;
  }

  /* ---- 搜索结果卡片 ---- */
  .mole-search-results {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mole-result-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--ec-primary-strong);
    text-decoration: none;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.4;
  }

  .mole-result-title:hover {
    text-decoration: underline;
  }

  .mole-result-snippet {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 4px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    line-height: 1.5;
  }

  .mole-result-source {
    font-size: 12px;
    color: var(--ec-text-muted);
    margin-top: 4px;
  }

  .mole-result-count {
    font-size: 12px;
    color: var(--ec-text-muted);
    padding: 4px 2px 10px;
  }

  /* 截图结果内联展示 */
  .mole-screenshot-section {
    margin: 8px 0;
    padding: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(245, 248, 255, 0.72));
    border-radius: 16px;
    border: 1px solid rgba(219, 227, 238, 0.9);
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
  }
  .mole-screenshot-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .mole-screenshot-meta {
    min-width: 0;
  }
  .mole-screenshot-label {
    font-size: 12px;
    color: #354b67;
    font-weight: 600;
    line-height: 1.4;
  }
  .mole-screenshot-sub {
    font-size: 11px;
    margin-top: 2px;
    color: var(--ec-text-muted);
    line-height: 1.4;
  }
  .mole-screenshot-open {
    flex-shrink: 0;
    border: 1px solid rgba(0, 113, 227, 0.2);
    background: rgba(0, 113, 227, 0.08);
    color: var(--ec-primary-strong);
    border-radius: 8px;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .mole-screenshot-open:hover {
    background: rgba(0, 113, 227, 0.12);
  }
  .mole-verify-section,
  .mole-repair-section {
    margin: 8px 0;
    padding: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(245, 248, 255, 0.66));
    border-radius: 14px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  }
  .mole-verify-header,
  .mole-repair-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 8px;
  }
  .mole-verify-title,
  .mole-repair-title {
    font-size: 12px;
    color: #354b67;
    font-weight: 600;
    line-height: 1.4;
  }
  .mole-verify-badge,
  .mole-repair-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .mole-verify-badge.ok,
  .mole-repair-badge.ok {
    color: #166534;
    background: rgba(22, 101, 52, 0.1);
  }
  .mole-verify-badge.fail,
  .mole-repair-badge.fail {
    color: #b42318;
    background: rgba(180, 35, 24, 0.1);
  }
  .mole-verify-list,
  .mole-repair-list,
  .mole-repair-candidates {
    display: grid;
    gap: 6px;
  }
  .mole-verify-item,
  .mole-repair-item,
  .mole-repair-candidate {
    font-size: 12px;
    line-height: 1.5;
    color: var(--ec-text);
    padding: 7px 8px;
    background: rgba(255, 255, 255, 0.72);
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.06);
  }
  .mole-verify-item.fail {
    border-color: rgba(180, 35, 24, 0.18);
    background: rgba(255, 245, 245, 0.92);
  }
  .mole-repair-item-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mole-verify-sub,
  .mole-repair-sub {
    font-size: 11px;
    margin-top: 2px;
    color: var(--ec-text-muted);
    line-height: 1.45;
  }
  .mole-screenshot-open:focus-visible {
    box-shadow: var(--ec-focus-ring);
    outline: none;
  }

  /* 确认卡片 — 独立展示 */
  .mole-approval-standalone {
    margin: 10px 0;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(240, 253, 250, 0.95), rgba(204, 251, 241, 0.55));
    border: 1.5px solid rgba(13, 148, 136, 0.22);
    box-shadow: 0 4px 20px rgba(13, 148, 136, 0.08);
    animation: mole-approval-fadein 0.35s ease-out;
    overflow: hidden;
  }
  .mole-approval-header-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 14px 0;
    font-size: 13px;
    font-weight: 600;
    color: rgb(15, 118, 110);
  }
  .mole-approval-header-bar img {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  .mole-approval-standalone .mole-approval-card {
    margin: 8px 14px 14px;
    padding: 0;
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 0;
  }
  .mole-approval-standalone.settled {
    opacity: 0.75;
    animation: none;
    border-color: var(--ec-border);
    background: var(--ec-bg-soft);
    transition: opacity 0.3s ease;
  }
  .mole-approval-standalone.settled .mole-approval-header-bar {
    color: var(--ec-text-muted);
    padding-bottom: 10px;
  }
  .mole-approval-standalone.settled .mole-approval-card {
    display: none;
  }
  @keyframes mole-approval-fadein {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .mole-approval-card {
    padding: 10px 12px;
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(245, 250, 255, 0.7));
    border: 1px solid rgba(13, 148, 136, 0.18);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06);
  }
  .mole-approval-message {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ec-text);
    margin-bottom: 30px;
    word-break: break-word;
  }
  .mole-approval-actions {
    display: flex;
    gap: 8px;
  }
  .mole-approval-btn {
    padding: 6px 16px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.15s;
    line-height: 1.4;
  }
  .mole-approval-btn:hover { opacity: 0.85; }
  .mole-approval-btn.approve {
    background: var(--ec-success);
    color: #fff;
  }
  .mole-approval-btn.reject {
    background: var(--ec-danger-soft);
    color: var(--ec-danger);
  }
  .mole-approval-btn.trust-all {
    background: var(--ec-bg-soft);
    color: var(--ec-text-secondary);
    font-size: 11px;
  }
  .mole-approval-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  .mole-approval-reject-input {
    margin-top: 8px;
    display: none;
    gap: 6px;
    align-items: center;
  }
  .mole-approval-reject-input.open {
    display: flex;
  }
  .mole-approval-reject-input input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--ec-border);
    border-radius: 6px;
    font-size: 12px;
    outline: none;
    background: rgba(255, 255, 255, 0.9);
    color: var(--ec-text);
    line-height: 1.4;
  }
  .mole-approval-reject-input input:focus {
    border-color: var(--ec-primary);
    box-shadow: 0 0 0 2px rgba(0, 113, 227, 0.1);
  }
  .mole-approval-card.settled {
    opacity: 0.7;
  }
  .mole-approval-result {
    font-size: 12px;
    margin-top: 6px;
    color: var(--ec-text-muted);
  }
  .mole-screenshot-img-wrap {
    position: relative;
  }
  .mole-screenshot-img {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid rgba(15, 23, 42, 0.08);
    transition: transform 0.2s ease, filter 0.2s ease;
  }
  .mole-screenshot-img:hover {
    transform: scale(1.01);
    filter: saturate(104%);
  }
  .mole-screenshot-hint {
    position: absolute;
    right: 8px;
    bottom: 8px;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 11px;
    color: #fff;
    background: rgba(15, 23, 42, 0.62);
    pointer-events: none;
  }
  .mole-screenshot-artifact {
    font-size: 12px;
    color: var(--ec-text-muted);
    border: 1px dashed rgba(15, 23, 42, 0.16);
    border-radius: 10px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.64);
    word-break: break-all;
  }

  .mole-image-viewer {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 26px;
    background: rgba(9, 12, 18, 0.78);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.18s ease;
    z-index: 2147483647;
  }

  .mole-image-viewer.open {
    opacity: 1;
    pointer-events: auto;
  }

  .mole-image-viewer-content {
    position: relative;
    width: min(920px, 100%);
    max-height: calc(100vh - 52px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
  }

  .mole-image-viewer-stage {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .mole-image-viewer-img {
    flex: 1;
    width: 100%;
    max-height: calc(100vh - 120px);
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    box-shadow: 0 28px 62px rgba(0, 0, 0, 0.4);
    background: #fff;
    object-fit: contain;
  }

  .mole-image-viewer-nav {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(15, 23, 42, 0.66);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mole-image-viewer-nav:disabled {
    opacity: 0.32;
    cursor: not-allowed;
  }

  .mole-image-viewer-nav:not(:disabled):hover {
    background: rgba(15, 23, 42, 0.8);
  }

  .mole-image-viewer-nav:focus-visible,
  .mole-image-viewer-close:focus-visible {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.22);
    outline: none;
  }

  .mole-image-viewer-meta {
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.9);
    background: rgba(15, 23, 42, 0.52);
    border: 1px solid rgba(255, 255, 255, 0.16);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mole-image-viewer-close {
    position: absolute;
    top: -8px;
    right: -8px;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: rgba(15, 23, 42, 0.68);
    color: #fff;
    font-size: 18px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mole-image-viewer-close:hover {
    background: rgba(15, 23, 42, 0.86);
  }

  /* 底部提示区 */
  .mole-footer {
    padding: 10px 14px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ec-text-muted);
    font-size: 12px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.68) 100%);
    border-top: 1px solid var(--ec-border-soft);
  }

  .mole-footer-icon {
    font-size: 14px;
    color: var(--ec-primary-strong);
  }

  .mole-footer-text {
    min-width: 0;
    flex: 1;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
  }

  .mole-footer-time {
    margin-left: auto;
    font-size: 11px;
    color: var(--ec-text-muted);
    background: rgba(255, 255, 255, 0.76);
    border: 1px solid rgba(22, 119, 255, 0.14);
    border-radius: 999px;
    padding: 4px 8px;
    white-space: nowrap;
  }

  .mole-footer-time:empty {
    display: none;
  }

  .mole-searchbox.state-running .mole-footer-time {
    background: rgba(22, 119, 255, 0.1);
    border-color: rgba(22, 119, 255, 0.18);
    color: var(--ec-primary-strong);
  }

  .mole-searchbox.state-running .mole-footer-icon {
    animation: mole-breathe 1.4s ease-in-out infinite;
  }

  .mole-searchbox.state-done .mole-footer-icon {
    color: var(--ec-success);
  }

  .mole-searchbox.state-error .mole-footer-icon {
    color: var(--ec-danger);
  }

  .mole-searchbox.state-done .mole-footer-time {
    background: var(--ec-success-soft);
    border-color: rgba(18, 183, 106, 0.24);
    color: var(--ec-success);
  }

  .mole-searchbox.state-error .mole-footer-time {
    background: var(--ec-danger-soft);
    border-color: rgba(239, 68, 68, 0.18);
    color: var(--ec-danger);
  }

  /* 滚动条美化 */
  .mole-result::-webkit-scrollbar {
    width: 4px;
  }

  .mole-result::-webkit-scrollbar-track {
    background: transparent;
  }

  .mole-result::-webkit-scrollbar-thumb {
    background: rgba(0, 113, 227, 0.26);
    border-radius: 2px;
  }

  @media (max-width: 720px) {
    .mole-image-viewer {
      padding: 14px;
    }

    .mole-image-viewer-stage {
      gap: 8px;
    }

    .mole-image-viewer-nav {
      width: 34px;
      height: 34px;
      font-size: 16px;
    }
  }

  /* ===== 提问卡片（ask_user）===== */

  .mole-ask-user-standalone {
    margin: 10px 0;
    border-radius: 14px;
    background: linear-gradient(135deg, rgba(238, 242, 255, 0.95), rgba(199, 210, 254, 0.55));
    border: 1.5px solid rgba(79, 70, 229, 0.22);
    box-shadow: 0 4px 20px rgba(79, 70, 229, 0.08);
    animation: mole-ask-user-fadein 0.35s ease-out;
    overflow: hidden;
  }
  .mole-ask-user-header-bar {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 11px 14px 0;
    font-size: 13px;
    font-weight: 600;
    color: rgb(79, 70, 229);
  }
  .mole-ask-user-header-bar img {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
  .mole-ask-user-standalone .mole-ask-user-card {
    margin: 8px 14px 14px;
    padding: 0;
    background: none;
    border: none;
    box-shadow: none;
    border-radius: 0;
  }
  .mole-ask-user-standalone.settled {
    opacity: 0.65;
    animation: none;
    border-color: var(--ec-border);
    background: var(--ec-bg-soft);
  }
  .mole-ask-user-standalone.settled .mole-ask-user-header-bar {
    color: var(--ec-text-muted);
  }
  @keyframes mole-ask-user-fadein {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .mole-ask-user-question {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ec-text);
    margin-bottom: 10px;
    word-break: break-word;
  }
  .mole-ask-user-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 8px;
  }
  .mole-ask-user-option {
    padding: 6px 14px;
    border-radius: 8px;
    border: 1px solid rgba(79, 70, 229, 0.2);
    background: rgba(79, 70, 229, 0.06);
    color: rgb(79, 70, 229);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
    line-height: 1.4;
  }
  .mole-ask-user-option:hover {
    background: rgba(79, 70, 229, 0.12);
    border-color: rgba(79, 70, 229, 0.32);
    transform: translateY(-1px);
  }
  .mole-ask-user-option:active {
    transform: translateY(0);
  }
  .mole-ask-user-option.selected {
    background: rgb(79, 70, 229);
    color: #fff;
    border-color: rgb(79, 70, 229);
  }
  .mole-ask-user-option:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
    transform: none;
  }
  .mole-ask-user-input-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .mole-ask-user-text {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--ec-border);
    border-radius: 8px;
    font-size: 13px;
    outline: none;
    background: rgba(255, 255, 255, 0.9);
    color: var(--ec-text);
    line-height: 1.4;
  }
  .mole-ask-user-text:focus {
    border-color: rgb(79, 70, 229);
    box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
  }
  .mole-ask-user-text:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .mole-ask-user-submit {
    padding: 6px 14px;
    border-radius: 8px;
    border: none;
    background: rgb(79, 70, 229);
    color: #fff;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: opacity 0.15s;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .mole-ask-user-submit:hover { opacity: 0.85; }
  .mole-ask-user-submit:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    pointer-events: none;
  }
  .mole-ask-user-card.settled {
    opacity: 0.7;
  }
  .mole-ask-user-result {
    font-size: 12px;
    margin-top: 6px;
    color: var(--ec-text-muted);
  }

  /* ===== Workflow 快捷操作卡片 ===== */

  .mole-workflow-hints {
    padding: 10px 14px 8px;
  }

  .mole-workflow-hints-title {
    font-size: 10px;
    color: #b0b0b4;
    margin-bottom: 6px;
    font-weight: 500;
    letter-spacing: 0.03em;
  }

  .mole-workflow-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .mole-workflow-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(219, 227, 238, 0.84);
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    font-size: 11px;
    line-height: 1.4;
    color: #667085;
    box-shadow: 0 4px 10px rgba(15, 23, 42, 0.03);
  }

  .mole-workflow-chip:hover {
    background: rgba(22, 119, 255, 0.08);
    border-color: rgba(22, 119, 255, 0.16);
    color: #1677ff;
  }

  .mole-workflow-chip:active {
    background: rgba(22, 119, 255, 0.14);
  }

  .mole-workflow-chip-label {
    font-weight: 500;
  }

  .mole-workflow-chip-desc {
    display: none;
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation: none !important;
      transition: none !important;
    }
  }

  /* ===== 后台任务角标 ===== */

  .mole-bg-task-badge {
    position: absolute;
    top: 2px;
    left: 22px;
    min-width: 16px;
    height: 16px;
    border-radius: 999px;
    background: var(--ec-primary-strong);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    padding: 0 4px;
    display: none;
    z-index: 2;
    pointer-events: none;
  }

  .mole-bg-task-badge.visible {
    display: block;
  }

  /* ===== 后台任务面板 ===== */

  .mole-bg-tasks-panel {
    display: none;
    padding: 6px 14px 8px;
  }

  .mole-bg-tasks-panel.visible {
    display: block;
  }

  .mole-bg-tasks-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--ec-text-muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 8px;
    transition: background 0.15s;
    user-select: none;
  }

  .mole-bg-tasks-header:hover {
    background: rgba(0, 113, 227, 0.06);
  }

  .mole-bg-tasks-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--ec-primary-soft);
    color: var(--ec-primary-strong);
    font-size: 11px;
    font-weight: 600;
  }

  .mole-bg-tasks-toggle {
    margin-left: auto;
    font-size: 10px;
    transition: transform 0.2s ease;
  }

  .mole-bg-tasks-panel.open .mole-bg-tasks-toggle {
    transform: rotate(90deg);
  }

  .mole-bg-tasks-list {
    display: none;
    gap: 4px;
    margin-top: 6px;
  }

  .mole-bg-tasks-panel.open .mole-bg-tasks-list {
    display: grid;
  }

  .mole-bg-task-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.7);
    transition: background 0.15s;
  }

  .mole-bg-task-item:hover {
    background: rgba(255, 255, 255, 0.9);
  }

  .mole-bg-task-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .mole-bg-task-icon img {
    width: 100%;
    height: 100%;
  }

  .mole-bg-task-info {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .mole-bg-task-name {
    font-size: 12px;
    font-weight: 500;
    color: var(--ec-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-bg-task-meta {
    font-size: 11px;
    color: var(--ec-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mole-bg-task-close {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--ec-text-muted);
    font-size: 14px;
    line-height: 22px;
    text-align: center;
    cursor: pointer;
    opacity: 0;
    flex-shrink: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    padding: 0;
  }

  .mole-bg-task-item:hover .mole-bg-task-close {
    opacity: 1;
  }

  .mole-bg-task-close:hover {
    background: var(--ec-danger-soft);
    color: var(--ec-danger);
  }

  /* ===== 工作流录制 ===== */

  /* 录制按钮（hover 时出现在 settingsBtn 正下方） */
  .mole-record-btn {
    position: absolute;
    top: calc(100% + 46px);
    left: 50%;
    transform: translate(-50%, -4px);
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: 1px solid var(--ec-border);
    background: linear-gradient(180deg, rgba(248, 251, 255, 0.96) 0%, var(--ec-surface) 100%);
    box-shadow: 0 10px 22px rgba(15, 23, 42, 0.14);
    color: var(--ec-danger);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    z-index: 2;
  }
  .mole-trigger.side-right:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-record-btn {
    left: calc(50% + ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }
  .mole-trigger.side-left:not(.task-running):not(.task-done):not(.task-error):not(.announce) .mole-record-btn {
    left: calc(50% - ${PILL_WIDTH - PILL_COMPACT_WIDTH}px);
  }
  .mole-record-btn svg {
    width: 14px;
    height: 14px;
  }
  .mole-record-btn:hover {
    transform: translate(-50%, -6px);
    box-shadow: 0 12px 24px rgba(215, 0, 21, 0.2);
    color: #d70015;
  }
  .mole-trigger.hovering .mole-record-btn,
  .mole-trigger:focus-within .mole-record-btn {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }
  .mole-trigger.dragging .mole-record-btn,
  .mole-trigger.recording .mole-record-btn,
  .mole-trigger.auditing .mole-record-btn,
  .mole-trigger.active .mole-record-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* 录制中状态 - footer 录制状态栏 */
  .mole-recorder-bar {
    display: none;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    background: rgba(215, 0, 21, 0.04);
    border-top: 1px solid rgba(215, 0, 21, 0.12);
    font-size: 12px;
    color: var(--ec-text-secondary, var(--ec-text-muted));
  }
  .mole-recorder-bar.visible { display: flex; }
  .mole-recorder-bar-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    animation: mole-breathe 1.4s ease-in-out infinite;
    flex-shrink: 0;
  }
  .mole-recorder-bar-info { flex: 1; min-width: 0; }
  .mole-recorder-bar-stop {
    padding: 4px 12px;
    border: 1px solid rgba(215, 0, 21, 0.2);
    border-radius: 6px;
    background: transparent;
    color: var(--ec-danger);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .mole-recorder-bar-stop:hover {
    background: rgba(215, 0, 21, 0.08);
  }

  /* 胶囊录制状态 */
  .mole-trigger.recording .mole-pill {
    border-color: rgba(215, 0, 21, 0.3);
  }
  .mole-trigger.recording .mole-pill::after {
    content: '';
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    animation: mole-breathe 1.4s ease-in-out infinite;
    opacity: 1;
    z-index: 2;
  }

  /* 胶囊审计状态（AI 生成工作流中） */
  .mole-trigger.auditing .mole-pill {
    border-color: rgba(0, 113, 227, 0.3);
  }
  .mole-trigger.auditing .mole-pill::after {
    content: '';
    position: absolute;
    top: 4px;
    right: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-primary-strong);
    animation: mole-breathe 1.4s ease-in-out infinite;
    opacity: 1;
    z-index: 2;
  }

`;

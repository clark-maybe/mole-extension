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
    overflow: visible;
    width: ${PILL_COMPACT_WIDTH}px;
    height: ${PILL_HEIGHT}px;
    padding: 0 12px;
    border-radius: 999px;
    border: none;
    background: #fff;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
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
                box-shadow 0.28s ease;
  }

  .mole-pill::before {
    content: "";
    position: absolute;
    inset: 0;
    background: none;
    pointer-events: none;
    z-index: 0;
  }

  .mole-pill::after {
    content: "";
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: none;
    opacity: 0;
    pointer-events: none;
    z-index: 0;
  }

  .mole-trigger.side-right .mole-pill {
    transform: translateX(${TUCK_OFFSET}px);
  }

  .mole-trigger.side-left .mole-pill {
    transform: translateX(-${TUCK_OFFSET}px);
    flex-direction: row-reverse;
    padding: 0 12px;
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

  .mole-trigger.announce .mole-pill,
  .mole-trigger.auditing .mole-pill {
    width: ${PILL_WIDTH}px;
    transform: translateX(0);
  }

  /* hover / active：略微滑出，露出完整 logo + 一点文字 */
  .mole-trigger.side-right.hovering:not(.announce):not(.auditing) .mole-pill,
  .mole-trigger.side-right.active:not(.announce):not(.auditing) .mole-pill {
    transform: translateX(${TUCK_OFFSET - 56}px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  }

  .mole-trigger.side-left.hovering:not(.announce):not(.auditing) .mole-pill,
  .mole-trigger.side-left.active:not(.announce):not(.auditing) .mole-pill {
    transform: translateX(-${TUCK_OFFSET - 56}px);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
  }

  .mole-trigger.hovering .mole-pill::after,
  .mole-trigger.active .mole-pill::after {
    opacity: 1;
  }

  .mole-trigger.dragging .mole-pill {
    width: ${PILL_HEIGHT}px;
    padding: 0;
    gap: 0;
    justify-content: center;
    transform: translateX(0);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.13);
    /* 保留 transition 实现胶囊→圆球的变形动画 */
  }

  .mole-trigger.dragging .mole-pill-info {
    opacity: 0;
    width: 0;
    flex: 0;
    margin: 0;
    padding: 0;
    overflow: hidden;
    transition: opacity 0.12s ease;
  }

  .mole-trigger.dragging .mole-bg-task-badge {
    opacity: 0;
    transition: opacity 0.12s ease;
  }

  .mole-trigger.dragging .mole-close-btn {
    opacity: 0 !important;
    pointer-events: none !important;
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
    box-shadow: 0 0 20px rgba(22, 119, 255, 0.5), 0 0 8px rgba(124, 58, 237, 0.3);
    animation: mole-pill-glow 2s ease-in-out infinite;
  }

  @keyframes mole-pill-glow {
    0%, 100% {
      box-shadow: 0 0 18px rgba(22, 119, 255, 0.45), 0 0 6px rgba(124, 58, 237, 0.25);
    }
    50% {
      box-shadow: 0 0 36px rgba(22, 119, 255, 0.7), 0 0 14px rgba(124, 58, 237, 0.45);
    }
  }

  .mole-trigger.task-running .mole-pill-meta {
    color: var(--ec-primary-strong);
  }

  .mole-trigger.task-done .mole-pill {
    box-shadow: 0 0 10px rgba(18, 183, 106, 0.3), 0 2px 8px rgba(0, 0, 0, 0.06);
  }

  .mole-trigger.task-error .mole-pill {
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.3), 0 2px 8px rgba(0, 0, 0, 0.06);
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

  .mole-trigger.side-right:not(.announce):not(.auditing)::after {
    left: calc(50% + ${TUCK_OFFSET}px);
    transition: left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-right.hovering:not(.announce):not(.auditing)::after {
    left: calc(50% + ${TUCK_OFFSET - 56}px);
  }

  .mole-trigger.side-left:not(.announce):not(.auditing)::after {
    left: calc(50% - ${TUCK_OFFSET}px);
    transition: left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-left.hovering:not(.announce):not(.auditing)::after {
    left: calc(50% - ${TUCK_OFFSET - 56}px);
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

  .mole-trigger.side-right:not(.announce):not(.auditing) .mole-settings-btn {
    left: calc(50% + ${TUCK_OFFSET}px);
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-right.hovering:not(.announce):not(.auditing) .mole-settings-btn {
    left: calc(50% + ${TUCK_OFFSET - 56}px);
  }

  .mole-trigger.side-left:not(.announce):not(.auditing) .mole-settings-btn {
    left: calc(50% - ${TUCK_OFFSET}px);
    transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-left.hovering:not(.announce):not(.auditing) .mole-settings-btn {
    left: calc(50% - ${TUCK_OFFSET - 56}px);
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

  /* ---- 悬浮球迷你操作卡片 ---- */
  .mole-pill-action-card {
    position: absolute;
    bottom: calc(100% + 6px);
    right: 10%;
    transform: translateY(4px) scale(0.96);
    width: max-content;
    max-width: 280px;
    min-width: 160px;
    background: #fff;
    border: 1px solid var(--ec-border);
    border-radius: 12px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.14);
    padding: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.22s ease;
    z-index: 10;
  }

  .mole-pill-action-card.visible {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0px) scale(1);
  }

  /* 左侧时卡片左对齐 */
  .mole-trigger.side-left .mole-pill-action-card {
    right: auto;
    left: 0;
  }

  .pac-body {
    padding: 10px 12px;
  }

  .pac-msg {
    font-size: 12px;
    color: var(--ec-text);
    line-height: 1.4;
    margin-bottom: 8px;
    word-break: break-word;
  }

  .pac-actions {
    display: flex;
    gap: 6px;
  }

  .pac-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }

  .pac-btn {
    flex: 1;
    min-width: 0;
    padding: 5px 10px;
    border: 1px solid var(--ec-border);
    border-radius: 8px;
    font-size: 12px;
    cursor: pointer;
    background: var(--ec-surface);
    color: var(--ec-text);
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .pac-btn:hover {
    background: var(--ec-surface-strong);
  }

  .pac-approve {
    background: var(--ec-primary);
    color: #fff;
    border-color: var(--ec-primary);
  }

  .pac-approve:hover {
    background: var(--ec-primary-strong);
    border-color: var(--ec-primary-strong);
  }

  .pac-reject {
    background: var(--ec-surface);
    color: var(--ec-danger);
    border-color: var(--ec-danger);
  }

  .pac-reject:hover {
    background: rgba(215, 0, 21, 0.06);
  }

  .pac-option {
    flex: none;
    background: var(--ec-surface);
    border-color: var(--ec-border);
    color: var(--ec-primary);
  }

  .pac-option:hover {
    background: rgba(0, 113, 227, 0.06);
    border-color: var(--ec-primary);
  }

  .pac-input-row {
    display: flex;
    gap: 4px;
    margin-top: 6px;
  }

  .pac-text {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--ec-border);
    border-radius: 8px;
    font-size: 12px;
    background: var(--ec-surface);
    color: var(--ec-text);
    outline: none;
  }

  .pac-text:focus {
    border-color: var(--ec-primary);
    box-shadow: 0 0 0 2px rgba(0, 113, 227, 0.12);
  }

  .pac-send {
    flex: none;
    width: auto;
    padding: 5px 10px;
    background: var(--ec-primary);
    color: #fff;
    border-color: var(--ec-primary);
  }

  .pac-send:hover {
    background: var(--ec-primary-strong);
    border-color: var(--ec-primary-strong);
  }

  /* 面板展开时隐藏迷你卡片（避免重复操作） */
  .mole-trigger.active .mole-pill-action-card {
    opacity: 0;
    pointer-events: none;
  }

  .mole-trigger.dragging .mole-pill-action-card {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭按钮（角标式，内嵌于 pill） ---- */
  .mole-close-btn {
    position: absolute;
    top: -5px;
    left: -5px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 255, 255, 0.4);
    background: rgba(0, 0, 0, 0.28);
    color: #fff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    cursor: pointer;
    transition: opacity 0.18s ease, transform 0.15s ease, background 0.15s ease;
    z-index: 3;
  }

  /* 左侧时角标在右上角 */
  .mole-trigger.side-left .mole-close-btn {
    left: auto;
    right: -5px;
  }

  .mole-close-btn svg {
    width: 9px;
    height: 9px;
    stroke: currentColor;
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .mole-close-btn:hover {
    background: rgba(0, 0, 0, 0.45);
    transform: scale(1.12);
  }

  .mole-close-btn:focus-visible {
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.4);
  }

  .mole-trigger.hovering .mole-close-btn,
  .mole-trigger:focus-within .mole-close-btn {
    opacity: 1;
    pointer-events: auto;
  }

  .mole-trigger.active .mole-close-btn {
    opacity: 0;
    pointer-events: none;
  }

  /* ---- 关闭菜单 ---- */
  .mole-close-menu {
    display: none;
    position: absolute;
    bottom: calc(100% + 6px);
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

  .mole-close-menu-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 5px;
    background: rgba(15, 23, 42, 0.06);
    font-size: 10px;
    margin-right: 8px;
    flex-shrink: 0;
  }

  .mole-close-menu-divider {
    height: 1px;
    background: var(--ec-border-soft);
    margin: 4px 8px;
  }

  .mole-close-menu-domain {
    display: flex !important;
    align-items: center;
    gap: 8px;
  }

  .mole-close-menu-favicon {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .mole-close-menu-domain-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .mole-close-menu-domain-label {
    font-size: 13px;
    line-height: 1.3;
  }

  .mole-close-menu-domain-host {
    font-size: 11px;
    color: var(--ec-text-muted);
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 180px;
  }

  .mole-close-menu-item:hover .mole-close-menu-domain-host {
    color: var(--ec-primary);
  }

  .mole-close-menu-item:hover .mole-close-menu-icon {
    background: rgba(22, 119, 255, 0.12);
    color: var(--ec-primary);
  }

  .mole-trigger.side-right.booting .mole-pill {
    animation: mole-pill-enter-right 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-left.booting .mole-pill {
    animation: mole-pill-enter-left 560ms cubic-bezier(0.22, 1, 0.36, 1);
  }

  .mole-trigger.side-right.snapping:not(.task-running):not(.announce):not(.auditing) .mole-pill {
    animation: mole-pill-snap-right 480ms cubic-bezier(0.2, 1.18, 0.32, 1);
  }

  .mole-trigger.side-left.snapping:not(.task-running):not(.announce):not(.auditing) .mole-pill {
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
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(28px) saturate(155%);
    -webkit-backdrop-filter: blur(28px) saturate(155%);
    border: 1px solid rgba(219, 227, 238, 0.6);
    border-radius: 30px;
    box-shadow: 0 16px 48px rgba(15, 23, 42, 0.12), 0 4px 16px rgba(15, 23, 42, 0.06);
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

  /* ---- 流光边框 wrapper ---- */
  .mole-searchbox-wrap {
    position: relative;
    border-radius: 32px;
    overflow: hidden;
    padding: 2px;
    background: transparent;
    transition: box-shadow 0.4s ease;
  }

  .mole-searchbox-wrap::before {
    content: '';
    position: absolute;
    /* 始终保持正方形，以宽度为基准，确保任何高度下旋转都均匀 */
    left: 50%;
    top: 50%;
    width: 150%;
    aspect-ratio: 1;
    transform: translate(-50%, -50%);
    background: conic-gradient(
      from 0deg,
      transparent 0deg,
      transparent 80deg,
      rgba(22, 119, 255, 0.35) 140deg,
      rgba(124, 58, 237, 0.25) 180deg,
      rgba(22, 119, 255, 0.35) 220deg,
      transparent 280deg,
      transparent 360deg
    );
    opacity: 0;
    transition: opacity 0.4s ease;
    pointer-events: none;
    z-index: 0;
  }

  .mole-searchbox-wrap.state-running::before {
    opacity: 1;
    animation: mole-glow-spin 2.8s linear infinite;
  }

  .mole-searchbox-wrap.state-running {
    box-shadow: 0 0 20px -6px rgba(22, 119, 255, 0.1);
  }

  /* searchbox 需要在伪元素之上，自带背景遮住中间区域 */
  .mole-searchbox-wrap > .mole-searchbox {
    position: relative;
    z-index: 1;
  }

  @keyframes mole-glow-spin {
    to { transform: translate(-50%, -50%) rotate(360deg); }
  }

  .mole-searchbox.state-running {
    border-color: transparent;
  }

  .mole-searchbox.state-done {
    border-color: rgba(18, 183, 106, 0.45);
  }

  .mole-searchbox.state-error {
    border-color: rgba(239, 68, 68, 0.18);
  }

  /* 输入行 */
  .mole-input-row {
    display: flex;
    align-items: center;
    margin: 0;
    padding: 18px 20px;
    gap: 14px;
    border-radius: 0;
    border: none;
    background: transparent;
    transition: background-color 0.2s ease;
  }

  .mole-input-row:focus-within {
    background: rgba(22, 119, 255, 0.02);
  }

  .mole-input-icon {
    width: 26px;
    height: 26px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .mole-input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 16px;
    line-height: 1.5;
    color: var(--ec-text);
    caret-color: var(--ec-primary);
  }

  .mole-input::placeholder {
    color: var(--ec-text-muted);
    opacity: 0.78;
  }

  .mole-input:disabled {
    opacity: 1;
    cursor: default;
  }

  /* 运行态扫光 placeholder */
  .state-running .mole-input::placeholder {
    background: linear-gradient(
      90deg,
      var(--ec-text-muted) 0%,
      var(--ec-text-muted) 35%,
      rgba(22, 119, 255, 0.85) 50%,
      var(--ec-text-muted) 65%,
      var(--ec-text-muted) 100%
    );
    background-size: 250% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: mole-shimmer-text 2.4s ease-in-out infinite;
    opacity: 1;
  }

  @keyframes mole-shimmer-text {
    0% { background-position: 100% center; }
    100% { background-position: -50% center; }
  }

  .mole-input-hint {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--ec-text-muted);
    padding: 4px 8px;
    border: none;
    background: rgba(241, 244, 248, 0.8);
    border-radius: 6px;
    line-height: 1;
  }

  /* 分割线 */
  .mole-divider {
    height: 1px;
    margin: 0 18px;
  }

  /* ---- 结果展示区 ---- */
  .mole-result {
    display: none;
    max-height: 50vh;
    overflow-y: auto;
    padding: 12px 18px 16px;
    font-size: 15px;
    line-height: 1.72;
    letter-spacing: 0.01em;
    color: var(--ec-text);
    background: transparent;
  }

  .mole-result.visible {
    display: block;
  }

  /* 状态指示 */
  .mole-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
    padding: 9px 12px;
    color: var(--ec-text);
    font-size: 12px;
    border-radius: 10px;
    border: none;
    background: rgba(248, 250, 252, 0.88);
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
    margin: 6px 0;
    padding: 9px 12px;
    color: var(--ec-primary-strong);
    font-size: 12px;
    border-radius: 10px;
    border: none;
    background: rgba(22, 119, 255, 0.06);
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
    margin: 8px 0;
    border: none;
    border-radius: 10px;
    background: rgba(248, 250, 252, 0.72);
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
    margin: 4px 0;
    border-radius: 8px;
    border: none;
    background: rgba(248, 250, 253, 0.6);
    overflow: hidden;
    margin-bottom: 16px;
  }

  .mole-agent-state-title {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 6px 10px;
    font-size: 11px;
    color: var(--ec-text-muted);
    background: transparent;
    font-weight: 500;
    user-select: none;
    cursor: pointer;
    transition: background 0.18s ease;
  }

  .mole-agent-state-panel.is-live .mole-agent-state-title {
    background: rgba(22, 119, 255, 0.02);
  }

  .mole-agent-state-title-main {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    font-size: 10px;
    letter-spacing: 0.02em;
    color: var(--ec-text-muted);
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
    font-size: 11px;
    line-height: 1.45;
    color: var(--ec-text-soft);
    font-weight: 500;
    padding: 5px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.55);
    border: none;
  }

  .mole-agent-state-panel.is-live .mole-agent-state-summary::before {
    content: '';
    display: inline-block;
    width: 5px;
    height: 5px;
    margin-right: 5px;
    border-radius: 999px;
    background: rgba(0, 113, 227, 0.55);
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
    background: rgba(0, 113, 227, 0.04);
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
    gap: 6px;
    padding: 0 10px 10px;
    background: transparent;
  }

  .mole-agent-state-panel.open .mole-task-runtime-board {
    display: grid;
  }

  /* ── Todo 进度视图 ── */
  .mole-todo-board {
    display: none;
    padding: 0 14px 10px;
  }

  .mole-agent-state-panel.open .mole-todo-board:not(:empty) {
    display: block;
  }

  .mole-todo-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .mole-todo-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--ec-primary-strong);
  }

  .mole-todo-stats {
    font-size: 11px;
    font-weight: 600;
    color: var(--ec-text-muted);
  }

  .mole-todo-progress-bar {
    height: 3px;
    border-radius: 2px;
    background: rgba(22, 119, 255, 0.1);
    margin-bottom: 8px;
    overflow: hidden;
  }

  .mole-todo-progress-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--ec-primary);
    transition: width 0.3s ease;
  }

  .mole-todo-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .mole-todo-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--ec-text);
    transition: background 0.15s ease;
  }

  .mole-todo-item.active {
    background: rgba(22, 119, 255, 0.06);
    font-weight: 600;
  }

  .mole-todo-item.done {
    color: var(--ec-text-muted);
  }

  .mole-todo-item.done .mole-todo-text {
    text-decoration: line-through;
    text-decoration-color: rgba(102, 112, 133, 0.4);
  }

  .mole-todo-item.pending {
    color: var(--ec-text-muted);
  }

  .mole-todo-icon {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    font-weight: 700;
    line-height: 1.5;
  }

  .mole-todo-item.done .mole-todo-icon {
    color: var(--ec-success);
  }

  .mole-todo-item.active .mole-todo-icon {
    color: var(--ec-primary);
  }

  .mole-todo-item.pending .mole-todo-icon {
    color: rgba(102, 112, 133, 0.4);
  }

  .mole-todo-text {
    min-width: 0;
    flex: 1;
    word-break: break-word;
  }

  .mole-runtime-now {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.5);
    border: none;
    color: var(--ec-text-soft);
    font-size: 11px;
    line-height: 1.45;
    font-weight: 500;
  }

  .mole-runtime-now-text {
    min-width: 0;
    flex: 1;
  }

  .mole-inline-loader {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .mole-inline-loader span {
    width: 3px;
    height: 3px;
    border-radius: 999px;
    background: rgba(22, 119, 255, 0.45);
    animation: mole-loader-fade 1.2s ease-in-out infinite;
  }

  .mole-inline-loader span:nth-child(2) {
    animation-delay: 0.16s;
  }

  .mole-inline-loader span:nth-child(3) {
    animation-delay: 0.32s;
  }

  .mole-task-runtime-step-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(22, 119, 255, 0.18);
    flex-shrink: 0;
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
    0% { transform: translateX(0); }
    60% { transform: translateX(${TUCK_OFFSET + 10}px) scale(0.98); }
    100% { transform: translateX(${TUCK_OFFSET}px) scale(1); }
  }

  @keyframes mole-pill-snap-left {
    0% { transform: translateX(0); }
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
    background: rgba(22, 119, 255, 0.06);
    border: none;
    border-radius: 8px;
    font-size: 12px;
    color: var(--ec-primary-strong);
  }

  .mole-func-icon {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  /* ---- 函数调用折叠区 ---- */
  .mole-calls-group {
    margin: 2px 0 0;
  }

  .mole-calls-summary {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    background: rgba(22, 119, 255, 0.03);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    color: var(--ec-text-muted);
    user-select: none;
    transition: background 0.15s ease;
  }

  .mole-calls-summary:hover {
    background: rgba(22, 119, 255, 0.06);
  }

  .mole-calls-summary .arrow {
    display: inline-block;
    font-size: 9px;
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
    padding: 3px 0 0;
  }

  .mole-calls-detail.open {
    display: grid;
    gap: 2px;
  }

  .mole-calls-detail .mole-call-item {
    margin: 0;
  }

  .mole-call-header {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    border-radius: 5px;
    cursor: default;
    font-size: 11px;
    color: var(--ec-text-soft);
    user-select: none;
    border: none;
    background: rgba(255, 255, 255, 0.45);
  }

  .mole-call-item.tone-status .mole-call-header {
    background: rgba(22, 119, 255, 0.05);
  }

  .mole-call-item.tone-action .mole-call-header {
    background: rgba(22, 119, 255, 0.06);
    animation: mole-call-bg-pulse 1.8s ease-in-out infinite;
  }

  .mole-call-item.tone-action .mole-task-runtime-step-dot {
    background: rgba(22, 119, 255, 0.7);
    box-shadow: 0 0 0 0 rgba(22, 119, 255, 0.4);
    animation: mole-dot-pulse 1.8s ease-in-out infinite;
  }

  .mole-call-item.tone-action .mole-call-status.running {
    color: var(--ec-primary);
    animation: mole-loader-fade 1.2s ease-in-out infinite;
  }

  @keyframes mole-call-bg-pulse {
    0%, 100% { background: rgba(22, 119, 255, 0.04); }
    50% { background: rgba(22, 119, 255, 0.1); }
  }

  @keyframes mole-dot-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(22, 119, 255, 0.35);
      transform: scale(1);
    }
    50% {
      box-shadow: 0 0 0 4px rgba(22, 119, 255, 0);
      transform: scale(1.15);
    }
  }

  .mole-call-item.tone-issue .mole-call-header {
    background: rgba(245, 158, 11, 0.06);
  }

  .mole-call-item.tone-done .mole-call-header {
    background: rgba(18, 183, 106, 0.05);
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
    color: rgba(18, 183, 106, 0.6);
    flex-shrink: 0;
  }
  .mole-call-status.running {
    color: var(--ec-text-muted);
    letter-spacing: 1px;
  }

  .mole-call-main {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .mole-call-title {
    line-height: 1.4;
    font-weight: 600;
    color: var(--ec-text);
    flex-shrink: 0;
    font-size: 10px;
  }

  .mole-call-intent {
    font-size: 10px;
    line-height: 1.4;
    color: var(--ec-text-muted);
    font-weight: 400;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
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
    background: rgba(248, 250, 253, 0.72);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.15s ease;
    text-decoration: none;
    color: inherit;
  }

  .mole-rec-card:hover {
    background: rgba(240, 247, 255, 0.88);
    transform: translateY(-1px);
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
    margin: 10px 0 6px;
    padding: 9px 14px;
    background: rgba(22, 119, 255, 0.08);
    border: none;
    border-radius: 14px 14px 6px 14px;
    font-size: 13px;
    color: var(--ec-text);
    max-width: 85%;
    margin-left: auto;
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
    border: none;
    border-radius: 10px;
    background: rgba(248, 250, 253, 0.72);
    transition: background 0.15s ease, transform 0.15s ease;
    cursor: pointer;
  }

  .mole-result-card:hover {
    background: rgba(240, 247, 255, 0.88);
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
    margin: 4px 0;
    padding: 2px 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 14px;
    line-height: 1.85;
    color: var(--ec-text);
  }

  .mole-answer p {
    margin: 0;
  }

  .mole-answer p + p {
    margin-top: 14px;
  }

  /* 流式增量淡入：仅对新追加的块级元素生效 */
  .mole-answer-new {
    animation: mole-answer-fadein 0.35s ease-out;
  }
  @keyframes mole-answer-fadein {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .mole-answer h3, .mole-answer h4, .mole-answer h5 {
    font-weight: 650;
    color: #111112;
    letter-spacing: -0.01em;
  }

  .mole-answer h3 {
    font-size: 16px;
    margin: 20px 0 8px;
  }
  .mole-answer h4 {
    font-size: 15px;
    margin: 16px 0 6px;
  }
  .mole-answer h5 {
    font-size: 14px;
    margin: 14px 0 4px;
  }

  .mole-answer ul, .mole-answer ol {
    padding-left: 22px;
    margin: 10px 0;
  }

  .mole-answer li {
    margin: 5px 0;
  }

  .mole-answer li + li {
    margin-top: 6px;
  }

  .mole-answer code {
    background: rgba(109, 40, 217, 0.07);
    color: #6d28d9;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 5px;
    font-size: 12.5px;
    font-family: "SF Mono", Monaco, Consolas, monospace;
  }

  .mole-answer pre {
    margin: 12px 0 4px;
    padding: 14px 16px;
    border-radius: 10px;
    border: 1px solid rgba(15, 23, 42, 0.08);
    background: rgba(15, 23, 42, 0.92);
    color: #e8ecf2;
    font-family: "SF Mono", Monaco, Consolas, monospace;
    font-size: 12.5px;
    line-height: 1.6;
    overflow-x: auto;
    white-space: pre;
  }

  .mole-answer pre code {
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    font-size: inherit;
  }

  .mole-answer blockquote {
    margin: 12px 0 4px;
    padding: 10px 14px;
    border-left: 3px solid rgba(109, 40, 217, 0.35);
    border-radius: 0 10px 10px 0;
    background: rgba(109, 40, 217, 0.04);
    color: #3b4963;
  }

  .mole-answer img.mole-md-img {
    max-width: 70%;
    max-height: 280px;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 8px;
    margin: 8px 0;
    display: block;
  }

  .mole-link-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px 3px 6px;
    margin: 2px 0;
    border-radius: 6px;
    background: rgba(109, 40, 217, 0.06);
    border: 1px solid rgba(109, 40, 217, 0.12);
    color: #5b21b6 !important;
    text-decoration: none !important;
    font-size: 13px;
    line-height: 1.5;
    max-width: 100%;
    overflow: hidden;
    transition: background 0.15s, border-color 0.15s;
    word-break: break-all;
  }
  .mole-link-chip:hover {
    background: rgba(109, 40, 217, 0.12);
    border-color: rgba(109, 40, 217, 0.25);
  }
  .mole-link-favicon {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    border-radius: 2px;
  }
  .mole-link-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mole-answer hr {
    border: none;
    height: 1px;
    background: rgba(219, 227, 238, 0.5);
    margin: 18px 0;
  }

  .mole-answer table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }

  .mole-answer th, .mole-answer td {
    padding: 7px 12px;
    border: 1px solid rgba(219, 227, 238, 0.7);
    text-align: left;
  }

  .mole-answer th {
    background: rgba(109, 40, 217, 0.05);
    font-weight: 600;
    color: #111112;
  }

  .mole-answer tr:nth-child(even) td {
    background: rgba(248, 250, 253, 0.4);
  }

  .mole-answer strong {
    font-weight: 650;
    color: var(--ec-text);
  }

  .mole-answer a {
    color: #6d28d9;
    text-decoration: underline;
    text-decoration-color: rgba(109, 40, 217, 0.3);
    text-underline-offset: 3px;
    transition: text-decoration-color 0.15s;
  }
  .mole-answer a:hover {
    text-decoration-color: rgba(109, 40, 217, 0.7);
  }
  .mole-answer del {
    text-decoration: line-through;
    opacity: 0.55;
  }
  .mole-answer em {
    font-style: italic;
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
    background: rgba(248, 250, 253, 0.72);
    border-radius: 10px;
    border: none;
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
    background: rgba(248, 250, 253, 0.72);
    border-radius: 10px;
    border: none;
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
    background: rgba(255, 255, 255, 0.6);
    border-radius: 8px;
    border: none;
  }
  .mole-verify-item.fail {
    background: rgba(255, 240, 240, 0.72);
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
    margin: 10px 18px;
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
    padding: 10px 18px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--ec-text-muted);
    font-size: 12px;
    background: transparent;
    border-top: 1px solid rgba(219, 227, 238, 0.4);
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
    background: rgba(248, 250, 252, 0.8);
    border: none;
    border-radius: 999px;
    padding: 4px 8px;
    white-space: nowrap;
  }

  .mole-footer-time:empty {
    display: none;
  }

  .mole-searchbox.state-running .mole-footer-time {
    background: rgba(22, 119, 255, 0.08);
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
    background: rgba(18, 183, 106, 0.08);
    color: var(--ec-success);
  }

  .mole-searchbox.state-error .mole-footer-time {
    background: rgba(239, 68, 68, 0.08);
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
    margin: 10px 18px;
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
    background: rgba(241, 244, 248, 0.8);
    border: none;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    font-size: 11px;
    line-height: 1.4;
    color: #667085;
  }

  .mole-workflow-chip:hover {
    background: rgba(22, 119, 255, 0.08);
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

  /* 录制按钮容器（hover 时出现在悬浮球上方） */
  .mole-record-wrap {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translate(-50%, 4px);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s ease, transform 0.2s ease;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .mole-trigger.side-right:not(.announce):not(.auditing) .mole-record-wrap {
    left: calc(50% + ${TUCK_OFFSET}px);
    transition: opacity 0.2s ease, transform 0.2s ease, left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-right.hovering:not(.announce):not(.auditing) .mole-record-wrap {
    left: calc(50% + ${TUCK_OFFSET - 56}px);
  }
  .mole-trigger.side-left:not(.announce):not(.auditing) .mole-record-wrap {
    left: calc(50% - ${TUCK_OFFSET}px);
    transition: opacity 0.2s ease, transform 0.2s ease, left 0.36s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .mole-trigger.side-left.hovering:not(.announce):not(.auditing) .mole-record-wrap {
    left: calc(50% - ${TUCK_OFFSET - 56}px);
  }
  .mole-trigger.hovering .mole-record-wrap,
  .mole-trigger:focus-within .mole-record-wrap {
    opacity: 1;
    pointer-events: auto;
    transform: translate(-50%, 0);
  }
  .mole-trigger.dragging .mole-record-wrap,
  .mole-trigger.recording .mole-record-wrap,
  .mole-trigger.auditing .mole-record-wrap,
  .mole-trigger.active .mole-record-wrap {
    opacity: 0;
    pointer-events: none;
  }

  /* 录制按钮 */
  .mole-record-btn {
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
    cursor: pointer;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    position: relative;
  }
  .mole-record-btn svg {
    width: 14px;
    height: 14px;
  }
  .mole-record-btn:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 24px rgba(215, 0, 21, 0.2);
    color: #d70015;
  }

  /* 录制按钮 tooltip */
  .mole-record-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #fff;
    color: #333;
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s ease;
  }
  .mole-record-tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: #fff;
  }
  .mole-record-btn:hover + .mole-record-tooltip {
    opacity: 1;
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

  /* 审计中状态 */
  .mole-recorder-bar.auditing {
    background: var(--ec-primary-soft);
    border-color: rgba(22, 119, 255, 0.15);
  }
  .mole-recorder-bar-dot.auditing {
    background: var(--ec-primary);
    animation: mole-rec-pulse 1.2s ease-in-out infinite;
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

  /* ===== 录制确认 Modal ===== */
  .mole-record-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2147483647;
    pointer-events: auto;
    backdrop-filter: blur(2px);
  }

  .mole-record-modal {
    background: var(--ec-surface-strong);
    border: 1px solid var(--ec-border);
    border-radius: 16px;
    padding: 28px 32px 24px;
    width: 420px;
    max-width: 90vw;
    box-shadow: var(--ec-shadow);
  }

  .mole-record-modal-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--ec-text);
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .mole-record-modal-title::before {
    content: '';
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ec-danger);
    animation: mole-rec-pulse 1.5s ease-in-out infinite;
  }

  .mole-record-modal-hints {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 24px;
  }

  .mole-record-modal-hint {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 14px;
    line-height: 1.6;
    color: var(--ec-text-muted);
  }

  .mole-record-modal-hint-icon {
    flex-shrink: 0;
    font-size: 16px;
    line-height: 1.6;
  }

  .mole-record-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }

  .mole-record-modal-btn {
    padding: 8px 22px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    outline: none;
  }

  .mole-record-modal-btn.cancel {
    background: transparent;
    border: 1px solid var(--ec-border);
    color: var(--ec-text-muted);
  }
  .mole-record-modal-btn.cancel:hover {
    background: var(--ec-surface-soft);
    border-color: var(--ec-border-soft);
  }

  .mole-record-modal-btn.confirm {
    background: var(--ec-danger);
    color: #fff;
  }
  .mole-record-modal-btn.confirm:hover {
    background: #c0241c;
  }

  @keyframes mole-rec-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

`;

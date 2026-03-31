/**
 * 拖拽 Hook — 胶囊球拖拽 + 吸附逻辑
 */
import { useRef, useCallback } from 'react';
import { DRAG_THRESHOLD, PILL_WIDTH, PILL_HEIGHT } from '../constants';
import type { Side } from '../constants';

/** 获取可视区域宽度（排除滚动条） */
const getViewportWidth = (): number => document.documentElement.clientWidth;

const getTriggerX = (side: Side): number => {
  if (side === 'left') {
    return -(PILL_WIDTH + 10 - PILL_WIDTH) / 2;
  }
  return getViewportWidth() - PILL_WIDTH - (10 / 2);
};

const TRIGGER_CENTER = (PILL_WIDTH + 10) / 2;

interface UseDragOptions {
  onDragStart?: () => void;
  onDragEnd?: (side: Side, y: number) => void;
  onClick?: () => void;
  getCurrentY: () => number;
}

/**
 * 返回一个 onMouseDown handler 绑定到 pill 元素上
 * 内部管理 mousemove/mouseup 的注册和移除
 * 拖拽时返回 triggerRef 供外部获取 trigger DOM 元素
 */
export const useDrag = (options: UseDragOptions) => {
  const isDragging = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startTrigger = useRef({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const trigger = triggerRef.current;
    if (!trigger) return;

    startMouse.current = { x: e.clientX, y: e.clientY };
    startTrigger.current = { x: trigger.offsetLeft, y: options.getCurrentY() };
    isDragging.current = false;

    trigger.classList.remove('snapping');

    const onMouseMove = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      const dx = ev.clientX - startMouse.current.x;
      const dy = ev.clientY - startMouse.current.y;

      if (!isDragging.current && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
        isDragging.current = true;
        options.onDragStart?.();
        trigger.classList.add('dragging');
        trigger.classList.remove('side-left', 'side-right', 'hovering');
      }

      if (isDragging.current) {
        const newX = ev.clientX - TRIGGER_CENTER;
        const newY = ev.clientY - (PILL_HEIGHT + 10) / 2;
        trigger.style.left = `${newX}px`;
        trigger.style.top = `${newY}px`;
      }
    };

    const onMouseUp = (ev: MouseEvent) => {
      ev.preventDefault();
      ev.stopPropagation();

      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);

      trigger.classList.remove('dragging');

      if (isDragging.current) {
        const newSide: Side = ev.clientX < getViewportWidth() / 2 ? 'left' : 'right';
        const clampedY = Math.max(12, Math.min(ev.clientY - PILL_HEIGHT / 2, window.innerHeight - PILL_HEIGHT - 12));

        trigger.classList.add(`side-${newSide}`);
        trigger.classList.add('snapping');
        const x = getTriggerX(newSide);
        trigger.style.left = `${x}px`;
        trigger.style.top = `${clampedY}px`;

        options.onDragEnd?.(newSide, clampedY);

        setTimeout(() => {
          trigger.classList.remove('snapping');
        }, 520);
      } else {
        options.onClick?.();
      }

      isDragging.current = false;
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }, [options]);

  return { triggerRef, onMouseDown, isDragging };
};

/**
 * 后台任务面板组件
 * 显示定时器和常驻任务列表（匹配原始 float-ball.ts 的 DOM 结构和 CSS class）
 */

import React, { useEffect, useCallback, useState } from 'react';
import Channel from '../../../lib/channel';
import { useMole } from '../context/useMole';
import { FUNCTION_ICONS } from '../icons';
import { escapeHtml } from '../markdown';
import { formatClock, formatInterval } from '../text-utils';

export const BgTasksPanel: React.FC = () => {
  const { state, dispatch } = useMole();
  const { bgTasksData } = state;
  const [isOpen, setIsOpen] = useState(false);

  // 查询后台任务
  const queryBgTasks = useCallback(() => {
    Channel.send('__bg_tasks_query', {}, (data: any) => {
      if (data && typeof data === 'object') {
        dispatch({
          type: 'SET_BG_TASKS',
          payload: {
            timers: Array.isArray(data.timers) ? data.timers : [],
            residentJobs: Array.isArray(data.residentJobs) ? data.residentJobs : [],
          },
        });
      }
    });
  }, [dispatch]);

  // 初始加载 + 监听变化
  useEffect(() => {
    queryBgTasks();
    const handler = () => queryBgTasks();
    Channel.on('__bg_tasks_changed', handler);
    return () => Channel.off('__bg_tasks_changed', handler);
  }, [queryBgTasks]);

  // 关闭任务
  const handleClose = useCallback((kind: string, id: string) => {
    Channel.send('__bg_task_close', { kind, id }, (resp: any) => {
      if (resp?.success !== false) {
        queryBgTasks();
      }
    });
  }, [queryBgTasks]);

  if (!bgTasksData) return null;
  const { timers, residentJobs } = bgTasksData;
  const count = (timers?.length || 0) + (residentJobs?.length || 0);
  if (count === 0) return null;

  return (
    <div className={`mole-bg-tasks-panel visible${isOpen ? ' open' : ''}`}>
      {/* 头部 */}
      <div className="mole-bg-tasks-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="mole-bg-tasks-title">后台任务</span>
        <span className="mole-bg-tasks-count">{count}</span>
        <span className="mole-bg-tasks-toggle">▶</span>
      </div>

      {/* 列表 */}
      <div className="mole-bg-tasks-list">
        {/* 定时器任务 */}
        {timers?.map((t: any) => {
          const icon = FUNCTION_ICONS['timer'] || '';
          const displayName = t.name || String(t.action || '').slice(0, 40);
          let meta = '';
          if (t.type === 'schedule' && t.scheduleRule) {
            const rule = t.scheduleRule;
            if (rule.startsWith('daily:')) {
              meta = `每天 ${rule.slice(6)}`;
            } else if (rule.startsWith('weekly:')) {
              const parts = rule.slice(7).split(':');
              const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
              meta = `每${dayNames[parseInt(parts[0])]} ${parts[1]}:${parts[2]}`;
            }
            if (t.currentCount) meta += ` · 已执行 ${t.currentCount} 次`;
            if (t.nextRunAt) meta += ` · 下次 ${formatClock(t.nextRunAt)}`;
          } else if (t.type === 'timeout') {
            meta = `延时 · 将在 ${formatClock(t.nextRunAt)} 执行`;
          } else {
            meta = `周期 · 已执行 ${t.currentCount || 0} 次`;
            if (t.nextRunAt) meta += ` · 下次 ${formatClock(t.nextRunAt)}`;
          }

          return (
            <div key={`timer-${t.id}`} className="mole-bg-task-item" data-kind="timer" data-id={t.id}>
              <span className="mole-bg-task-icon">
                {icon && <img src={icon} alt="" />}
              </span>
              <div className="mole-bg-task-info">
                <span className="mole-bg-task-name" title={String(t.action || '')}>{displayName}</span>
                <span className="mole-bg-task-meta">{meta}</span>
              </div>
              <button
                className="mole-bg-task-close"
                type="button"
                title="关闭"
                onClick={(e) => { e.stopPropagation(); handleClose('timer', String(t.id)); }}
              >
                ×
              </button>
            </div>
          );
        })}

        {/* 常驻任务 */}
        {residentJobs?.map((j: any) => {
          const icon = FUNCTION_ICONS['resident_runtime'] || '';
          let meta = `常驻 · 间隔 ${formatInterval(j.intervalMs || 0)}`;
          if (j.lastSuccess === true) meta += ' · 上次成功';
          else if (j.lastSuccess === false) meta += ' · 上次失败';

          return (
            <div key={`resident-${j.id}`} className="mole-bg-task-item" data-kind="resident" data-id={j.id}>
              <span className="mole-bg-task-icon">
                {icon && <img src={icon} alt="" />}
              </span>
              <div className="mole-bg-task-info">
                <span className="mole-bg-task-name">{String(j.name || '')}</span>
                <span className="mole-bg-task-meta">{meta}</span>
              </div>
              <button
                className="mole-bg-task-close"
                type="button"
                title="关闭"
                onClick={(e) => { e.stopPropagation(); handleClose('resident', String(j.id)); }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

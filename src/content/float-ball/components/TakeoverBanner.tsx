/**
 * 标签页接管横幅组件
 * 当 AI 接管当前标签页时显示提示横幅
 */

import React, { useEffect } from 'react';
import Channel from '../../../lib/channel';
import { useMole } from '../context/useMole';

export const TakeoverBanner: React.FC = () => {
  const { state, dispatch } = useMole();

  // 监听接管状态
  useEffect(() => {
    const handler = (data: any) => {
      if (!data || typeof data !== 'object') return;
      if (data.active === false) {
        dispatch({ type: 'SET_TAKEOVER', payload: null });
        return;
      }
      const label = String(data.label || 'AI 接管中').trim();
      const ttlRaw = Number(data.expiresInMs);
      const ttlMs = Number.isFinite(ttlRaw) ? Math.max(5000, Math.min(600000, ttlRaw)) : 120000;
      dispatch({
        type: 'SET_TAKEOVER',
        payload: {
          active: true,
          label,
          expiresAt: Date.now() + ttlMs,
          source: typeof data.source === 'string' ? data.source : undefined,
          workflow: typeof data.workflow === 'string' ? data.workflow : undefined,
        },
      });
    };
    Channel.on('__mole_takeover_state', handler);
    return () => Channel.off('__mole_takeover_state', handler);
  }, [dispatch]);

  const takeover = state.tabTakeoverState;
  if (!takeover?.active) return null;
  if (takeover.expiresAt <= Date.now()) return null;

  const metaText = takeover.source === 'plan_execution'
    ? '当前页 AI 正在执行任务'
    : '当前页由 AI 接管中';

  return (
    <div className="mole-takeover-banner">
      <span className="mole-takeover-label">{takeover.label}</span>
      <span className="mole-takeover-meta">{metaText}</span>
    </div>
  );
};

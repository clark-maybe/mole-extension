/**
 * 审批确认卡片组件
 * AI 请求用户确认时展示，支持批准/拒绝/本次不再询问
 */

import React, { useState, useCallback } from 'react';
import Channel from '../../../lib/channel';
import { LOGO_REQUEST_CONFIRMATION } from '../icons';
import { useMole } from '../context/useMole';

interface ApprovalCardProps {
  requestId: string;
  message: string;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ requestId, message }) => {
  const { dispatch } = useMole();
  const [settled, setSettled] = useState(false);
  const [result, setResult] = useState<'approved' | 'rejected' | 'cancelled' | null>(null);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const settle = useCallback((res: 'approved' | 'rejected') => {
    setSettled(true);
    setResult(res);
    // 延迟清除状态，让用户看到结果
    setTimeout(() => dispatch({ type: 'SET_APPROVAL_REQUEST', payload: null }), 1500);
  }, [dispatch]);

  const handleApprove = useCallback(() => {
    Channel.send('__approval_response', { requestId, approved: true });
    settle('approved');
  }, [requestId, settle]);

  const handleReject = useCallback(() => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    Channel.send('__approval_response', { requestId, approved: false, userMessage: rejectReason });
    settle('rejected');
  }, [requestId, showRejectInput, rejectReason, settle]);

  const handleTrustAll = useCallback(() => {
    Channel.send('__approval_response', { requestId, approved: true, trustAll: true });
    settle('approved');
  }, [requestId, settle]);

  const headerText = result === 'approved' ? '已批准'
    : result === 'rejected' ? '已拒绝'
    : result === 'cancelled' ? '已取消'
    : '需要你的确认';

  return (
    <div className={`mole-approval-standalone${settled ? ' settled' : ''}`}>
      <div className="mole-approval-header-bar">
        <img src={LOGO_REQUEST_CONFIRMATION} alt="" />
        <span>{headerText}</span>
      </div>
      <div className={`mole-approval-card${settled ? ' settled' : ''}`} data-request-id={requestId}>
        <div className="mole-approval-message">{message}</div>
        {!settled && (
          <div className="mole-approval-actions">
            <button className="mole-approval-btn approve" onClick={handleApprove}>批准</button>
            <button className="mole-approval-btn reject" onClick={handleReject}>
              {showRejectInput ? '确认拒绝' : '拒绝'}
            </button>
            <button className="mole-approval-btn trust-all" onClick={handleTrustAll}>本次不再询问</button>
          </div>
        )}
        {showRejectInput && !settled && (
          <div className="mole-approval-reject-input open">
            <input
              className="mole-approval-reject-text"
              placeholder="拒绝理由（可选）"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
            />
          </div>
        )}
        {settled && (
          <div className="mole-approval-result">
            {result === 'approved' ? '✓ 已批准' : result === 'rejected' ? '✗ 已拒绝' : '已取消'}
          </div>
        )}
      </div>
    </div>
  );
};

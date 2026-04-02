/**
 * 录制启动确认 Modal
 * 在 Shadow DOM 内渲染，用于用户确认开始录制操作流程
 */

import React from 'react';

interface RecordModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 提示条目 */
const HINTS = [
  { icon: '\uD83D\uDCCD', text: '录制范围：当前标签页的可见区域操作' },
  { icon: '\uD83D\uDD12', text: '隐私提示：每步操作会截取屏幕快照供 AI 分析，请注意敏感信息' },
  { icon: '\u26A0\uFE0F', text: '限制：仅支持单标签页，最多录制 10 步操作' },
];

export const RecordModal: React.FC<RecordModalProps> = ({ visible, onConfirm, onCancel }) => {
  if (!visible) return null;

  return (
    <div className="mole-record-modal-overlay" onClick={onCancel}>
      <div className="mole-record-modal" onClick={(e) => e.stopPropagation()}>
        <div className="mole-record-modal-title">开始录制操作流程</div>

        <div className="mole-record-modal-hints">
          {HINTS.map((hint, i) => (
            <div className="mole-record-modal-hint" key={i}>
              <span className="mole-record-modal-hint-icon">{hint.icon}</span>
              <span>{hint.text}</span>
            </div>
          ))}
        </div>

        <div className="mole-record-modal-actions">
          <button
            className="mole-record-modal-btn cancel"
            type="button"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            className="mole-record-modal-btn confirm"
            type="button"
            onClick={onConfirm}
          >
            开始录制
          </button>
        </div>
      </div>
    </div>
  );
};

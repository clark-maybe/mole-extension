/**
 * 工作流录制状态栏组件
 * 录制中显示步数和停止按钮；审计中显示处理状态和取消按钮
 */

import React from 'react';
import { useMole } from '../context/useMole';

export const RecorderBar: React.FC<{
  onStop: () => void;
  onCancelAudit?: () => void;
}> = ({ onStop, onCancelAudit }) => {
  const { state } = useMole();
  const { isRecording, isRecorderAuditing, recorderStepCount } = state;

  // 审计中状态
  if (isRecorderAuditing) {
    return (
      <div className="mole-recorder-bar visible auditing">
        <span className="mole-recorder-bar-dot auditing" />
        <span className="mole-recorder-bar-info">
          正在整理录制的工作流...
        </span>
        {onCancelAudit && (
          <button className="mole-recorder-bar-stop" type="button" onClick={onCancelAudit}>
            取消
          </button>
        )}
      </div>
    );
  }

  // 录制中状态
  if (!isRecording) return null;

  return (
    <div className="mole-recorder-bar visible">
      <span className="mole-recorder-bar-dot" />
      <span className="mole-recorder-bar-info">
        录制中 · {recorderStepCount} 步
      </span>
      <button className="mole-recorder-bar-stop" type="button" onClick={onStop}>
        停止录制
      </button>
    </div>
  );
};

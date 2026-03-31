/**
 * 工作流录制状态栏组件
 * 录制中显示步数和停止按钮
 */

import React, { useCallback } from 'react';
import Channel from '../../../lib/channel';
import { useMole } from '../context/useMole';

export const RecorderBar: React.FC = () => {
  const { state, dispatch } = useMole();
  const { isRecording, recorderStepCount } = state;

  const handleStop = useCallback(() => {
    Channel.send('__recorder_stop', {});
    dispatch({ type: 'SET_RECORDING', payload: { isRecording: false, stepCount: 0 } });
  }, [dispatch]);

  if (!isRecording) return null;

  return (
    <div className="mole-recorder-bar visible">
      <span className="mole-recorder-bar-dot" />
      <span className="mole-recorder-bar-info">
        录制中 · {recorderStepCount} 步
      </span>
      <button className="mole-recorder-bar-stop" type="button" onClick={handleStop}>
        停止录制
      </button>
    </div>
  );
};

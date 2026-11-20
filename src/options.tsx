import React from 'react';
import ReactDOM from 'react-dom/client';
import Channel from './lib/channel';
import { OptionsApp } from './options/OptionsApp';
import './options/options.css';
import './options/workspace.css';

// 连接到 background 接收 broadcast 消息（AI 流式事件、会话同步等）
Channel.connectAsExtensionPage();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <OptionsApp />
    </React.StrictMode>,
);

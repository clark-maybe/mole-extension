import React from 'react';
import ReactDOM from 'react-dom/client';
import Channel from './lib/channel';
import { SidePanelApp } from './sidepanel/SidePanelApp';
import './sidepanel/sidepanel.css';

Channel.connectAsExtensionPage();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <SidePanelApp />
    </React.StrictMode>,
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import { OptionsApp } from './options/OptionsApp';
import './options/options.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <OptionsApp />
    </React.StrictMode>,
);

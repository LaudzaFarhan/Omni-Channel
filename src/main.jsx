import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ToastHost from './components/Toast.jsx';
import { applyStoredTheme } from './utils/theme.js';
import './index.css';

// Before the first render, so there is no flash of the wrong palette.
applyStoredTheme();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ToastHost from './components/Toast.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <ToastHost />
  </React.StrictMode>
);

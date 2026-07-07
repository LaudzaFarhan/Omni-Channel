import React from 'react';
import { Smartphone, RefreshCw, KeyRound, WifiOff } from 'lucide-react';

export default function ConnectionPanel({ status, qrCode }) {
  return (
    <div className="connection-overlay">
      <div className="connection-card glass">
        {status === 'connecting' && (
          <>
            <div className="spinner"></div>
            <h2 className="connection-title">Connecting to WhatsApp</h2>
            <p className="connection-subtitle">Please wait while we establish a connection with WhatsApp services...</p>
          </>
        )}

        {status === 'disconnected' && (
          <>
            <div className="welcome-logo-wrapper" style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
              <WifiOff size={40} />
            </div>
            <h2 className="connection-title" style={{ marginTop: '16px' }}>Connection Disconnected</h2>
            <p className="connection-subtitle">Failed to connect to the WhatsApp container. Check if the server is running and try again.</p>
          </>
        )}

        {status === 'qr' && (
          <>
            <h2 className="connection-title">Link your WhatsApp Account</h2>
            <p className="connection-subtitle">Scan the QR code below using your mobile phone's WhatsApp Business app to link your device.</p>
            
            <div className="qr-code-wrapper">
              {qrCode ? (
                <>
                  <img src={qrCode} alt="WhatsApp QR Code" className="qr-code-image" />
                  <div className="qr-pulse-glow"></div>
                </>
              ) : (
                <div className="spinner" style={{ margin: 'auto' }}></div>
              )}
            </div>

            <ol className="instruction-list">
              <li className="instruction-step">
                <span className="step-number">1</span>
                <span>Open <strong>WhatsApp</strong> on your phone.</span>
              </li>
              <li className="instruction-step">
                <span className="step-number">2</span>
                <span>Tap <strong>Menu</strong> (three dots on Android) or <strong>Settings</strong> (iPhone).</span>
              </li>
              <li className="instruction-step">
                <span className="step-number">3</span>
                <span>Select <strong>Linked Devices</strong>, then tap <strong>Link a Device</strong>.</span>
              </li>
              <li className="instruction-step">
                <span className="step-number">4</span>
                <span>Point your phone's camera at this screen to scan the QR code.</span>
              </li>
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import { MessageSquare, Users, Zap, Shield, Check, HelpCircle, Pause, Play, Code, Calendar, Clock, UserCheck, BarChart3, Tag, Building2, ShieldCheck, FileText, X } from 'lucide-react';
import { BrandLockup } from './BrandMark.jsx';

export default function LandingPage({ user, onGoToDashboard, onGoToLogin, onGoToRegister, onOpenBlog }) {
  const handleRegister = onGoToRegister || onGoToDashboard;
  const handleLogin = user ? onGoToDashboard : (onGoToLogin || onGoToDashboard);

  const [agentCount, setAgentCount] = React.useState(3);
  const [legalModalType, setLegalModalType] = React.useState(null);

  const calculatePrice = (count) => {
    if (count <= 3) return 300000;
    return 300000 + (count - 3) * 200000;
  };

  const formatPrice = (price) => {
    return price.toLocaleString('id-ID');
  };

  const handleScrollTo = (id) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const [messages, setMessages] = React.useState([]);
  const [typingAgent, setTypingAgent] = React.useState(null);
  const [isHolding, setIsHolding] = React.useState(false);
  const [holdingAgent, setHoldingAgent] = React.useState(null);
  const [showApiHint, setShowApiHint] = React.useState(false);
  const chatContainerRef = React.useRef(null);

  const isHoldingRef = React.useRef(false);
  const resumeCallbackRef = React.useRef(null);
  const activeRef = React.useRef(true);
  const timerRef = React.useRef(null);

  const chatSteps = React.useMemo(() => [
    { id: 1, type: 'incoming', text: 'Halo, saya tertarik dengan Toyota Avanza 2024. Masih ready stock?' },
    { id: 2, type: 'typing', agent: 'Agent Dani' },
    { id: 3, type: 'outgoing', agent: 'Agent Dani', text: 'Halo Pak! Ready stock untuk Avanza G dan Avanza Veloz. Mau tipe yang mana?' },
    { id: 4, type: 'incoming', text: 'Veloz dong, warna putih ada? Boleh tahu harga OTR-nya?' },
    { id: 5, type: 'typing', agent: 'Agent Rina' },
    { id: 6, type: 'outgoing', agent: 'Agent Rina', text: 'Warna putih tersedia Pak! Harga OTR Rp 295 juta, dan sekarang ada promo DP ringan mulai dari Rp 35 juta.' },
    { id: 7, type: 'incoming', text: 'Wah boleh juga. Bisa jadwalkan test drive hari Sabtu ini?' },
    { id: 8, type: 'typing', agent: 'Agent Dani' },
    { id: 9, type: 'outgoing', agent: 'Agent Dani', text: 'Siap Pak, test drive hari Sabtu sudah kami jadwalkan. Ditunggu kehadirannya! 🚗' }
  ], []);

  // Hold/Release handlers
  const handleHold = () => {
    isHoldingRef.current = true;
    setIsHolding(true);
    setShowApiHint(true);
  };

  const handleRelease = () => {
    isHoldingRef.current = false;
    setIsHolding(false);
    setHoldingAgent(null);
    setShowApiHint(false);
    // Resume the animation if it was paused
    if (resumeCallbackRef.current) {
      const cb = resumeCallbackRef.current;
      resumeCallbackRef.current = null;
      cb();
    }
  };

  React.useEffect(() => {
    let currentStep = 0;
    activeRef.current = true;

    setMessages([chatSteps[0]]);
    currentStep = 1;

    const runLoop = () => {
      if (!activeRef.current) return;
      if (currentStep >= chatSteps.length) {
        timerRef.current = setTimeout(() => {
          if (!activeRef.current) return;
          setMessages([chatSteps[0]]);
          setTypingAgent(null);
          setHoldingAgent(null);
          currentStep = 1;
          runLoop();
        }, 5000);
        return;
      }

      const step = chatSteps[currentStep];
      let delay = 2000;

      if (step.type === 'typing') {
        // If holding, pause here and wait for release
        if (isHoldingRef.current) {
          setTypingAgent(null);
          setHoldingAgent(step.agent);
          // Store a callback so release can resume
          resumeCallbackRef.current = () => {
            if (!activeRef.current) return;
            setHoldingAgent(null);
            setTypingAgent(step.agent);
            timerRef.current = setTimeout(() => {
              if (!activeRef.current) return;
              setTypingAgent(null);
              currentStep++;
              if (currentStep < chatSteps.length) {
                setMessages(prev => [...prev, chatSteps[currentStep]]);
                currentStep++;
              }
              runLoop();
            }, 1500);
          };
          return; // Stop the loop — release will resume it
        }
        setTypingAgent(step.agent);
        delay = 1500;
      } else if (step.type === 'outgoing') {
        setTypingAgent(null);
        setMessages(prev => [...prev, step]);
        delay = 3000;
      } else if (step.type === 'incoming') {
        setTypingAgent(null);
        setMessages(prev => [...prev, step]);
        delay = 3000;
      }

      currentStep++;
      timerRef.current = setTimeout(runLoop, delay);
    };

    timerRef.current = setTimeout(runLoop, 2500);

    return () => {
      activeRef.current = false;
      clearTimeout(timerRef.current);
      resumeCallbackRef.current = null;
    };
  }, [chatSteps]);

  React.useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, typingAgent, holdingAgent]);

  return (
    <div className="landing-container">
      {/* Navigation */}
      <nav className="landing-nav">
        <a href="#" className="landing-brand" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <BrandLockup markSize={31} />
        </a>
        <ul className="nav-links">
          <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>Features</a></li>
          <li><a href="#pricing" onClick={(e) => { e.preventDefault(); handleScrollTo('pricing'); }}>Pricing</a></li>
          <li><a href="#faq" onClick={(e) => { e.preventDefault(); handleScrollTo('faq'); }}>FAQ</a></li>
          <li><a href="/blog" onClick={(e) => { e.preventDefault(); onOpenBlog?.(); }}>Blog & Panduan API</a></li>
        </ul>
        <button className="nav-btn" onClick={handleLogin}>
          {user ? 'Buka Dashboard' : 'Login / Masuk'}
        </button>
      </nav>

      {/* Hero Section */}
      <header className="hero-section">
        <div className="hero-layout">
          <div className="hero-left">
            <div className="hero-badge">🚀 WHATSAPP UNOFFICIAL API INDO & MULTI-AGENT CRM</div>
            <h1 className="hero-title">
              Bypass WhatsApp's 4-Device Limit. <br />
              <span>WhatsApp Unofficial API Indonesia.</span>
            </h1>
            <p className="hero-subtitle">
              Solusi WhatsApp Unofficial API Indo tercepat dan terandal untuk bisnis. Hubungkan nomor WhatsApp Anda dalam 1 klik, aktifkan unlimited multi-agent CS & sales inbox, automasi Bot AI dengan Webhook realtime, dan pantau SLA follow-up 24 jam tanpa batasan kuota pesan.
            </p>
            <div className="hero-ctas">
              <button className="nav-btn hero-btn-large" onClick={handleRegister}>
                Mulai Uji Coba Gratis
              </button>
              <a href="#pricing" className="btn-secondary hero-btn-large" onClick={(e) => { e.preventDefault(); handleScrollTo('pricing'); }}>
                Lihat Paket Harga
              </a>
            </div>
          </div>

          <div className="hero-right">
            <div className="wa-mockup glass">
              <div className="wa-mockup-header">
                <div className="wa-mockup-avatar">BK</div>
                <div className="wa-mockup-info" style={{ textAlign: 'left' }}>
                  <div className="wa-mockup-name">Budi Kartono</div>
                  <div className="wa-mockup-status">
                    <span className="wa-status-dot"></span> Online
                  </div>
                </div>
                {isHolding && (
                  <div style={{
                    marginLeft: 'auto',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#ef4444',
                    fontSize: '0.65rem',
                    fontWeight: '700',
                    padding: '3px 8px',
                    borderRadius: '4px',
                    letterSpacing: '0.5px',
                    animation: 'pulse 1.5s ease-in-out infinite'
                  }}>
                    ⏸ ON HOLD
                  </div>
                )}
              </div>

              <div className="wa-mockup-chat" ref={chatContainerRef}>
                {messages.map((m, idx) => (
                  <div key={m.id || idx} className={`wa-bubble ${m.type}`}>
                    {m.type === 'outgoing' && (
                      <div className="wa-agent-tag">👤 {m.agent}</div>
                    )}
                    <div>{m.text}</div>
                  </div>
                ))}

                {typingAgent && (
                  <div className="typing-bubble">
                    <div className="wa-agent-tag" style={{ marginRight: '8px' }}>{typingAgent} is typing</div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                    <div className="typing-dot"></div>
                  </div>
                )}

                {holdingAgent && !typingAgent && (
                  <div style={{
                    padding: '8px 12px',
                    margin: '6px 12px',
                    background: 'rgba(239, 68, 68, 0.08)',
                    border: '1px dashed rgba(239, 68, 68, 0.3)',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    color: '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <Pause size={12} />
                    <span><strong>{holdingAgent}</strong> is on hold — waiting for release</span>
                  </div>
                )}
              </div>

              {/* Agent Control Bar */}
              <div style={{
                padding: '10px 14px',
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                background: 'rgba(0,0,0,0.15)'
              }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', marginRight: 'auto', fontWeight: '600' }}>
                  API Control
                </div>
                {!isHolding ? (
                  <button
                    onClick={handleHold}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '6px 14px',
                      fontSize: '0.72rem',
                      fontWeight: '600',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      borderRadius: '6px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      color: '#ef4444',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <Pause size={12} /> Hold Agent
                  </button>
                ) : (
                  <button
                    onClick={handleRelease}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '6px 14px',
                      fontSize: '0.72rem',
                      fontWeight: '600',
                      border: '1px solid var(--success-border)',
                      borderRadius: '6px',
                      background: 'var(--success-soft)',
                      color: 'var(--success)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      animation: 'pulse 1.5s ease-in-out infinite'
                    }}
                  >
                    <Play size={12} /> Let Agent Reply
                  </button>
                )}
              </div>
            </div>

            {/* API Code Hint */}
            <div style={{
              marginTop: '12px',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              overflow: 'hidden',
              maxHeight: showApiHint ? '160px' : '0px',
              opacity: showApiHint ? 1 : 0,
              transition: 'max-height 0.4s ease, opacity 0.3s ease'
            }}>
              <div style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.72rem',
                fontWeight: '600',
                color: 'var(--primary)'
              }}>
                <Code size={13} /> API Endpoint
              </div>
              <pre style={{
                margin: 0,
                padding: '12px 14px',
                fontSize: '0.68rem',
                lineHeight: '1.5',
                color: '#a5f3fc',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace',",
                overflowX: 'auto',
                whiteSpace: 'pre'
              }}>{`POST /api/agent/hold
{
  "sessionId": "default",
  "chatJid": "628..@s.whatsapp.net",
  "action": "release"  // or "hold"
}`}</pre>
            </div>
          </div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="features-section">
        <h2 className="section-title">Built for High-Growth Sales & Support Teams</h2>
        <p className="section-subtitle">
          Everything your team needs to scale customer engagement on WhatsApp — without device limits, missed follow-ups, or lost context.
        </p>
        
        <div className="features-grid">
          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Users size={24} />
            </div>
            <h3>Unlimited Support & Sales Agents</h3>
            <p>
              Connect 1 WhatsApp Business number and invite your entire team. Bypass WhatsApp's 4-device limit with simultaneous multi-agent chatting.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Calendar size={24} />
            </div>
            <h3>Sales Tracking & Calendar Analytics</h3>
            <p>
              Track which sales member initiated each chat. Filter complete conversation histories with calendar date presets and view team activity leaderboards.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Clock size={24} />
            </div>
            <h3>24-Hour Follow-up SLA & Alerting</h3>
            <p>
              Real-time 24-hour response countdowns, automated warning banners, and 1-click filters for customers awaiting reply over 24 hours.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Tag size={24} />
            </div>
            <h3>Customer Profile & Tagging System</h3>
            <p>
              WhatsApp-style contact drawer, customizable color tags with compact view, and commercial pipeline status tracking (New Leads, Closed Won).
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Shield size={24} />
            </div>
            <h3>AI Bot Automation & Agent Hold</h3>
            <p>
              Deploy auto-reply bots with 1-click human agent takeover (Hold / Resume). Full control via REST API endpoints and Webhook event streams.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Zap size={24} />
            </div>
            <h3>⚡ Lightning Quick Replies</h3>
            <p>
              Respond in seconds with pre-saved message templates, inline slash ('/') shortcuts, and rich media attachments (images, audio, documents).
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="pricing-section">
        <h2 className="section-title">Affordable Pricing Plans</h2>
        <p className="section-subtitle">
          Get started today and scale your support operations without paying per-conversation or per-device surcharges.
        </p>

        <div className="pricing-grid">
          {/* Starter Plan with Dynamic Calculator */}
          <div className="pricing-card glass popular">
            <div className="popular-tag">Flexible Setup</div>
            <div className="pricing-card-header">
              <div className="pricing-plan-name">Starter Plan</div>
              <div className="pricing-price">Rp {formatPrice(calculatePrice(agentCount))}<span>/bulan</span></div>
              <p className="pricing-desc">
                Rp 300.000/mo base for up to 3 agents. <br />
                <strong>+Rp 200.000/mo</strong> per additional agent.
              </p>
            </div>

            {/* Interactive Calculator Slider */}
            <div style={{ margin: '10px 0 24px 0', padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '0.9rem', fontWeight: '600' }}>
                <span>Support Agents</span>
                <span style={{ color: 'var(--primary)' }}>{agentCount} {agentCount === 1 ? 'Agent' : 'Agents'}</span>
              </div>
              <input 
                type="range" 
                min="1" 
                max="10" 
                value={agentCount} 
                onChange={(e) => setAgentCount(parseInt(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-dimmed)', marginTop: '4px' }}>
                <span>1 Agent</span>
                <span>10 Agents</span>
              </div>
              {agentCount > 3 && (
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '12px', background: 'var(--primary-subtle)', padding: '8px', borderRadius: '4px', borderLeft: '3.5px solid var(--primary)' }}>
                  Rp 300.000 (Base) + Rp {formatPrice((agentCount - 3) * 200000)} ({agentCount - 3} extra)
                </div>
              )}
            </div>

            <ul className="pricing-features-list">
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>1 Active WhatsApp Number</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>{agentCount} Support {agentCount === 1 ? 'Agent' : 'Agents'} configured</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Sales Tracking & Conversation Logs</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>24-Hour Follow-up SLA & Overdue Alert</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Customer Profile Drawer & Contact Tags</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>⚡ Lightning Quick Replies & '/' Shortcuts</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Real-Time Message Sync & Media Attachments</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Local Message Database & Contact Store</span>
              </li>
            </ul>
            <button className="pricing-btn primary" onClick={handleRegister}>
              Mulai Uji Coba 7 Hari
            </button>
          </div>

          {/* Unlimited Plan */}
          <div className="pricing-card glass">
            <div className="pricing-card-header">
              <div className="pricing-plan-name">Unlimited Plan</div>
              <div className="pricing-price">Rp 1.500.000<span>/bulan</span></div>
              <p className="pricing-desc">For scaling sales teams, call centers, and fast-growing businesses.</p>
            </div>
            <ul className="pricing-features-list">
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>1 Active WhatsApp Number</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span><strong>Unlimited</strong> Support & Sales Agents</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Sales History Logs & Calendar Date Range Filter</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Team Performance & Activity Leaderboard</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>24-Hour Follow-up SLA & Customer Alerting</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Customer Profile Drawer & Custom Tags System</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>AI Bot Automation & 1-Click Hold / Handover API</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>⚡ Unlimited Quick Reply Templates & Macros</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Real-Time Inbox Collaboration & WebSockets</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Priority 24/7 Developer & Technical Support</span>
              </li>
            </ul>
            <button className="pricing-btn secondary" onClick={handleRegister}>
              Daftar Paket Unlimited
            </button>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="faq-section">
        <h2 className="section-title">Frequently Asked Questions</h2>
        <p className="section-subtitle">Pertanyaan umum seputar layanan WhatsApp Unofficial API Indonesia & Multi-Agent Inbox.</p>

        <div className="faq-list">
          <div className="faq-item">
            <div className="faq-question">Apa itu WhatsApp Unofficial API Indo dan keunggulannya dibanding Official Cloud API?</div>
            <div className="faq-answer">
              WhatsApp Unofficial API Indo memungkinkan Anda menghubungkan nomor WhatsApp pribadi atau bisnis Anda sendiri secara langsung tanpa approval rumit dan tanpa biaya per pesan yang mahal. Anda mendapatkan kebebasan penuh untuk mengirim pesan otomatis, notifikasi transaksi, broadcast, serta integrasi multi-agent dan Webhook.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Bagaimana cara bypass batas 4 perangkat WhatsApp Web?</div>
            <div className="faq-answer">
              WhatsApp Web membatasi 4 perangkat terhubung. Gateway Omni Reach menghubungkan nomor Anda sebagai 1 companion device, lalu mendistribusikan koneksi tersebut ke browser seluruh tim secara realtime via WebSockets. Sehingga puluhan agen CS & sales bisa membalas chat secara bersamaan.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Bagaimana cara integrasi WhatsApp Unofficial API ke aplikasi CRM / POS / Website?</div>
            <div className="faq-answer">
              Kami menyediakan REST API dan Webhook realtime. Anda dapat mengirim pesan teks, gambar, dokumen, mengontrol status bot agent (`/api/agent/hold`), serta menerima event pesan masuk ke sistem backend Anda dengan mudah menggunakan Node.js, Python, PHP (Laravel), dsb.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Bagaimana cara kerja SLA Follow-up 24 Jam?</div>
            <div className="faq-answer">
              Sistem menghitung durasi sejak pesan terakhir pelanggan masuk. Anda mendapatkan visual badge, notifikasi peringatan, dan filter khusus untuk langsung menemukan prospek yang belum di-follow up lebih dari 24 jam agar tidak ada potensi penjualan yang terlewat.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Apakah bisa memantau performa dan riwayat penjualan tim sales?</div>
            <div className="faq-answer">
              Ya! Setiap percakapan dan pesan tercatat dengan identitas agen yang menangani. Anda dapat memfilter riwayat pesan berdasarkan rentang tanggal kalender (Hari Ini, Kemarin, 7 Hari Terakhir, Bulan Ini, atau Custom) dan melihat leaderboard aktivitas agen.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Apakah data percakapan pelanggan aman?</div>
            <div className="faq-answer">
              Sangat aman. Server berjalan secara mandiri dan menyimpan riwayat percakapan secara terenkripsi di database Anda sendiri tanpa dipindahtangankan ke pihak ketiga.
            </div>
          </div>
        </div>
      </section>

      {/* Corporate & Brand Footer */}
      <footer className="landing-footer-container">
        <div className="landing-footer-top">
          {/* Brand & Corporate Column */}
          <div className="footer-col footer-col-brand">
            <div className="footer-brand-header">
              <BrandLockup markSize={32} />
            </div>
            <p className="footer-brand-desc">
              Platform WhatsApp Unofficial API Indonesia & Multi-Agent CRM Inbox modern untuk mempercepat respon customer, otomasi bot cerdas, dan akselerasi konversi penjualan bisnis Anda.
            </p>
            <div className="footer-legal-badge">
              <div className="legal-badge-header">
                <Building2 size={16} className="legal-badge-icon" />
                <span className="legal-label">Badan Hukum Resmi</span>
              </div>
              <div className="legal-company-name">PT AWAM KODING INDONESIA</div>
              <div className="legal-entity-note">Perusahaan Teknologi & Pengembang Perangkat Lunak Indonesia</div>
            </div>
          </div>

          {/* Product & Solutions Column */}
          <div className="footer-col">
            <h4 className="footer-col-title">Produk & Fitur</h4>
            <ul className="footer-links-list">
              <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>Multi-Agent WhatsApp Inbox</a></li>
              <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>24-Hour Follow-Up SLA</a></li>
              <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>AI Bot & 1-Click Hold API</a></li>
              <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>Webhook Realtime & REST API</a></li>
              <li><a href="#pricing" onClick={(e) => { e.preventDefault(); handleScrollTo('pricing'); }}>Paket Harga & Uji Coba</a></li>
            </ul>
          </div>

          {/* Guides & Resources Column */}
          <div className="footer-col">
            <h4 className="footer-col-title">Panduan & Edukasi</h4>
            <ul className="footer-links-list">
              <li><a href="/blog" onClick={(e) => { e.preventDefault(); onOpenBlog?.(); }}>Panduan WhatsApp API Indonesia</a></li>
              <li><a href="#faq" onClick={(e) => { e.preventDefault(); handleScrollTo('faq'); }}>Pertanyaan Umum (FAQ)</a></li>
              <li><a href="/blog" onClick={(e) => { e.preventDefault(); onOpenBlog?.(); }}>Bypass 4-Device WhatsApp Limit</a></li>
              <li><a href="mailto:support@omnireach.my.id">Bantuan Teknis & CS</a></li>
            </ul>
          </div>

          {/* Legal & Trust Column */}
          <div className="footer-col">
            <h4 className="footer-col-title">Legal & Kepatuhan</h4>
            <ul className="footer-links-list">
              <li>
                <button type="button" className="footer-link-btn" onClick={() => setLegalModalType('terms')}>
                  <FileText size={14} /> Ketentuan Layanan (ToS)
                </button>
              </li>
              <li>
                <button type="button" className="footer-link-btn" onClick={() => setLegalModalType('privacy')}>
                  <ShieldCheck size={14} /> Kebijakan Privasi Data
                </button>
              </li>
              <li>
                <button type="button" className="footer-link-btn" onClick={() => setLegalModalType('disclaimer')}>
                  <HelpCircle size={14} /> Disclaimer Merek
                </button>
              </li>
              <li>
                <div className="footer-status-pill">
                  <span className="status-dot-green"></span> Sistem Operasional 99.9%
                </div>
              </li>
            </ul>
          </div>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="landing-footer-disclaimer">
          <p>
            <strong>Pemberitahuan Hukum:</strong> Omni Reach dikembangkan dan dikelola secara mandiri oleh <strong>PT AWAM KODING INDONESIA</strong>. Layanan ini adalah gateway independen dan tidak memiliki afiliasi resmi, tidak didukung, atau disahkan secara langsung oleh Meta Platforms, Inc. maupun WhatsApp Inc. Nama dan logo "WhatsApp" adalah merek dagang terdaftar milik Meta Platforms, Inc.
          </p>
        </div>

        {/* Footer Bottom Bar */}
        <div className="landing-footer-bottom">
          <div className="footer-copyright">
            © {new Date().getFullYear()} <strong>PT AWAM KODING INDONESIA</strong>. Hak Cipta Dilindungi Undang-Undang. All rights reserved.
          </div>
          <div className="footer-engineered">
            Platform dikembangkan oleh <strong>PT AWAM KODING INDONESIA</strong>
          </div>
        </div>
      </footer>

      {/* Interactive Legal Modal */}
      {legalModalType && (
        <div className="legal-modal-backdrop" onClick={() => setLegalModalType(null)}>
          <div className="legal-modal-card glass" onClick={(e) => e.stopPropagation()}>
            <div className="legal-modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Building2 size={22} style={{ color: 'var(--primary)' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>
                    {legalModalType === 'terms' && 'Ketentuan Layanan (Terms of Service)'}
                    {legalModalType === 'privacy' && 'Kebijakan Privasi Data (Privacy Policy)'}
                    {legalModalType === 'disclaimer' && 'Pernyataan Disclaimer Hukum & Merek Dagang'}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    Diterbitkan oleh PT AWAM KODING INDONESIA
                  </div>
                </div>
              </div>
              <button 
                type="button" 
                className="legal-modal-close" 
                onClick={() => setLegalModalType(null)}
                aria-label="Tutup"
              >
                <X size={20} />
              </button>
            </div>

            <div className="legal-modal-body">
              {legalModalType === 'terms' && (
                <div className="legal-text-content">
                  <h4>1. Pendahuluan & Penerimaan Ketentuan</h4>
                  <p>
                    Ketentuan Layanan ini ("Ketentuan") mengatur akses dan penggunaan Anda atas seluruh fitur dan piranti lunak Omni Reach yang disediakan oleh <strong>PT AWAM KODING INDONESIA</strong> ("Kami"). Dengan mendaftar atau menggunakan platform Omni Reach, Anda menyatakan setuju untuk terikat oleh Ketentuan ini.
                  </p>

                  <h4>2. Penggunaan Layanan yang Sah & Anti-Spam</h4>
                  <p>
                    Anda setuju untuk menggunakan nomor WhatsApp dan platform Omni Reach sesuai dengan ketentuan hukum yang berlaku di Republik Indonesia, termasuk Undang-Undang Informasi dan Transaksi Elektronik (UU ITE). Dilarang keras menggunakan layanan ini untuk pengiriman pesan spam massal tanpa izin penerima, penipuan, konten terlarang, atau aktivitas yang melanggar hukum.
                  </p>

                  <h4>3. Akun dan Tanggung Jawab Keamanan</h4>
                  <p>
                    Pengguna bertanggung jawab penuh atas keamanan nomor WhatsApp yang dipindai (QR scan), token API, dan akun pengguna di dalam workspace Anda. Anda wajib segera memberi tahu kami jika menemukan indikasi akses tidak sah ke akun Anda.
                  </p>

                  <h4>4. Batasan Tanggung Jawab</h4>
                  <p>
                    Omni Reach merupakan alat penghubung (gateway) komunikasi multi-agen independen. PT AWAM KODING INDONESIA tidak bertanggung jawab atas tindakan pemblokiran atau penangguhan nomor WhatsApp yang dilakukan oleh sistem Meta Platforms, Inc. akibat pelanggaran aturan oleh pengguna.
                  </p>

                  <h4>5. Hukum yang Berlaku</h4>
                  <p>
                    Ketentuan ini diatur dan ditafsirkan sesuai dengan hukum yang berlaku di Negara Kesatuan Republik Indonesia.
                  </p>
                </div>
              )}

              {legalModalType === 'privacy' && (
                <div className="legal-text-content">
                  <h4>1. Komitmen Perlindungan Data</h4>
                  <p>
                    <strong>PT AWAM KODING INDONESIA</strong> menghormati dan berkomitmen penuh untuk melindungi privasi data pribadi Anda serta data pelanggan Anda sesuai dengan prinsip Undang-Undang Perlindungan Data Pribadi (UU PDP) Indonesia.
                  </p>

                  <h4>2. Data yang Kami Proses</h4>
                  <p>
                    Kami hanya memproses informasi akun yang diperlukan untuk penyediaan layanan, seperti alamat email, nama workspace, sesi koneksi WhatsApp, dan nomor kontak yang terdaftar. Data percakapan WhatsApp disimpan di server database lokal Anda secara terenkripsi untuk kebutuhan operasional tim internal Anda.
                  </p>

                  <h4>3. Kerahasiaan & Tidak Ada Penjualan Data</h4>
                  <p>
                    Kami <strong>tidak pernah dan tidak akan pernah</strong> menjual, menyewakan, memperdagangkan, atau membagikan nomor kontak, percakapan, atau data pelanggan bisnis Anda kepada pihak ketiga mana pun untuk tujuan periklanan atau komersial.
                  </p>

                  <h4>4. Standar Keamanan Data</h4>
                  <p>
                    Sistem kami menerapkan enkripsi Secure Sockets Layer (SSL/TLS 1.3), hashing password menggunakan standar scrypt modern, dan pengamanan token otentikasi JWT HS256 yang kadaluarsa secara otomatis untuk melindungi data dari akses pihak yang tidak berhak.
                  </p>
                </div>
              )}

              {legalModalType === 'disclaimer' && (
                <div className="legal-text-content">
                  <h4>1. Independensi Layanan</h4>
                  <p>
                    Omni Reach adalah platform piranti lunak inovasi mandiri yang dikembangkan, didistribusikan, dan didukung sepenuhnya oleh <strong>PT AWAM KODING INDONESIA</strong>.
                  </p>

                  <h4>2. Hak Merek Dagang</h4>
                  <p>
                    Nama "WhatsApp", logo WhatsApp, dan merek dagang terkait adalah hak kekayaan intelektual milik Meta Platforms, Inc. Penggunaan nama "WhatsApp" di platform ini semata-mata bersifat deskriptif untuk mengidentifikasi kompatibilitas fungsional integrasi perangkat lunak kami.
                  </p>

                  <h4>3. Tanpa Afiliasi Meta</h4>
                  <p>
                    PT AWAM KODING INDONESIA dan produk Omni Reach tidak berafiliasi resmi, tidak disponsori, tidak didukung, atau disahkan secara langsung oleh Meta Platforms, Inc. maupun WhatsApp Inc.
                  </p>
                </div>
              )}
            </div>

            <div className="legal-modal-footer">
              <button 
                type="button" 
                className="nav-btn" 
                onClick={() => setLegalModalType(null)}
                style={{ padding: '8px 20px', fontSize: '0.9rem' }}
              >
                Saya Mengerti
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

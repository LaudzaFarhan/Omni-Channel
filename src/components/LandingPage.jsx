import React from 'react';
import { MessageSquare, Users, Zap, Shield, Check, HelpCircle } from 'lucide-react';

export default function LandingPage({ onGoToDashboard }) {
  const [agentCount, setAgentCount] = React.useState(3);

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
  const chatContainerRef = React.useRef(null);

  React.useEffect(() => {
    const chatSteps = [
      { id: 1, type: 'incoming', text: 'Halo, saya tertarik dengan Toyota Avanza 2024. Masih ready stock?' },
      { id: 2, type: 'typing', agent: 'Agent Dani' },
      { id: 3, type: 'outgoing', agent: 'Agent Dani', text: 'Halo Pak! Ready stock untuk Avanza G dan Avanza Veloz. Mau tipe yang mana?' },
      { id: 4, type: 'incoming', text: 'Veloz dong, warna putih ada? Boleh tahu harga OTR-nya?' },
      { id: 5, type: 'typing', agent: 'Agent Rina' },
      { id: 6, type: 'outgoing', agent: 'Agent Rina', text: 'Warna putih tersedia Pak! Harga OTR Rp 295 juta, dan sekarang ada promo DP ringan mulai dari Rp 35 juta.' },
      { id: 7, type: 'incoming', text: 'Wah boleh juga. Bisa jadwalkan test drive hari Sabtu ini?' },
      { id: 8, type: 'typing', agent: 'Agent Dani' },
      { id: 9, type: 'outgoing', agent: 'Agent Dani', text: 'Siap Pak, test drive hari Sabtu sudah kami jadwalkan. Ditunggu kehadirannya! 🚗' }
    ];

    let currentStep = 0;
    let active = true;
    let timerId = null;

    setMessages([chatSteps[0]]);
    currentStep = 1;

    const runLoop = () => {
      if (!active) return;
      if (currentStep >= chatSteps.length) {
        timerId = setTimeout(() => {
          if (!active) return;
          setMessages([chatSteps[0]]);
          setTypingAgent(null);
          currentStep = 1;
          runLoop();
        }, 5000);
        return;
      }

      const step = chatSteps[currentStep];
      let delay = 2000;

      if (step.type === 'typing') {
        setTypingAgent(step.agent);
        delay = 1500;
      } else {
        setTypingAgent(null);
        setMessages(prev => [...prev, step]);
        delay = 3000;
      }

      currentStep++;
      timerId = setTimeout(runLoop, delay);
    };

    timerId = setTimeout(runLoop, 2500);

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, []);

  React.useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, typingAgent]);

  return (
    <div className="landing-container">
      {/* Navigation */}
      <nav className="landing-nav">
        <a href="#" className="nav-logo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <MessageSquare size={24} style={{ color: 'var(--primary)' }} />
          <span>WAgateway</span>
        </a>
        <ul className="nav-links">
          <li><a href="#features" onClick={(e) => { e.preventDefault(); handleScrollTo('features'); }}>Features</a></li>
          <li><a href="#pricing" onClick={(e) => { e.preventDefault(); handleScrollTo('pricing'); }}>Pricing</a></li>
          <li><a href="#faq" onClick={(e) => { e.preventDefault(); handleScrollTo('faq'); }}>FAQ</a></li>
        </ul>
        <button className="nav-btn" onClick={onGoToDashboard}>
          Open Dashboard
        </button>
      </nav>

      {/* Hero Section */}
      <header className="hero-section" style={{ maxWidth: '1200px' }}>
        <div className="hero-layout">
          <div className="hero-left">
            <div className="hero-badge">🚀 MULTI-AGENT INBOX SOLUTION</div>
            <h1 className="hero-title" style={{ fontSize: '3rem' }}>
              Bypass WhatsApp's 4-Device Limit. <br />
              <span>Enable Unlimited Agents.</span>
            </h1>
            <p className="hero-subtitle" style={{ fontSize: '1.15rem' }}>
              Connect your WhatsApp Business number once to our secure local gateway. 
              Let your entire customer support team chat, reply, and manage leads simultaneously from a single, unified inbox.
            </p>
            <div className="hero-ctas">
              <button className="nav-btn hero-btn-large" onClick={onGoToDashboard}>
                Start Free Trial
              </button>
              <a href="#pricing" className="btn-secondary hero-btn-large" onClick={(e) => { e.preventDefault(); handleScrollTo('pricing'); }}>
                View Pricing
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
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Features Grid */}
      <section id="features" className="features-section">
        <h2 className="section-title">Built for High-Growth Customer Support</h2>
        <p className="section-subtitle">
          Everything your sales and support agents need to engage customers faster on WhatsApp, without device limits.
        </p>
        
        <div className="features-grid">
          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Users size={24} />
            </div>
            <h3>Unlimited Support Agents</h3>
            <p>
              Connect 1 WhatsApp Business number and invite your entire team. No more sharing a single phone or hitting browser session caps.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Zap size={24} />
            </div>
            <h3>One-Click Quick Replies</h3>
            <p>
              Respond to common sales or customer questions in under 2 seconds. Create canned replies to save time and maintain brand voice.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <MessageSquare size={24} />
            </div>
            <h3>Real-Time Sync & Webhooks</h3>
            <p>
              Instantly sync and stream incoming texts, media, and statuses across all logged-in agent dashboards via active WebSockets.
            </p>
          </div>

          <div className="feature-card glass">
            <div className="feature-card-icon">
              <Shield size={24} />
            </div>
            <h3>100% Private Data Hosting</h3>
            <p>
              Since the engine runs locally on your machine/server, your private client conversations are cached securely and never sold to third parties.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="pricing-section">
        <h2 className="section-title">Affordable Pricing Plans</h2>
        <p className="section-subtitle">
          Get started today and scale your support operations without paying per-agent fees.
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
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '12px', background: 'rgba(16, 185, 129, 0.08)', padding: '8px', borderRadius: '4px', borderLeft: '3.5px solid var(--primary)' }}>
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
                <span>Quick Replies Templates</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Real-Time Message Syncing</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Local Message Cache Store</span>
              </li>
            </ul>
            <button className="pricing-btn primary" onClick={onGoToDashboard}>
              Get Started Now
            </button>
          </div>

          {/* Unlimited Plan */}
          <div className="pricing-card glass">
            <div className="pricing-card-header">
              <div className="pricing-plan-name">Unlimited Plan</div>
              <div className="pricing-price">Rp 1.500.000<span>/bulan</span></div>
              <p className="pricing-desc">For scaling support centers and support teams.</p>
            </div>
            <ul className="pricing-features-list">
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>1 Active WhatsApp Number</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span><strong>Unlimited</strong> Support Agents</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Advanced Templates & Macros</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Real-Time Inbox Collaboration</span>
              </li>
              <li className="pricing-feature-item">
                <Check size={18} />
                <span>Priority Developer Support</span>
              </li>
            </ul>
            <button className="pricing-btn secondary" onClick={onGoToDashboard}>
              Upgrade to Unlimited
            </button>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section id="faq" className="faq-section">
        <h2 className="section-title">Frequently Asked Questions</h2>
        <p className="section-subtitle">Have questions about how it works? We have answers.</p>

        <div className="faq-list">
          <div className="faq-item">
            <div className="faq-question">How does it bypass the 4-device WhatsApp Web limit?</div>
            <div className="faq-answer">
              WhatsApp Web restricts a phone to 4 concurrent linked companion devices. Our gateway connects to your phone as **one** companion device. The gateway then distributes the live connection to unlimited web browsers, allowing as many agents as you want to chat simultaneously.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Do I need the official WhatsApp Business API (WABA)?</div>
            <div className="faq-answer">
              No. WABA requires complex setup, corporate approvals, and charges you per conversation. Our solution works by simply scanning a QR code (similar to logging into WhatsApp Web), meaning you can start using it in minutes with any existing WhatsApp number for free.
            </div>
          </div>

          <div className="faq-item">
            <div className="faq-question">Is my conversation data safe?</div>
            <div className="faq-answer">
              Yes, entirely. The server runs locally on your own hardware or server. All chats are saved to your local database rather than being stored on third-party cloud servers, ensuring compliance with data privacy regulations.
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div>© {new Date().getFullYear()} WAgateway. All rights reserved.</div>
        <div>Built for WhatsApp Business teams.</div>
      </footer>
    </div>
  );
}

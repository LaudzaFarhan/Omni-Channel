import React, { useState, useEffect } from 'react';
import { Send, Hash, Zap, Smartphone, Layers, CreditCard, ExternalLink, X, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import PlanPicker from './PlanPicker.jsx';

export default function Subscription({ userProfile, activeSessionCount, plans = [] }) {
  const [buying, setBuying] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [loadingTx, setLoadingTx] = useState(true);
  const [activePaymentModal, setActivePaymentModal] = useState(null);

  const limit = userProfile?.messageLimit ?? 500;
  const sent = userProfile?.messagesSent || 0;
  const percent = limit > 0 ? Math.min((sent / limit) * 100, 100) : 0;
  const sessionLimit = userProfile?.sessionLimit ?? 1;

  // `tier` predates the plans table and still holds 'free'/'premium' on older
  // accounts, so it doubles as the plan id until the customer is reassigned.
  const currentPlanId = userProfile?.planId || userProfile?.tier || 'free';
  const currentPlan = plans.find(p => p.id === currentPlanId);
  const currentPlanName = currentPlan?.name || currentPlanId;

  const loadServerTransactions = async () => {
    try {
      const res = await fetchWithAuth('/api/transactions');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setTransactions(data);
        }
      }
    } catch (e) {
      console.info('Could not load server transactions:', e.message);
    } finally {
      setLoadingTx(false);
    }
  };

  // Transactions now come from Postgres through the API. The Firestore listener
  // that used to mirror them is gone; the payment webhook emits 'payment-success'
  // to this user, which is the cue to refetch.
  useEffect(() => {
    if (!userProfile?.uid) return;

    loadServerTransactions();

    const handlePaymentSuccess = () => {
      loadServerTransactions();
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('payment-success', handlePaymentSuccess);
      attached = null;
      if (socket) {
        socket.on('payment-success', handlePaymentSuccess);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('payment-success', handlePaymentSuccess);
    };
  }, [userProfile?.uid]);

  // Start a Mayar checkout for a plan.
  //
  // Only the plan id and the chosen agent count are sent. The price comes from the
  // plans table server-side — this used to post an `amount`, which meant the
  // payload could be edited to buy a paid plan for a token sum.
  const handleInitiateMayarCheckout = async (planId, agents) => {
    if (buying || !userProfile?.uid) return;
    setBuying(true);

    try {
      const res = await fetchWithAuth('/api/mayar/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          agents === undefined ? { planId } : { planId, agents }
        )
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Anything the server flags as a setup problem: no key configured, or a key
        // the gateway refused. Neither is something the customer can act on, and
        // both used to arrive as "please try again", which sent them retrying a
        // request that could never succeed.
        if (res.status === 503
          || data.code === 'mayar_not_configured'
          || data.code === 'mayar_auth_failed'
          || data.code === 'mayar_endpoint_missing') {
          setActivePaymentModal({
            isConfigError: true,
            message: data.error || 'Payments are not configured on this server yet.',
          });
          return;
        }
        // Rejections the customer can understand and act on: already subscribed,
        // free plan, agent count out of range. These are not faults, so they get
        // the same panel rather than a browser alert.
        if (data.code === 'already_on_plan' || data.code === 'plan_is_free' || data.code === 'agents_out_of_range') {
          setActivePaymentModal({ isNotice: true, message: data.error });
          return;
        }
        // Everything else, including what the gateway itself said. Shown in the
        // panel rather than a browser alert, and with the provider's own wording,
        // because "could not start the payment" is not actionable by anyone.
        setActivePaymentModal({
          isFailure: true,
          message: data.error || `The server returned status ${res.status}.`,
          code: data.code,
        });
        return;
      }

      if (!data.paymentUrl) {
        setActivePaymentModal({
          isConfigError: true,
          message: 'The payment provider did not return a checkout link.',
        });
        return;
      }

      // Go straight to the gateway in this tab.
      //
      // This used to window.open() a new tab and leave a modal behind. Because the
      // call happens after an await, it is no longer inside the click's user-gesture
      // window, so browsers routinely block it — the customer clicked Pay, watched a
      // dialog appear, and never reached a payment page. A same-tab navigation cannot
      // be blocked, and Mayar returns them here when they are done.
      loadServerTransactions();
      window.location.assign(data.paymentUrl);
    } catch (err) {
      // A thrown error here is a network or parsing failure, not a gateway refusal.
      console.error('Mayar Checkout Error:', err);
      setActivePaymentModal({
        isFailure: true,
        message: `Could not reach the server: ${err.message}`,
      });
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Subscription & Transactions</h2>
        <p>Manage your account limits, purchase device licenses via Mayar Gateway, and view transaction records.</p>
      </div>
      
      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
        
        {/* Top Cards Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '24px' }}>
          
          {/* Message Usage Card */}
          <div className="card glass">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary)' }}>
                <Zap size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Message Quota Usage</h3>
                <span style={{ 
                  fontSize: '0.75rem', 
                  color: currentPlanId === 'free' ? '#f59e0b' : 'var(--primary)',
                  fontWeight: '700',
                  textTransform: 'uppercase'
                }}>
                  {currentPlanName} plan
                </span>
              </div>
            </div>
            
            <div className="usage-stats" style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
              <div className="stat-box" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Send size={22} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <span className="stat-label" style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Sent</span>
                  <div className="stat-value" style={{ fontSize: '1.2rem', fontWeight: '700' }}>{sent.toLocaleString()}</div>
                </div>
              </div>
              <div className="stat-box" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Hash size={22} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <span className="stat-label" style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Limit</span>
                  <div className="stat-value" style={{ fontSize: '1.2rem', fontWeight: '700' }}>{limit.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <div className="progress-container">
              <div className="progress-bar-bg" style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                <div 
                  className="progress-bar-fill" 
                  style={{ width: `${percent}%`, height: '100%', backgroundColor: percent >= 90 ? '#ef4444' : 'var(--primary)', transition: 'width 0.3s' }}
                ></div>
              </div>
              <p className="progress-text" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                {percent.toFixed(1)}% of quota used
              </p>
            </div>
          </div>

          {/* Device Sessions Card */}
          <div className="card glass">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', padding: '10px', borderRadius: '10px', color: 'var(--primary)' }}>
                <Smartphone size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Agent Access Slots</h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)' }}>Devices that can be signed in at the same time</span>
              </div>
            </div>

            <div className="usage-stats" style={{ display: 'flex', gap: '20px', marginBottom: '16px' }}>
              <div className="stat-box" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Smartphone size={22} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <span className="stat-label" style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Active</span>
                  <div className="stat-value" style={{ fontSize: '1.2rem', fontWeight: '700' }}>{activeSessionCount || 1}</div>
                </div>
              </div>
              <div className="stat-box" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px' }}>
                <Hash size={22} style={{ color: 'var(--text-muted)' }} />
                <div>
                  <span className="stat-label" style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Allowed</span>
                  <div className="stat-value" style={{ fontSize: '1.2rem', fontWeight: '700' }}>{sessionLimit}</div>
                </div>
              </div>
            </div>

            <p style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', margin: '18px 0 0', lineHeight: '1.5' }}>
              Need more? Pick a plan below and choose how many agents you want — extra
              agents are billed on the same invoice.
            </p>
          </div>

        </div>

        {/* Purchasable plans.
            These are read from the plan catalogue an admin maintains, so a plan
            created in the admin panel is immediately buyable. This used to be two
            buttons hardcoded to 'premium', which meant any other plan an admin
            added was invisible to customers. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
            <Layers size={20} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>Available Plans</h3>
          </div>

          <PlanPicker
            plans={plans}
            userProfile={userProfile}
            onCheckout={handleInitiateMayarCheckout}
            buying={buying}
          />
        </div>

        {/* Transaction History Section */}
        <div className="card glass">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <CreditCard size={20} style={{ color: 'var(--primary)' }} />
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700' }}>Transaction History</h3>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '12px' }}>
              Powered by Mayar Payment Gateway
            </span>
          </div>

          {loadingTx ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '30px' }}>
              <div className="spinner"></div>
            </div>
          ) : transactions.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  {/* Description absorbs the slack so the fixed-shape columns
                      (date, id, amount, status) never wrap. */}
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                    <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '1%' }}>Date</th>
                    <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '1%' }}>Transaction ID</th>
                    <th style={{ padding: '12px 14px' }}>Description</th>
                    <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '1%', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '1%' }}>Status</th>
                    <th style={{ padding: '12px 14px', whiteSpace: 'nowrap', width: '1%' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => {
                    const isPaid = (tx.status || '').toUpperCase() === 'PAID';
                    const isPending = (tx.status || '').toUpperCase() === 'PENDING';

                    return (
                      <tr key={tx.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '14px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                          {tx.createdAt ? new Date(tx.createdAt).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '14px', fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          {tx.transactionId || tx.id}
                        </td>
                        <td style={{ padding: '14px', fontWeight: '600' }}>
                          {tx.item || 'Payment Checkout'}
                        </td>
                        <td style={{ padding: '14px', fontWeight: '700', color: 'var(--primary)', whiteSpace: 'nowrap', textAlign: 'right' }}>
                          Rp {(tx.amount || 0).toLocaleString('id-ID')}
                        </td>
                        <td style={{ padding: '14px', whiteSpace: 'nowrap' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '0.75rem',
                            fontWeight: '700',
                            background: isPaid ? 'rgba(16,185,129,0.12)' : isPending ? 'rgba(245,158,11,0.12)' : 'rgba(239,68,68,0.12)',
                            color: isPaid ? 'var(--primary)' : isPending ? '#f59e0b' : '#ef4444',
                            border: `1px solid ${isPaid ? 'rgba(16,185,129,0.3)' : isPending ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`
                          }}>
                            {(tx.status || 'PENDING').toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '14px', whiteSpace: 'nowrap' }}>
                          {tx.paymentUrl ? (
                            <a 
                              href={tx.paymentUrl} 
                              target="_blank" 
                              rel="noreferrer"
                              style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                gap: '4px',
                                color: 'var(--primary)',
                                fontSize: '0.82rem',
                                textDecoration: 'none',
                                fontWeight: '600'
                              }}
                            >
                              Pay Now <ExternalLink size={12} />
                            </a>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>Completed</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '36px', color: 'var(--text-dimmed)', fontSize: '0.9rem' }}>
              No transaction records yet. Choose a plan under <strong>Available Plans</strong> above to start a checkout.
            </div>
          )}
        </div>

      </div>

      {/* Mayar Payment Checkout Modal */}
      {activePaymentModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div className="glass" style={{
            width: '100%',
            maxWidth: '460px',
            padding: '28px',
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
            background: 'var(--bg-main)',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <CreditCard size={20} style={{ color: 'var(--primary)' }} /> Mayar Payment Checkout
              </h3>
              <button 
                onClick={() => setActivePaymentModal(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {activePaymentModal.isFailure ? (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px', color: '#ef4444' }}>
                    <AlertCircle size={18} /> Checkout could not start
                  </div>
                  <div style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: '1.55' }}>
                    {activePaymentModal.message}
                  </div>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-dimmed)', lineHeight: '1.55' }}>
                  Nothing was charged, and no payment was recorded against your account.
                </div>
                <button
                  onClick={() => setActivePaymentModal(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    padding: '10px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  Close
                </button>
              </>
            ) : activePaymentModal.isNotice ? (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)', fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: '1.55' }}>
                  {activePaymentModal.message}
                </div>
                <button
                  onClick={() => setActivePaymentModal(null)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-muted)',
                    padding: '10px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  Close
                </button>
              </>
            ) : activePaymentModal.isConfigError ? (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.95rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={18} /> Mayar Payment Setup Required
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                    To process live transactions automatically, add your <strong>MAYAR_PAYMENT_LINK</strong> (or Mayar Secret API Key) to your project's <code>.env</code> file.
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <a 
                    href="https://mayar.id" 
                    target="_blank" 
                    rel="noreferrer"
                    className="upgrade-btn"
                    style={{ textAlign: 'center', textDecoration: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '12px' }}
                  >
                    Open Mayar Dashboard <ExternalLink size={16} />
                  </a>

                  <button 
                    onClick={() => setActivePaymentModal(null)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(0,168,132,0.06)', border: '1px solid rgba(0,168,132,0.2)' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Checkout Invoice ID:</div>
                  <div style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: '0.95rem', color: 'var(--primary)' }}>
                    {activePaymentModal.transactionId}
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: '800', marginTop: '8px', color: 'var(--text-main)' }}>
                    Rp {activePaymentModal.amount.toLocaleString('id-ID')}
                  </div>
                </div>

                <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Complete your payment using <strong>QRIS, GoPay, OVO, Virtual Account (BCA, Mandiri, BRI, BNI), or Credit Card</strong> via the official Mayar Gateway link below.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <a 
                    href={activePaymentModal.paymentUrl} 
                    target="_blank" 
                    rel="noreferrer"
                    className="upgrade-btn"
                    style={{ textAlign: 'center', textDecoration: 'none', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '12px' }}
                  >
                    Open Mayar Checkout Page <ExternalLink size={16} />
                  </a>

                  <button 
                    onClick={() => setActivePaymentModal(null)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.85rem'
                    }}
                  >
                    Close & View Transactions
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

import React from 'react';
import { Clock, ArrowLeft } from 'lucide-react';

/**
 * Stands in for a feature an admin has marked as coming soon.
 *
 * A visible-but-unusable feature needs somewhere to land, otherwise clicking the nav item
 * would show an empty pane that reads as a bug. This says the feature is real, that it is
 * not ready, and offers the way back — which matters because the nav item stays selected.
 *
 * It never explains WHY. The admin's note is internal: a customer being told "waiting on
 * template approval" learns about our problems, not about their product.
 */
export default function ComingSoon({ label = 'This feature', onBack }) {
  return (
    <div className="view-container">
      <div className="coming-soon-card">
        <div className="coming-soon-icon">
          <Clock size={30} />
        </div>

        <h2>{label} is coming soon</h2>
        <p>
          We are still building this one. It will appear here automatically once it is ready —
          there is nothing you need to do, and nothing to install.
        </p>

        {onBack && (
          <button type="button" className="coming-soon-back" onClick={onBack}>
            <ArrowLeft size={15} /> Back to conversations
          </button>
        )}
      </div>
    </div>
  );
}

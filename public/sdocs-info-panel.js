// Shared Information panel for the document reader, Library and Settings.
(function () {
  'use strict';
  if (document.getElementById('_sd_info-panel')) return;
  var host = document.getElementById('_sd_main') || document.body;
  host.insertAdjacentHTML('beforeend', `
  <div id="_sd_info-panel">
    <div id="_sd_info-panel-header">
      <span class="sdocs-sheet-title">Information</span>
      <button class="sdocs-sheet-close" id="_sd_info-panel-close" type="button" aria-label="Close information panel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
    <div id="_sd_info-panel-body">
      <div class="info-section">
        <div class="info-section-title">Community</div>
        <p class="info-section-text">Questions, ideas, or want to follow along? <a href="https://discord.gg/txjATTsDaq" target="_blank" rel="noopener">Join our Discord</a>.</p>
      </div>
      <div class="info-settings">
        <div class="info-settings-row">
          <span class="info-settings-label">Notify me about new features</span>
          <div class="toggle-group info-settings-toggle" role="radiogroup" aria-label="Notify me about new features">
            <button class="btn" id="_sd_info-notify-on" role="radio" aria-checked="true">On</button>
            <button class="btn" id="_sd_info-notify-off" role="radio" aria-checked="false">Off</button>
          </div>
        </div>
        <p class="info-settings-help">When off, the info icon won't show a dot for unseen updates. Open this panel any time to check.</p>
      </div>
      <div class="info-section">
        <div class="info-section-title">New features</div>
        <ul id="_sd_info-features" class="info-feature-list"></ul>
      </div>
      <div class="info-section">
        <div class="info-section-title">Blog posts</div>
        <ul class="info-links">
          <li><a href="/blogs/journey-to-pdf-generation" target="_blank" rel="noopener">The surprisingly complex journey to text-selectable client-side generated PDFs</a><span class="info-links-desc">How we built selectable-text PDFs in the browser.</span></li>
        </ul>
      </div>
      <div class="info-section">
        <div class="info-section-title">Feedback</div>
        <textarea id="_sd_info-feedback" rows="6" placeholder="Tell us what's working, what's broken, what you'd like to see."></textarea>
        <p id="_sd_info-feedback-warning" class="info-feedback-warning" hidden>
          That looks like an email address. Feedback is displayed publicly, so remove it if you don't want it shared.
        </p>
        <div class="info-feedback-actions">
          <button class="btn" id="_sd_info-feedback-send">Send</button>
          <span id="_sd_info-feedback-status" class="info-feedback-status" aria-live="polite"></span>
        </div>
        <p class="info-feedback-note">
          Displayed publicly at <a href="/feedback" target="_blank" rel="noopener">smalldocs.org/feedback</a>.
          Stored in a small SQLite database on our server. We store the message and a timestamp, nothing else. Don't include personal info.
        </p>
      </div>
      <div class="info-section">
        <div class="info-section-title">Links</div>
        <ul class="info-links">
          <li><a href="/feedback" target="_blank" rel="noopener">Read feedback</a><span class="info-links-desc">What other users have sent in.</span></li>
          <li><a href="/analytics" target="_blank" rel="noopener">Analytics</a><span class="info-links-desc">Visit counts, cohorts, devices.</span></li>
          <li><a href="https://smalldocs.org/" target="_blank" rel="noopener">Learn about SmallDocs</a><span class="info-links-desc">How the app works and why.</span></li>
        </ul>
      </div>
    </div>
  </div>
`);
})();

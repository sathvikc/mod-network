/**
 * In-Tab Active Visual Indicator
 * Injected into all frames on document_idle.
 */

(async () => {
  // Prevent double injection
  if (window.__modnetworkIndicatorInjected) return;
  window.__modnetworkIndicatorInjected = true;

  try {
    // Determine if ModNetwork is actively intercepting this specific URL
    const response = await chrome.runtime.sendMessage({ 
      type: 'CHECK_ACTIVE_STATUS', 
      url: window.location.href 
    });

    if (response && response.active) {
      injectIndicatorUI();
    }
  } catch (e) {
    // Background script might be unavailable (e.g., extension reloaded)
    console.debug('[ModNetwork] Extension unavailable for status check.');
  }

  function injectIndicatorUI() {
    // 1. Inject Persistent Glow Bar
    const glow = document.createElement('div');
    glow.className = 'modnetwork-active-glow-bar';
    document.body.appendChild(glow);

    // 2. Inject Ephemeral Toast
    const toastContainer = document.createElement('div');
    toastContainer.className = 'modnetwork-toast-container';
    toastContainer.innerHTML = `
      <div class="modnetwork-toast">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        <div class="modnetwork-toast-text">
          <span>ModNetwork Active</span>
          <span class="modnetwork-toast-subtitle">Top border glow signifies active rules.</span>
        </div>
      </div>
    `;
    document.body.appendChild(toastContainer);

    // Trigger Toast animation
    // Slight delay to allow CSS transitions to register
    requestAnimationFrame(() => {
      setTimeout(() => {
        toastContainer.classList.add('show');
      }, 50);
    });

    // Remove Toast after 4 seconds
    setTimeout(() => {
      toastContainer.classList.remove('show');
      // Wait for exit animation to finish before destroying DOM node
      setTimeout(() => {
        toastContainer.remove();
      }, 500);
    }, 4000);
  }
})();

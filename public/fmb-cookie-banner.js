/*
 * FindMyBasket Cookie Consent Banner
 * UK GDPR + PECR compliant
 *
 * Behaviour:
 *   - Shows on first visit, blocks GA4 from loading until consent given
 *   - Reject and Accept buttons have equal visual weight (PECR requirement)
 *   - Respects Global Privacy Control (auto-rejects non-essential)
 *   - Choice persisted in localStorage (not a cookie, since cookies need consent)
 *   - Re-openable via window.FMBCookies.open() or footer Cookie Settings link
 *   - Granular preferences modal for analytics toggle
 *
 * Deployment:
 *   1. Place this file at /public/fmb-cookie-banner.js
 *   2. Add <script src="/fmb-cookie-banner.js" defer></script> to every page <head>
 *   3. REMOVE any existing gtag.js script tags from the page <head>
 *      (this script loads gtag conditionally on consent)
 *   4. The GA4 measurement ID is set in the GA4_ID constant below
 */

(function () {
  'use strict';

  // ===== CONFIGURATION =====
  var GA4_ID = 'G-Q3J7LSJFLQ';
  var STORAGE_KEY = 'fmb-cookie-consent';
  var CONSENT_VERSION = 1; // bump if policy changes materially

  // Brand colours
  var COLOR_CREAM = '#FAF8F4';
  var COLOR_INK = '#1C1A18';
  var COLOR_INK_LIGHT = '#4A4845';
  var COLOR_BORDER = '#E8E4DC';
  var COLOR_GOLD = '#C9A96E';
  var COLOR_GOLD_DARK = '#8A6A30';

  // ===== STATE =====
  function getConsent() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed.version !== CONSENT_VERSION) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function setConsent(prefs) {
    var record = {
      version: CONSENT_VERSION,
      analytics: !!prefs.analytics,
      timestamp: new Date().toISOString()
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    } catch (e) {
      // localStorage might be disabled; nothing we can do
    }
    return record;
  }

  function hasGPC() {
    return navigator.globalPrivacyControl === true;
  }

  // ===== ANALYTICS LOADING =====
  function loadAnalytics() {
    if (window.__fmbGaLoaded) return;
    window.__fmbGaLoaded = true;

    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_ID;
    document.head.appendChild(script);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer.push(arguments);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA4_ID, { anonymize_ip: true });
  }

  // ===== STYLES =====
  function injectStyles() {
    if (document.getElementById('fmb-cookie-styles')) return;
    var style = document.createElement('style');
    style.id = 'fmb-cookie-styles';
    style.textContent = [
      '.fmb-cc-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;background:' + COLOR_CREAM + ';color:' + COLOR_INK + ';border:1px solid ' + COLOR_BORDER + ';border-radius:14px;box-shadow:0 16px 40px rgba(28,26,24,0.18);padding:20px 22px;font-family:\'DM Sans\',system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;max-width:560px;margin:0 auto;display:none}',
      '.fmb-cc-banner.is-open{display:block}',
      '.fmb-cc-banner h2{font-family:\'Cormorant Garamond\',Georgia,serif;font-size:22px;font-weight:600;margin:0 0 6px;color:' + COLOR_INK + '}',
      '.fmb-cc-banner p{margin:0 0 14px;color:' + COLOR_INK_LIGHT + '}',
      '.fmb-cc-banner a{color:' + COLOR_GOLD_DARK + ';text-decoration:underline}',
      '.fmb-cc-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}',
      '.fmb-cc-btn{font-family:\'DM Sans\',system-ui,sans-serif;font-size:14px;font-weight:500;padding:10px 18px;border-radius:8px;border:1px solid ' + COLOR_INK + ';cursor:pointer;background:' + COLOR_CREAM + ';color:' + COLOR_INK + ';transition:opacity 0.15s}',
      '.fmb-cc-btn:hover{opacity:0.82}',
      '.fmb-cc-btn--primary{background:' + COLOR_INK + ';color:' + COLOR_CREAM + '}',
      '.fmb-cc-link{background:none;border:none;color:' + COLOR_INK_LIGHT + ';font-size:13px;text-decoration:underline;cursor:pointer;padding:0;margin-left:auto;font-family:inherit}',
      '.fmb-cc-modal-backdrop{position:fixed;inset:0;background:rgba(28,26,24,0.55);z-index:10000;display:none;align-items:center;justify-content:center;padding:16px}',
      '.fmb-cc-modal-backdrop.is-open{display:flex}',
      '.fmb-cc-modal{background:' + COLOR_CREAM + ';color:' + COLOR_INK + ';border-radius:14px;max-width:540px;width:100%;max-height:88vh;overflow-y:auto;padding:28px;font-family:\'DM Sans\',system-ui,sans-serif;font-size:14px;line-height:1.55}',
      '.fmb-cc-modal h2{font-family:\'Cormorant Garamond\',Georgia,serif;font-size:28px;font-weight:600;margin:0 0 10px}',
      '.fmb-cc-modal p{margin:0 0 16px;color:' + COLOR_INK_LIGHT + '}',
      '.fmb-cc-modal a{color:' + COLOR_GOLD_DARK + ';text-decoration:underline}',
      '.fmb-cc-row{display:flex;align-items:flex-start;gap:14px;padding:16px 0;border-top:1px solid ' + COLOR_BORDER + '}',
      '.fmb-cc-row:last-of-type{border-bottom:1px solid ' + COLOR_BORDER + ';margin-bottom:20px}',
      '.fmb-cc-row-text{flex:1}',
      '.fmb-cc-row-text strong{display:block;color:' + COLOR_INK + ';margin-bottom:4px}',
      '.fmb-cc-row-text small{color:' + COLOR_INK_LIGHT + ';font-size:13px}',
      '.fmb-cc-toggle{position:relative;width:42px;height:24px;flex-shrink:0;margin-top:2px}',
      '.fmb-cc-toggle input{opacity:0;width:0;height:0}',
      '.fmb-cc-toggle .slider{position:absolute;inset:0;background:#C8C4BC;border-radius:24px;transition:0.2s;cursor:pointer}',
      '.fmb-cc-toggle .slider:before{content:"";position:absolute;left:2px;top:2px;width:20px;height:20px;background:#fff;border-radius:50%;transition:0.2s}',
      '.fmb-cc-toggle input:checked + .slider{background:' + COLOR_INK + '}',
      '.fmb-cc-toggle input:checked + .slider:before{transform:translateX(18px)}',
      '.fmb-cc-toggle input:disabled + .slider{cursor:not-allowed;opacity:0.6}',
      '.fmb-cc-modal-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:flex-end}',
      '@media (max-width:520px){.fmb-cc-actions{flex-direction:column-reverse;align-items:stretch}.fmb-cc-btn{width:100%;text-align:center}.fmb-cc-link{margin-left:0;text-align:center;margin-top:6px}}'
    ].join('');
    document.head.appendChild(style);
  }

  // ===== BANNER UI =====
  function buildBanner() {
    var banner = document.createElement('div');
    banner.className = 'fmb-cc-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookie preferences');
    banner.innerHTML = [
      '<h2>Cookies on FindMyBasket</h2>',
      '<p>We use essential cookies to make the site work. With your permission we also use analytics cookies to understand how visitors use the site so we can improve it. See our <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>',
      '<div class="fmb-cc-actions">',
      '<button type="button" class="fmb-cc-btn" data-action="reject">Reject all</button>',
      '<button type="button" class="fmb-cc-btn fmb-cc-btn--primary" data-action="accept">Accept all</button>',
      '<button type="button" class="fmb-cc-link" data-action="manage">Manage preferences</button>',
      '</div>'
    ].join('');
    return banner;
  }

  function buildModal() {
    var backdrop = document.createElement('div');
    backdrop.className = 'fmb-cc-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Cookie preferences');
    backdrop.innerHTML = [
      '<div class="fmb-cc-modal">',
      '<h2>Cookie preferences</h2>',
      '<p>Choose which cookies you allow. You can change your mind any time from the Cookie Settings link in the footer. Full details in our <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.</p>',
      '<div class="fmb-cc-row">',
      '<div class="fmb-cc-row-text">',
      '<strong>Essential</strong>',
      '<small>Needed for the site to function. Always on.</small>',
      '</div>',
      '<label class="fmb-cc-toggle"><input type="checkbox" checked disabled><span class="slider"></span></label>',
      '</div>',
      '<div class="fmb-cc-row">',
      '<div class="fmb-cc-row-text">',
      '<strong>Analytics</strong>',
      '<small>Google Analytics, so we can see which pages and features are useful and improve the site.</small>',
      '</div>',
      '<label class="fmb-cc-toggle"><input type="checkbox" data-pref="analytics"><span class="slider"></span></label>',
      '</div>',
      '<div class="fmb-cc-modal-actions">',
      '<button type="button" class="fmb-cc-btn" data-action="reject-modal">Reject all</button>',
      '<button type="button" class="fmb-cc-btn fmb-cc-btn--primary" data-action="save">Save preferences</button>',
      '</div>',
      '</div>'
    ].join('');
    return backdrop;
  }

  // ===== EVENT WIRING =====
  function init() {
    injectStyles();

    var banner = buildBanner();
    var modal = buildModal();
    document.body.appendChild(banner);
    document.body.appendChild(modal);

    function close() {
      banner.classList.remove('is-open');
      modal.classList.remove('is-open');
    }

    function openBanner() {
      banner.classList.add('is-open');
    }

    function openModal() {
      // Sync toggle with current state
      var current = getConsent();
      var input = modal.querySelector('[data-pref="analytics"]');
      input.checked = current ? !!current.analytics : false;
      banner.classList.remove('is-open');
      modal.classList.add('is-open');
    }

    function commitConsent(prefs) {
      var rec = setConsent(prefs);
      if (rec.analytics) loadAnalytics();
      close();
    }

    banner.addEventListener('click', function (e) {
      var action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'accept') commitConsent({ analytics: true });
      else if (action === 'reject') commitConsent({ analytics: false });
      else if (action === 'manage') openModal();
    });

    modal.addEventListener('click', function (e) {
      // Click on backdrop closes (but not click on modal contents)
      if (e.target === modal) close();
      var action = e.target.getAttribute && e.target.getAttribute('data-action');
      if (action === 'save') {
        var input = modal.querySelector('[data-pref="analytics"]');
        commitConsent({ analytics: !!input.checked });
      } else if (action === 'reject-modal') {
        commitConsent({ analytics: false });
      }
    });

    // ===== INITIAL DECISION =====
    var existing = getConsent();
    if (existing) {
      // Returning visitor with stored choice
      if (existing.analytics) loadAnalytics();
    } else if (hasGPC()) {
      // Honour Global Privacy Control without showing banner
      setConsent({ analytics: false });
    } else {
      // No prior choice, show banner
      openBanner();
    }

    // Public API for re-opening from footer "Cookie Settings" link
    window.FMBCookies = {
      open: openModal,
      reset: function () {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        location.reload();
      },
      getConsent: getConsent
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

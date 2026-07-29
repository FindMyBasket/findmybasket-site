/*
 * FindMyBasket GA4 queue stub
 *
 * Defines window.gtag and window.dataLayer EARLY, before React hydration, so
 * that an event fired from a mount effect has somewhere to go. It does NOT load
 * gtag.js and does NOT read or write consent. Nothing here touches the device:
 * no cookie, no network request, no storage. It defines a function and an array
 * in memory, so PECR is not engaged and the legal position is identical to
 * having no analytics at all until fmb-cookie-banner.js decides otherwise.
 *
 * WHY THIS EXISTS. Every tracker in lib/analytics.ts opens with
 * `if (typeof gtag !== 'function') return`. The consent banner is what defines
 * window.gtag, and in the Next.js app it loads with strategy="afterInteractive",
 * which runs AFTER hydration. So any event fired from a mount effect ran first,
 * found no gtag, and was dropped silently: no error, no warning, no retry. That
 * cost the GA4 `search` event entirely (0 against 41 server-side rows in the
 * same week) and an unknown share of `view_item`. See
 * docs/ticket-gtag-hydration-race.md.
 *
 * DO NOT "fix" this by moving fmb-cookie-banner.js to beforeInteractive. That
 * was evaluated and declined: it would load gtag.js and set _ga cookies before
 * consent, which is what PECR Regulation 6 prohibits. Loading the QUEUE early
 * and loading GTAG.JS early are different acts and only one of them is lawful
 * here.
 *
 * Load order, both surfaces, one file so they cannot drift:
 *   Next.js app  inlined into the server HTML by app/layout.tsx, as the first
 *                child of body. See the comment there for why it is inlined
 *                rather than loaded with next/script beforeInteractive.
 *   Static pages a plain script src tag, placed before the banner tag.
 *
 * NOTHING IN THIS FILE MAY CONTAIN THE LITERAL CLOSING SCRIPT TAG, not even
 * inside a comment or a string. This file is inlined into HTML, and an HTML
 * parser ends a script element at the first such sequence regardless of
 * JavaScript context. An occurrence in this comment would truncate the inlined
 * block part-way through and dump the remainder into the page as text, leaving
 * window.gtag undefined and silently restoring the very bug this file fixes.
 * That happened once already, on 29 July, caught only by reading the emitted
 * HTML. app/layout.tsx escapes the sequence defensively and
 * scripts/gtag-stub.test.mjs fails if one appears here, so this is belt and
 * braces, but write around it anyway.
 */
(function () {
  'use strict';

  // Bound on how many events may queue before consent is decided. A visitor who
  // never answers the banner and browses at length would otherwise grow the
  // queue without limit. Dropping is the safe direction: a dropped event is a
  // measurement lost, a transmitted one could be a measurement the user
  // declined.
  var QUEUE_LIMIT = 50;

  window.dataLayer = window.dataLayer || [];

  function noop() {}

  var state = {
    // false until the banner calls resolve(). While false, the cap applies.
    // AFTER consent is granted the cap must be lifted, because gtag.js keeps
    // pushing to dataLayer for the life of the page and a live cap would
    // silently stop analytics at the 50th event of a consenting session.
    resolved: false,
    granted: false,
    dropped: 0,
  };

  // Named and kept, because refusal swaps it out for a no-op and a later
  // acceptance has to swap it back. Without a handle on the original, accepting
  // after a refusal would leave gtag inert and analytics silently dead for the
  // rest of the page, which is a worse outcome than the bug this file fixes.
  function pusher() {
    if (!state.resolved && window.dataLayer.length >= QUEUE_LIMIT) {
      state.dropped++;
      return;
    }
    window.dataLayer.push(arguments);
  }

  window.gtag = pusher;

  window.FMBGtag = {
    QUEUE_LIMIT: QUEUE_LIMIT,

    // Read by the tests and useful in the console. Not used for control flow.
    state: state,

    /*
     * The single place a consent outcome is acted on.
     *
     * The banner has FOUR independent decision points and, before this existed,
     * only the granting ones did anything: refusal simply did not call
     * loadAnalytics. That is no longer sufficient, because refusal must now
     * actively DISCARD a queue that has already accumulated. Adding discard
     * logic at each site would have meant three chances to miss one, and a
     * missed one fails silently with a live queue, which is the exact shape
     * this codebase has hit repeatedly. So every path calls this instead.
     *
     * onGrant is the banner's loadAnalytics. Passed in rather than imported so
     * this file stays free of DOM and consent storage, and therefore testable.
     */
    resolve: function (granted, onGrant) {
      if (granted) {
        // A second grant in the same page (for example opening Cookie Settings
        // and saving again with analytics still on) must not replay the queue a
        // second time and double every event.
        if (state.resolved && state.granted) return;

        var queued = window.dataLayer.slice();

        // Clear BEFORE loading gtag.js. gtag.js processes dataLayer in order,
        // so anything sitting ahead of the `config` call is mis-attributed or
        // dropped. Capture, clear, config, then replay puts them in the only
        // order that works.
        window.dataLayer.length = 0;

        // Lift the cap BEFORE the replay, or a full 50-entry queue would be
        // capped again on the way back in and the replay would drop everything.
        state.resolved = true;
        state.granted = true;

        // Restore the pusher. This matters on the refuse-then-accept path: a
        // refusal set gtag to a no-op, and onGrant below calls gtag('js') and
        // gtag('config'), so without this the acceptance would configure
        // nothing and every later event would vanish. Caught by the gate test,
        // which is the only one that exercises this order.
        window.gtag = pusher;

        if (typeof onGrant === 'function') onGrant();

        // Push directly rather than through window.gtag: these are already
        // `arguments` objects in gtag's own wire format.
        for (var i = 0; i < queued.length; i++) window.dataLayer.push(queued[i]);
        return;
      }

      // ===== REFUSAL. The half with legal consequence. =====
      // BOTH operations are required and neither is sufficient alone.
      //
      // Truncating without replacing gtag leaves the stub still queueing, so a
      // later acceptance through Cookie Settings would replay events gathered
      // during the refused period and transmit data the user declined. That is
      // a UK GDPR problem arriving by a back door.
      //
      // Replacing gtag without truncating leaves the already-queued events in
      // dataLayer for the same later acceptance to find.
      window.dataLayer.length = 0;
      window.gtag = noop;
      state.resolved = true;
      state.granted = false;
    },
  };
})();

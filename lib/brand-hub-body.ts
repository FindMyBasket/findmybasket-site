import sanitizeHtml from 'sanitize-html';

// Sanitiser for brand_hubs.body_html (long-form spotlight editorial).
//
// body_html is trusted-author content, seeded by us, never user input. We
// sanitise anyway, and we do it at RENDER rather than only at write, so the
// guarantee holds no matter how a row reached the table.
//
// The allowlist is deliberately the minimum the spotlight body needs. Adding a
// tag here is a content decision, so make it explicitly rather than widening
// the list to "whatever the draft happened to contain".
const ALLOWED_TAGS = ['p', 'h2', 'strong', 'em', 'a'];

// NOTE: sanitize-html's own default for <a> is ['href', 'name', 'target'] -
// it does NOT include rel. Relying on the default would silently strip
// rel="sponsored nofollow noopener" from every affiliate link, which breaks
// affiliate disclosure compliance and, combined with target="_blank", opens a
// reverse-tabnabbing hole. rel is allowlisted explicitly for that reason.
const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
  a: ['href', 'rel', 'target'],
};

// Outbound links may only be https. Internal comparison links are relative
// ('/product/123', '/brands/abib', '/app') and carry no scheme, which
// allowedSchemes does not govern; allowProtocolRelative: false stops
// '//evil.example' being read as a relative path.
const ALLOWED_SCHEMES = ['https'];

// Any link that opens a new tab must carry noopener, else the opened page gets
// a live window.opener handle back to ours. The seeded body already sets it;
// this enforces it rather than trusting the row, and preserves the authored
// rel tokens (sponsored, nofollow) alongside.
function enforceBlankTargetRel(
  tagName: string,
  attribs: Record<string, string>
): sanitizeHtml.Tag {
  if (attribs.target !== '_blank') return { tagName, attribs };

  const tokens = new Set((attribs.rel ?? '').split(/\s+/).filter(Boolean));
  tokens.add('noopener');

  return { tagName, attribs: { ...attribs, rel: Array.from(tokens).join(' ') } };
}

export function sanitizeBrandHubBody(html: string | null): string {
  if (!html) return '';

  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    allowProtocolRelative: false,
    // Drop the contents of disallowed tags entirely rather than leaking inner
    // text, so a stray <script> cannot surface its source as body copy.
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
    transformTags: { a: enforceBlankTargetRel },
  });
}

-- Gorgeous Shop (r30) base_url: .co.uk -> .com
--
-- The onboarding migration guessed 'https://www.gorgeousshop.co.uk'. DNS
-- resolves for that host, which is why it survived the check I ran, but it is
-- not the store. Every deeplink in the feed points at gorgeousshop.COM, and
-- fetching one confirms it:
--   https://www.gorgeousshop.com/medik8-double-c-tetra-serum-30ml
--   -> 200, "Medik8 C Tetra Serum 30ml Double | Gorgeous Shop"
--
-- Lesson for the next onboarding: take base_url from a deeplink in the feed,
-- not from a plausible-looking domain. DNS resolution is not evidence that a
-- host is the merchant's storefront.

UPDATE public.retailers
   SET base_url = 'https://www.gorgeousshop.com'
 WHERE id = 30
   AND base_url IS DISTINCT FROM 'https://www.gorgeousshop.com';

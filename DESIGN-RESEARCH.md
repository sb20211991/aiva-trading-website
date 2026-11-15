# Aiva website: V6 design and enquiry review

Applied research:
- Nielsen Norman Group: https://www.nngroup.com/articles/principles-visual-design/ — stronger hierarchy, coherent scale and contrast.
- W3C: https://www.w3.org/WAI/tutorials/forms/notifications/ — clear completion and error states; never label a draft as sent.
- Google: https://web.dev/articles/payment-and-address-form-best-practices — semantic labels, stable fields, useful autocomplete and mobile input sizing.

Changes: primary hero action starts an enquiry; clearer business proposition; larger navigation and supporting text; aligned desktop cards; mobile actions and wrapped navigation; 16px form controls; reduced-motion support; consistent buyer/supplier review instructions; visible fallback contact and copying guidance.

Delivery boundary: this is a static Cloudflare Pages website. It does not submit messages to an email service. A user must press Send in their chosen email or WhatsApp app. No success state claims receipt. Actual inbox receipt has not been verified. The connected Gmail account is not the destination business inbox. Direct website submission would require an authenticated delivery service, a verified recipient and appropriate spam controls; no service was provisioned or paid for.

Evidence boundary: no customer testimonials, certifications, completed projects, stock, prices or delivery promises have been invented. Source imagery remains illustrative.

Validation: JavaScript syntax and automated shortlist/search/long-message checks passed. Browser preview verified homepage rendering, shortlist-only buyer draft and supplier draft creation. Actual email/WhatsApp sends, receipt and physical-device mobile testing remain unverified.

V7: sample selection and enquiry-intent prefill added. Official registration could not be verified; evidence search found no usable customer case studies. Available Stripe account is test-only. New sample-page browser inspection was blocked by a local preview connection refusal; JavaScript and static checks passed. Product marking reference: https://www.gov.uk/guidance/product-safety-law-compliance-advice-for-manufacturers-and-importers

V8 verification: browser inspected samples and buying-guide layouts; sample link correctly prefilled Energy & power, Portable power stations, Sample request and quantity 1; buyer draft generated with these values. All local references and anchors checked. Gmail excluded. Physical mobile testing and live checkout are not verified.

V9 category upgrade: built-in image generator created six illustrative category assets, using ivory studio backgrounds, emerald accents and unbranded category products. Saved WebP assets: vehicles, scooters, parts, computing, barber-beauty, home-essentials. Existing three photo cards retained. Six detail pages added. Browser confirmed nine card images, zero icon cards and correct barber sample-prefill. All local references, fragments and unique IDs passed. Gmail untouched; no live deployment performed.

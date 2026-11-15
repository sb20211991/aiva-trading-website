/* Aiva Trading language selector: Google Translate Websites (external service).
 * Does not claim native or indexed translations. Google may restrict availability
 * by region or change its translated-site service independently of Aiva.
 */
(function () {
  'use strict';
  var selector = document.getElementById('aiva-language-switcher');
  if (!selector) return;
  var supported = Array.prototype.map.call(selector.options, function(o){return o.value;});
  // Preserve a language label when arriving via an optional language hint.
  var param = new URLSearchParams(location.search).get('lang');
  if (param && supported.indexOf(param) !== -1) selector.value = param;
  selector.addEventListener('change', function () {
    var lang = selector.value;
    if (supported.indexOf(lang) === -1) return;
    var original = new URL(location.href);
    original.searchParams.delete('lang');
    // If the visitor selects English, show the original native website.
    if (lang === 'en') { location.assign(original.href); return; }
    // Google Translate's Websites service renders a translated page in the same tab.
    // Aiva's forms, payments and business-critical wording remain authoritative in English.
    var target = new URL('https://translate.google.com/translate');
    target.searchParams.set('sl', 'en');
    target.searchParams.set('tl', lang);
    target.searchParams.set('u', original.href);
    location.assign(target.href);
  });
})();

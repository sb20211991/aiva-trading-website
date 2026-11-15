const businessEmail = 'mailto:Aivatradingltd2026@gmail.com';
document.getElementById('year').textContent = new Date().getFullYear();

const form = document.querySelector('#brief');
const product = document.querySelector('#product');
const shortlist = [...form.querySelectorAll('[name="shortlist"]')];
const buyerPreview = document.querySelector('#buyer-preview');
const buyerMessage = document.querySelector('#buyer-message');
const buyerStatus = document.querySelector('#status');
const enquiryParams = new URLSearchParams(location.search);
const incomingItem = shortlist.find(item => item.value === enquiryParams.get('item'));
if (incomingItem) {
  incomingItem.checked = true;
  const category = enquiryParams.get('category');
  if ([...form.elements.category.options].some(option => option.value === category)) {
    form.elements.category.value = category;
  }
}

document.querySelectorAll('[data-category]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    form.elements.category.value = link.dataset.category;
    if (link.dataset.productName) product.value = link.dataset.productName;
    history.replaceState(null, '', '#enquiry');
    document.querySelector('#enquiry').scrollIntoView();
    buyerPreview.hidden = true;
    product.focus({ preventScroll: true });
  });
});

form.addEventListener('change', event => { if (event.target === buyerMessage) return; buyerPreview.hidden = true; });
form.addEventListener('input', event => {
  if (event.target === buyerMessage) return;
  buyerPreview.hidden = true;
  buyerStatus.textContent = '';
});

form.addEventListener('submit', event => {
  event.preventDefault();
  product.required = false;
  product.setCustomValidity('');
  if (!form.reportValidity()) return;
  const selected = shortlist.filter(item => item.checked).map(item => item.value);
  if (!product.value.trim() && !selected.length && !selectedRanges.size) {
    buyerStatus.textContent = 'Choose a sourcing range above, select a common product, or enter a product/project name.';
    product.focus();
    return;
  }
  const fields = [
    ['Contact name', 'contactName'],
    ['Company', 'contactCompany'],
    ['Reply email', 'contactEmail'],
    ['Category', 'category'],
    ['Quantity', 'quantity'],
    ['Delivery country', 'destination'],
    ['Additional requirements', 'details']
  ];
  const lines = fields.map(([label, field]) => {
    return label + ': ' + (form.elements[field].value.trim() || 'To be confirmed');
  });
  if (selectedRanges.size) lines.unshift('Sourcing ranges: ' + [...selectedRanges].join(', '));
  if (selected.length) lines.unshift('Product shortlist: ' + selected.join(', '));
  if (product.value.trim()) lines.unshift('Other product or project: ' + product.value.trim());
  buyerMessage.value = ['Aiva Trading Limited sourcing enquiry', '', ...lines].join('\n');
  const email = document.querySelector('#buyer-email');
  const whatsapp = document.querySelector('#buyer-whatsapp');
  const emailBase = businessEmail + '?subject=Aiva%20Trading%20sourcing%20enquiry';
  const whatsappBase = document.querySelector('#contact a[href^="https://wa.me/"]').href;
  const encodedBody = encodeURIComponent(buyerMessage.value);
  const emailDraft = emailBase + '&body=' + encodedBody;
  const whatsappDraft = whatsappBase + '?text=' + encodedBody;
  email.href = emailDraft;
  whatsapp.href = whatsappDraft;
  email.hidden = emailDraft.length > 1800;
  whatsapp.hidden = whatsappDraft.length > 1800;
  document.querySelector('#buyer-link-note').hidden =
    emailDraft.length <= 1800 && whatsappDraft.length <= 1800;
  buyerPreview.hidden = false;
  buyerStatus.textContent = email.hidden && whatsapp.hidden ? 'Long draft ready — copy or download it, then send it to Aiva. Nothing has been sent yet.' : 'Draft ready — not sent yet. Choose email or WhatsApp and send your message there.';
  buyerPreview.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'});
  buyerMessage.focus({preventScroll: true});
});

document.querySelector('#buyer-copy').addEventListener('click', () => {
  copyDraft(buyerMessage, buyerStatus);
});
document.querySelector('#buyer-download').addEventListener('click', () => {
  downloadDraft(buyerMessage.value, 'aiva-sourcing-brief.txt');
});

const catalogControls = document.querySelector('.catalog-controls');
const search = document.querySelector('#product-search');
const categoryFilter = document.querySelector('#product-filter');
const cards = [...document.querySelectorAll('[data-group]')];
const catalogStatus = document.querySelector('#catalog-status');

function filterCatalog() {
  const terms = search.value.toLowerCase().trim().split(/\s+/);
  let visible = 0;
  for (const card of cards) {
    const matchesCategory = !categoryFilter.value || card.dataset.group === categoryFilter.value;
    const content = card.textContent.toLowerCase();
    card.hidden = !(matchesCategory && terms.every(term => content.includes(term)));
    if (!card.hidden) visible++;
  }
  catalogStatus.textContent = visible
    ? `${visible} catalogue ${visible === 1 ? 'result' : 'results'} shown`
    : 'No results match. Try a different search or clear the filters.';
}

search.addEventListener('input', filterCatalog);
categoryFilter.addEventListener('change', filterCatalog);
document.querySelector('#reset-filters').addEventListener('click', () => {
  search.value = '';
  categoryFilter.value = '';
  filterCatalog();
  search.focus();
});
catalogControls.hidden = false;
catalogStatus.hidden = false;
filterCatalog();

const supplierOffer = document.querySelector('#supplier-offer');
const offerPreview = document.querySelector('#offer-preview');
const offerMessage = document.querySelector('#offer-message');
const offerStatus = document.querySelector('#offer-status');
const selectedBrief = document.querySelector('#selected-sourcing-brief');
const briefName = document.querySelector('#selected-brief-name');
const clearBrief = document.querySelector('#clear-sourcing-brief');
let activeBrief = '';

function clearSourcingBrief() {
  activeBrief = '';
  briefName.textContent = '';
  selectedBrief.hidden = true;
  offerPreview.hidden = true;
}

document.querySelectorAll('[data-offer-brief]').forEach(button => {
  button.addEventListener('click', () => {
    activeBrief = button.dataset.offerBrief;
    supplierOffer.elements.category.value = button.dataset.offerCategory;
    briefName.textContent = activeBrief;
    selectedBrief.hidden = false;
    offerPreview.hidden = true;
    supplierOffer.elements.company.focus({preventScroll:true});
    supplierOffer.scrollIntoView({block:'start'});
  });
});
clearBrief.addEventListener('click', () => {
  clearSourcingBrief();
  supplierOffer.elements.category.focus();
});
supplierOffer.elements.category.addEventListener('change', clearSourcingBrief);


supplierOffer.addEventListener('change', () => { offerPreview.hidden = true; });
supplierOffer.addEventListener('input', () => {
  offerPreview.hidden = true;
});

const extraLines = document.querySelector('#extra-offer-lines');
const addLine = document.querySelector('#add-offer-line');
const lineStatus = document.querySelector('#quote-line-status');
const lineTemplate = document.querySelector('#offer-line-template');

function updateQuoteLines() {
  [...extraLines.children].forEach((line, index) => {
    line.querySelector('legend').textContent = 'Product ' + (index + 2);
    line.querySelector('[data-remove-line]').setAttribute('aria-label', 'Remove product ' + (index + 2));
  });
  addLine.disabled = extraLines.children.length >= 9;
  const total = extraLines.children.length + 1;
  lineStatus.textContent = total + ' of 10 product lines';
  offerPreview.hidden = true;
}

addLine.addEventListener('click', () => {
  const line = lineTemplate.content.firstElementChild.cloneNode(true);
  line.querySelector('[data-remove-line]').addEventListener('click', () => {
    line.remove();
    updateQuoteLines();
    addLine.focus();
  });
  extraLines.append(line);
  updateQuoteLines();
  line.querySelector('input').focus();
});

function downloadDraft(text, filename) {
  const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

document.querySelector('#offer-download').addEventListener('click', () => {
  downloadDraft(offerMessage.value, 'aiva-supplier-quote.txt');
});

supplierOffer.addEventListener('submit', event => {
  event.preventDefault();
  const fields = supplierOffer.elements;
  const labels = [
    ['Contact name', 'contactName'],
    ['Reply email', 'contactEmail'],
    ['Company', 'company'],
    ['Quote type', 'intent'],
    ['Factory or dispatch location', 'origin'],
    ['Product category', 'category'],
    ['Product and model', 'model'],
    ['Price, MOQ and lead time', 'terms'],
    ['Trade terms and named place', 'delivery'],
    ['Proposed payment terms', 'payment'],
    ['Sample cost and dispatch time', 'samples'],
    ['Catalogue, datasheet or test reports', 'catalogue']
  ];
  const lines = labels.flatMap(([label, name]) => {
    const value = fields[name].value.trim();
    return value ? [label + ': ' + value] : [];
  });
  if (activeBrief) lines.unshift('Sourcing brief: ' + activeBrief);
  [...extraLines.children].forEach((line, index) => {
    lines.push('', 'PRODUCT ' + (index + 2));
    line.querySelectorAll('[data-quote-field]').forEach(field => {
      const value = field.value.trim();
      if (value) lines.push(field.dataset.quoteField + ': ' + value);
    });
  });
  const subject = 'Supplier offer for Aiva Trading Limited';
  const body = [subject, '', ...lines].join('\r\n');
  const supplierSection = supplierOffer.closest('#suppliers');
  const email = businessEmail;
  const whatsapp = new URL(supplierSection.querySelector('a[href^="https://wa.me/"]').href);
  whatsapp.searchParams.set('text', body);
  document.querySelector('#offer-email').href = email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  document.querySelector('#offer-whatsapp').href = whatsapp.href;
  const emailLink = document.querySelector('#offer-email');
  const whatsappLink = document.querySelector('#offer-whatsapp');
  emailLink.hidden = emailLink.href.length > 1800;
  whatsappLink.hidden = whatsappLink.href.length > 1800;
  document.querySelector('#offer-link-note').hidden = !(emailLink.hidden || whatsappLink.hidden);
  offerMessage.value = body;
  offerStatus.textContent = emailLink.hidden && whatsappLink.hidden ? 'Long draft ready — copy or download it, then send it to Aiva. Nothing has been sent yet.' : 'Draft ready — not sent yet. Choose email or WhatsApp to send your offer.';
  offerPreview.hidden = false;
  offerPreview.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center'});
  offerMessage.focus({preventScroll: true});
});

async function copyDraft(message, status) {
  try {
    await navigator.clipboard.writeText(message.value);
    status.textContent = 'Draft copied.';
  } catch {
    message.focus();
    message.select();
    status.textContent = 'Use your device’s Copy command to copy the selected draft.';
  }
}

document.querySelector('#offer-copy').addEventListener('click', () => {
  copyDraft(offerMessage, offerStatus);
});

// Session-only shortlist; no personal data is stored.
const selectedRanges = new Set();
const rangeButtons = [...document.querySelectorAll('[data-shortlist-range]')];
function renderShortlist() {
  const count = selectedRanges.size;
  const names = [...selectedRanges].join(' · ');
  document.querySelector('#range-shortlist').hidden = !count;
  document.querySelector('#range-shortlist-count').textContent = `${count} ${count === 1 ? 'range' : 'ranges'} selected`;
  document.querySelector('#range-shortlist-names').textContent = names;
  document.querySelector('#selected-ranges').hidden = !count;
  document.querySelector('#selected-ranges-text').textContent = names;
  for (const button of rangeButtons) {
    const active = selectedRanges.has(button.dataset.shortlistRange);
    button.setAttribute('aria-pressed', String(active));
    button.textContent = active ? 'Remove from shortlist' : 'Add to enquiry shortlist';
  }
  buyerPreview.hidden = true;
}
for (const button of rangeButtons) {
  button.addEventListener('click', () => {
    const range = button.dataset.shortlistRange;
    if (selectedRanges.has(range)) selectedRanges.delete(range); else selectedRanges.add(range);
    renderShortlist();
    catalogStatus.textContent = `${selectedRanges.size} sourcing ${selectedRanges.size === 1 ? 'range' : 'ranges'} in your enquiry shortlist.`;
  });
}
document.querySelector('#use-shortlist').addEventListener('click', () => {
  if (selectedRanges.size === 1) form.elements.category.value = [...selectedRanges][0];
  else if (selectedRanges.size > 1) form.elements.category.value = 'Other sourcing enquiry';
  renderShortlist();
});

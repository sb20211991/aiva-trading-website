/* Aiva Commerce: product discovery and basket. No card data or payment secrets in this file. */
(async () => {
'use strict';
const { formatMoney, normaliseCatalogue, CURRENCIES } = await import('./aiva-money.js');
const root = document.getElementById('aiva-online-store');
if (!root) return;
const $ = id => document.getElementById(id);
const els = {status:$('aiva-store-status'),search:$('aiva-search'),category:$('aiva-category'),sort:$('aiva-sort'),min:$('aiva-price-min'),max:$('aiva-price-max'),stock:$('aiva-in-stock'),results:$('aiva-product-results'),count:$('aiva-results-count'),lines:$('aiva-basket-lines'),summary:$('aiva-basket-summary'),cartCount:$('aiva-cart-count'),checkout:$('aiva-checkout'),error:$('aiva-checkout-error'),terms:$('aiva-shop-terms'),delivery:$('aiva-delivery-text'),returns:$('aiva-returns-text')};
const money = n => formatMoney(n, catalog?.currency || 'GBP');
const validMoney = n => Number.isSafeInteger(n) && n > 0 && n <= 100000000;
const validStock = n => Number.isSafeInteger(n) && n >= 0 && n <= 100000;
let catalog = null, products=[], shopStatus = {ready:false,mode:'disabled'};
const cart = {};
const CART_KEY='aiva_cart_v2';
try {const saved=JSON.parse(localStorage.getItem(CART_KEY)||'{}');if(saved && typeof saved==='object' && !Array.isArray(saved))for(const [sku,qty] of Object.entries(saved))if(/^[A-Za-z0-9_-]{2,60}$/.test(sku) && Number.isSafeInteger(qty)&&qty>0&&qty<=10)cart[sku]=qty;}catch{/* private browsing or storage denied */}
function saveCart(){try{localStorage.setItem(CART_KEY,JSON.stringify(cart))}catch{/* storage not available */}}
function setStatus(message,kind) {els.status.textContent=message; els.status.dataset.kind=kind||'info';}
function text(tag,value,css) {const e=document.createElement(tag);e.textContent=String(value); if(css)e.className=css;return e;}
function getQuantityLimit(product) {return Math.min(product.stock,10);}
function available(p) {return p.available===true && validMoney(p.pricePence) && validStock(p.stock) && p.stock>0;}
function listed(p){return !!p && typeof p.sku==='string' && /^[A-Za-z0-9_-]{2,60}$/.test(p.sku) && typeof p.name==='string' && p.name.trim().length>1 && p.name.length<=140 && typeof p.category==='string' && p.category.length<=80 && typeof p.description==='string' && p.description.length<=700 && (p.pricePence===null || validMoney(p.pricePence)) && (p.stock===null || validStock(p.stock));}
function sanitizeCart(){const bySku=new Map(products.map(p=>[p.sku,p]));for(const sku of Object.keys(cart)){const product=bySku.get(sku);if(!product||!available(product)){delete cart[sku];continue;}cart[sku]=Math.min(cart[sku],getQuantityLimit(product));}}
function updateCart(){sanitizeCart();els.lines.replaceChildren();let amount=0,total=0;
  for(const [sku,qty] of Object.entries(cart)){
    const p=products.find(x=>x.sku===sku);if(!p||qty<1)continue;
    total+=qty;amount+=qty*p.pricePence;
    const row=document.createElement('div');row.className='aiva-basket-line';
    const info=document.createElement('div');info.append(text('strong',p.name),text('small','SKU: '+sku));
    const control=document.createElement('div');control.className='aiva-qty-control';
    const minus=text('button','−');minus.type='button';minus.setAttribute('aria-label','Remove one '+p.name);minus.onclick=()=>modify(sku,-1);
    const plus=text('button','+');plus.type='button';plus.setAttribute('aria-label','Add one '+p.name);plus.disabled=qty>=getQuantityLimit(p);plus.onclick=()=>modify(sku,1);
    control.append(minus,text('span',qty),plus);
    row.append(info,control,text('strong',money(p.pricePence*qty)));els.lines.append(row);
  }
  if(!total){els.lines.append(text('p','Your basket is empty. Add a product when live listings become available.'));}
  els.summary.replaceChildren();if(total){const line=document.createElement('div');line.className='aiva-basket-total';line.append(text('span','Subtotal ('+total+' items)'),text('strong',money(amount)));els.summary.append(line);
    const ship=catalog?.shipping;if(ship&&Number.isSafeInteger(ship.flatRatePence)&&ship.flatRatePence>=0){const postage=(Number.isSafeInteger(ship.freeShippingThresholdPence)&&amount>=ship.freeShippingThresholdPence)?0:ship.flatRatePence;
      const delivery=document.createElement('div');delivery.className='aiva-basket-total';delivery.append(text('span','Estimated delivery'),text('strong',postage?money(postage):'Included'));els.summary.append(delivery);
      const grand=document.createElement('div');grand.className='aiva-basket-total';grand.append(text('span','Estimated total'),text('strong',money(amount+postage)));els.summary.append(grand);
    }}
  saveCart();
  els.cartCount.textContent=String(total);
  els.checkout.disabled=!(total>0&&shopStatus.ready===true);
  els.checkout.textContent=shopStatus.mode==='test'?'Continue to test online checkout':'Pay online by card';
}
function modify(sku,delta){const p=products.find(p=>p.sku===sku);if(!p||!available(p))return;cart[sku]=Math.max(0,Math.min(getQuantityLimit(p),(cart[sku]||0)+delta));if(!cart[sku])delete cart[sku];updateCart();}
function card(p){const item=document.createElement('article');item.className='aiva-product-item';
  if(typeof p.image==='string' && /^assets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g|avif)$/.test(p.image)){
    const img=document.createElement('img');img.src=p.image;img.loading='lazy';img.alt=p.name;item.append(img);
  }
  const content=document.createElement('div');content.className='aiva-product-content';
  content.append(text('small',p.category+' · '+p.sku,'aiva-meta'),text('h3',p.name),text('p',p.description));
  if(p.specifications&&typeof p.specifications==='string'){const details=document.createElement('details');const summary=text('summary','Specifications');details.append(summary,text('p',p.specifications.slice(0,600)));content.append(details);}
  const isAvail=available(p);
  content.append(text('strong',validMoney(p.pricePence)?money(p.pricePence):'Price on request','aiva-price'));
  content.append(text('span',isAvail?(p.stock+' available'):'Ask about availability',isAvail?'aiva-stock':'aiva-stock aiva-outofstock'));
  if(isAvail){const add=text('button','Add to basket');add.type='button';add.disabled=shopStatus.ready!==true;add.onclick=()=>{modify(p.sku,1);$('aiva-basket').scrollIntoView({behavior:'smooth',block:'nearest'});};content.append(add)}
  else{const a=text('a','Enquire about this product','aiva-enquire');a.href='index.html?intent=product&item='+encodeURIComponent(p.name)+'#enquiry';content.append(a)}
  item.append(content);return item;
}
function render(){if(!catalog)return;
  const factor=10**CURRENCIES[catalog.currency];
  const term=els.search.value.trim().toLowerCase();const mn=els.min.value===''?null:Math.round(Number(els.min.value)*factor);const mx=els.max.value===''?null:Math.round(Number(els.max.value)*factor);
  let list=products.filter(p=>(!els.category.value||p.category===els.category.value)&&(!term||[p.name,p.category,p.description,p.sku,p.brand||''].join(' ').toLowerCase().includes(term))&&(!els.stock.checked||available(p))&&(mn===null||validMoney(p.pricePence)&&p.pricePence>=mn)&&(mx===null||validMoney(p.pricePence)&&p.pricePence<=mx));
  if(els.sort.value==='price-asc')list.sort((a,b)=>(a.pricePence??Infinity)-(b.pricePence??Infinity));
  if(els.sort.value==='price-desc')list.sort((a,b)=>(b.pricePence??-1)-(a.pricePence??-1));
  if(els.sort.value==='name')list.sort((a,b)=>a.name.localeCompare(b.name));
  els.results.replaceChildren(...list.map(card));
  els.count.textContent=list.length+' product'+(list.length===1?'':'s')+' shown';
  if(!list.length){const box=document.createElement('div');box.className='aiva-empty';
   box.append(text('strong',products.length?'No products match these filters.':'Products are being prepared for sale.'),text('p',products.length?'Try another category or clear the filters.':'Browse our sourcing ranges below or request a quotation. Real stock, prices and delivery terms must be confirmed before online orders open.'));els.results.append(box)}
  updateCart();
}
async function load(){try{
  const statusRes=await fetch('/api/shop-status',{cache:'no-store'});
  if(statusRes.ok){shopStatus=await statusRes.json()} else shopStatus={ready:false,mode:'disabled'};
  const cataloguePath='/data/aiva-products.json';
  const dataRes=await fetch(cataloguePath,{cache:'no-store'});
  if(!dataRes.ok)throw new Error('Product catalogue unavailable.'); catalog=normaliseCatalogue(await dataRes.json());
  for(const input of [els.min,els.max]){
    const label=input.closest('label');
    if(label?.firstChild?.nodeType===Node.TEXT_NODE)label.firstChild.textContent=label.firstChild.textContent.replace(/£|GBP/,catalog.currency);
    input.step=CURRENCIES[catalog.currency]===0?'1':'0.01';
  }
  if(!catalog||!Array.isArray(catalog.products))throw new Error('Product catalogue is invalid.');
  products=catalog.products.filter(listed);
  const liveStock=shopStatus&&shopStatus.stock&&typeof shopStatus.stock==='object'?shopStatus.stock:{};
  for(const p of products)if(validStock(liveStock[p.sku]))p.stock=Math.min(p.stock??liveStock[p.sku],liveStock[p.sku]);
  const seen=new Set();products=products.filter(p=>{if(seen.has(p.sku))return false;seen.add(p.sku);return true});
  const categories=new Set(Array.isArray(catalog.categories)?catalog.categories.filter(x=>typeof x==='string'&&x.length<80):[]);products.forEach(p=>categories.add(p.category));
  for(const c of categories){els.category.add(new Option(c,c));}
  if(typeof catalog.deliveryPolicy==='string'&&catalog.deliveryPolicy.trim()&&typeof catalog.returnsPolicy==='string'&&catalog.returnsPolicy.trim()){
    els.delivery.textContent=catalog.deliveryPolicy;els.returns.textContent=catalog.returnsPolicy;els.terms.hidden=false;
  }
  if(shopStatus.ready&&shopStatus.mode==='live')setStatus('Online checkout is available for confirmed in-stock products.','info');
  else if(shopStatus.ready&&shopStatus.mode==='test')setStatus('TEST CHECKOUT ONLY — this shop is not taking real payments.','warning');
  else setStatus('Browse products and request information. Secure payments will open after product listings, delivery terms and payment setup are confirmed.','warning');
  render();
 }catch(e){setStatus('Shop listings are temporarily unavailable. Our sourcing enquiry form is still available below.','warning');els.results.replaceChildren(text('p','Product catalogue could not load.'));els.checkout.disabled=true;}
}
for(const el of [els.search,els.min,els.max])el.addEventListener('input',render);
for(const el of [els.category,els.sort,els.stock])el.addEventListener('change',render);
$('aiva-reset-filters').addEventListener('click',()=>{els.search.value='';els.category.value='';els.sort.value='recommended';els.min.value='';els.max.value='';els.stock.checked=false;render()});
els.checkout.addEventListener('click',async()=>{
  if(els.checkout.disabled)return;els.checkout.disabled=true;els.checkout.textContent='Opening secure checkout…';els.error.hidden=true;
  try{
    const items=Object.entries(cart).map(([sku,quantity])=>({sku,quantity}));
    const r=await fetch('/api/create-checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
    const info=await r.json();if(!r.ok||!info.url)throw new Error(info.error||'Checkout could not be opened.');
    const target=new URL(info.url);
    const host=target.hostname.toLowerCase();
    const pageHost=location.hostname.toLowerCase();
    const localPreview=pageHost==='127.0.0.1'||pageHost==='localhost';
    const trusted=
      host==='square.link'||host.endsWith('.square.link')||
      host==='checkout.square.site'||host.endsWith('.checkout.square.site')||
      host.endsWith('.squareup.com')||host.endsWith('.squareupsandbox.com')||
      (shopStatus.provider==='shopify'&&(host.endsWith('.myshopify.com')||(Array.isArray(shopStatus.checkoutHosts)&&shopStatus.checkoutHosts.includes(host))))||
      (localPreview&&(host==='127.0.0.1'||host==='localhost')&&target.pathname.endsWith('/order-success.html'));
    if(!((target.protocol==='https:'&&trusted)||(localPreview&&target.protocol==='http:'&&trusted)))throw new Error('Unexpected checkout destination.');
    if(typeof info.orderId==='string'&&/^[A-Za-z0-9_-]{8,191}$/.test(info.orderId)){
      try{sessionStorage.setItem('aiva_pending_checkout_ref',info.orderId)}catch{/* private browsing */}
      try{localStorage.setItem('aiva_pending_checkout_ref',info.orderId)}catch{/* private browsing */}
    }
    location.assign(target.href);
  }catch(e){els.error.textContent=e.message||'Checkout is not available. Please contact Aiva.';els.error.hidden=false;updateCart()}
});
load();
})();

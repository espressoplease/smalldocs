const http = require('http');
const crypto = require('crypto');

async function startStripe() {
  const sessions = new Map(), coupons = new Map(), subscriptions = new Map(), invoices = new Map(), keys = new Map(), calls = [];
  const price = { id: 'price_standard', product: 'prod_standard', currency: 'usd', unit_amount: 500,
    recurring: { interval: 'month', interval_count: 1 }, billing_scheme: 'per_unit',
    currency_options: { usd: { unit_amount: 500 }, gbp: { unit_amount: 400 }, eur: { unit_amount: 500 } } };
  let loseInvoiceReply = false, serial = 0;
  function calculate(invoice) {
    let remaining = invoice.subtotal;
    invoice.total_discount_amounts = [];
    for (const discount of invoice.discounts || []) {
      const coupon = coupons.get(discount.source.coupon.id);
      const amount = Math.min(remaining,coupon.currency === invoice.currency ? coupon.amount_off : coupon.currency_options[invoice.currency].amount_off);
      remaining -= amount;
      invoice.total_discount_amounts.push({ amount, discount: discount.id });
    }
    invoice.amount_due = Math.round(remaining * (1 + (invoice.tax_rate || 0)));
    invoice.total = invoice.amount_due;
  }
  const server = http.createServer(async (req,res) => {
    try {
      let body = ''; for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body), pathname = new URL(req.url,'http://fixture').pathname;
      calls.push({ method: req.method, path: pathname, params: Object.fromEntries(params), key: req.headers['idempotency-key'] });
      const key = req.headers['idempotency-key'];
      function send(value,status=200) { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(value)); }
      if (key && keys.has(key)) {
        const previous = keys.get(key);
        if (previous.body !== body || previous.path !== pathname) return send({error:{message:'Idempotency parameters changed'}},409);
        return send(previous.value);
      }
      function remember(value) { if (key) keys.set(key,{body,path:pathname,value}); send(value); }
      if (pathname === '/v1/prices/price_standard') return send(price);
      if (pathname === '/v1/coupons') {
        const coupon = { id: params.get('id'), amount_off: Number(params.get('amount_off')), currency: params.get('currency'),
          duration: params.get('duration'), product: params.get('applies_to[products][0]'), currency_options: {} };
        if (coupon.duration !== 'once' || !coupon.amount_off || params.has('percent_off') || coupon.product !== price.product) return send({error:{message:'Invalid referral coupon'}},400);
        for (const code of ['usd','eur','gbp']) if (params.has('currency_options['+code+'][amount_off]')) coupon.currency_options[code] = { amount_off: Number(params.get('currency_options['+code+'][amount_off]')) };
        coupons.set(coupon.id,coupon); return remember(coupon);
      }
      if (pathname === '/v1/checkout/sessions') {
        const session = { id: 'cs_referral_' + (++serial), url: 'https://checkout.example/' + serial, status: 'open',
          quantity: Number(params.get('line_items[0][quantity]')), coupon: params.get('discounts[0][coupon]'), metadata: {} };
        for (const [key,value] of params) { const match = /^subscription_data\[metadata\]\[(.+)\]$/.exec(key); if (match) session.metadata[match[1]] = value; }
        sessions.set(session.id,session); return remember(session);
      }
      if (pathname.startsWith('/v1/checkout/sessions/')) {
        const session = sessions.get(pathname.split('/')[4]);
        if (!session) return send({error:{message:'Missing checkout'}},404);
        if (pathname.endsWith('/expire')) session.status = 'expired';
        return send(session);
      }
      if (pathname.startsWith('/v1/subscriptions/')) return send(subscriptions.get(pathname.split('/')[3]) || {});
      if (pathname.startsWith('/v1/invoices/')) {
        const invoice = invoices.get(pathname.split('/')[3]);
        if (!invoice) return send({error:{message:'Missing invoice'}},404);
        if (req.method === 'GET') return send(invoice);
        if (invoice.status !== 'draft') return send({error:{message:'Finalized invoice'}},400);
        const discounts = [];
        for (let i=0; params.has('discounts['+i+'][coupon]') || params.has('discounts['+i+'][discount]'); i++) {
          const existing = params.get('discounts['+i+'][discount]');
          discounts.push(existing ? invoice.discounts.find(d => d.id === existing) : {id:'di_referral_'+(++serial),source:{coupon:{id:params.get('discounts['+i+'][coupon]')}}});
        }
        invoice.discounts = discounts;
        invoice.metadata.sdocs_referral_redemption = params.get('metadata[sdocs_referral_redemption]');
        calculate(invoice);
        if (loseInvoiceReply) { loseInvoiceReply=false; req.socket.destroy(); return; }
        return remember(invoice);
      }
      if (pathname.startsWith('/v1/subscription_items/')) return send({id:pathname.split('/')[3],quantity:Number(params.get('quantity'))});
      return send({error:{message:'Unexpected Stripe endpoint '+pathname}},404);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({error:{message:error.message}})); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  function subscription(session) {
    session.status='complete';
    const object = {id:'sub_referral_'+(++serial),customer:'cus_referral_'+serial,status:'active',created:Math.floor(Date.now()/1000),
      current_period_end:Math.floor(Date.now()/1000)+2592000,metadata:{...session.metadata},
      items:{data:[{id:'si_referral_'+serial,quantity:session.quantity,price}]}};
    subscriptions.set(object.id,object); return object;
  }
  function invoice(subscription,{quantity=subscription.items.data[0].quantity,currency='usd',reason='subscription_cycle',coupon, tax=0}={}) {
    const unit=currency === 'usd' ? 500 : price.currency_options[currency].unit_amount;
    const object={id:'in_referral_'+(++serial),customer:subscription.customer,status:'draft',created:Math.floor(Date.now()/1000),currency,
      parent:{subscription_details:{subscription:subscription.id,metadata:{...subscription.metadata}}},billing_reason:reason,
      subtotal:quantity*unit,amount_paid:0,discounts:coupon ? [{id:'di_referral_'+(++serial),source:{coupon:{id:coupon}}}] : [],
      metadata:{},tax_rate:tax,lines:{has_more:false,data:[{id:'il_referral_'+serial,quantity,amount:quantity*unit,
        pricing:{price_details:{price:price.id,product:price.product}},parent:{subscription_item_details:{proration:false}}}]}};
    calculate(object); invoices.set(object.id,object); return object;
  }
  async function webhook(origin,type,object,eventId) {
    const created=Math.floor(Date.now()/1000);
    const raw=JSON.stringify({id:eventId || 'evt_referral_'+(++serial),type,created,data:{object}});
    const signature=crypto.createHmac('sha256','whsec_fixture').update(created+'.'+raw).digest('hex');
    const response=await fetch(origin+'/api/cloud/billing/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json',
      'Stripe-Signature':'t='+created+',v1='+signature},body:raw});
    return {status:response.status,data:await response.json()};
  }
  return {origin:'http://127.0.0.1:'+server.address().port,sessions,coupons,subscriptions,invoices,calls,price,
    subscription,invoice,webhook,calculate,loseNextInvoiceReply(){loseInvoiceReply=true;},
    async close(){await new Promise(resolve=>server.close(resolve));}};
}
module.exports={startStripe};

// Uses the authenticated Stripe CLI in test mode and cleans up its own fixtures.
'use strict';
const {execFileSync}=require('child_process');
const assert=require('assert');
const crypto=require('crypto');
const {createStripeClient}=require('../lib/cloud-stripe');
const {couponId}=require('../lib/cloud-referral-billing');
const run=crypto.randomBytes(6).toString('hex'), customers=[],subscriptions=[],coupons=[];
let product,price;
function call(method,path,values={},idempotency) {
  const params=values instanceof URLSearchParams?values:new URLSearchParams(values);
  const target=new URL(path,'https://api.stripe.com');
  const args=[method.toLowerCase(),target.pathname,'--stripe-version','2026-07-29.dahlia','--confirm'];
  for(const [key,value] of target.searchParams) args.push('-d',key+'='+value);
  if(idempotency) args.push('--idempotency',idempotency);
  for(const [key,value] of params) args.push('-d',key+'='+value);
  const result=JSON.parse(execFileSync('stripe',args,{encoding:'utf8',timeout:45000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));
  if(result.error) throw new Error(result.error.message);
  return result;
}
const applicationKeyFile=process.env.SDOCS_STRIPE_APPLICATION_KEY_FILE;
const applicationKey=applicationKeyFile?require('fs').readFileSync(applicationKeyFile,'utf8').trim():null;
if(applicationKey)assert.ok(/^(sk|rk)_test_/.test(applicationKey),'Use a sandbox application credential');
const client=applicationKey?createStripeClient({secretKey:applicationKey}):createStripeClient({secretKey:'unused-cli-transport',transport:async request=>({status:200,
  body:JSON.stringify(call(request.method,new URL(request.url).pathname+new URL(request.url).search,new URLSearchParams(request.body||''),request.headers['Idempotency-Key']))})});
const receipt={run,livemode:null,application_credential:!!applicationKey,cases:[],cleanup:[]};
async function coupon(seats) {
  const couponId='sdocs_sandbox_'+run+'_'+coupons.length;
  const object=await client.createReferralCoupon({couponId,amount:seats*500,currency:'usd',currencyOptions:{gbp:{amount_off:seats*400},eur:{amount_off:seats*500}},
    productId:product.id,redemptionId:run+'_'+seats,idempotencyKey:'sandbox-referral-'+run+'-'+seats+'-'+coupons.length});
  coupons.push(object.id);assert.strictEqual(object.livemode,false);return object;
}
function customer() {
  const object=call('POST','/v1/customers',{name:'Robin Walker',email:'referral-billing@example.test',payment_method:'pm_card_visa',
    'invoice_settings[default_payment_method]':'pm_card_visa','metadata[referral_check]':run});
  customers.push(object.id);assert.strictEqual(object.livemode,false);return object;
}
(async()=>{
 try {
  const balance=call('GET','/v1/balance');assert.strictEqual(balance.livemode,false);receipt.livemode=false;
  product=call('POST','/v1/products',{name:'SmallDocs referral verification',tax_code:'txcd_10103000','metadata[referral_check]':run});
  assert.strictEqual(product.livemode,false);
  price=call('POST','/v1/prices',{product:product.id,unit_amount:'500',currency:'usd','recurring[interval]':'month',
    'currency_options[gbp][unit_amount]':'400','currency_options[eur][unit_amount]':'500'});
  assert.strictEqual(price.livemode,false);
  const retrieved=await client.retrievePrice({priceId:price.id});assert.strictEqual(retrieved.currency_options.gbp.unit_amount,400);
  for(const item of [{seats:10,credits:1,currency:'usd',expected:4500},{seats:5,credits:5,currency:'usd',expected:0},{seats:1,credits:1,currency:'gbp',expected:0}]) {
   const c=customer(),discount=await coupon(item.credits);
   const sub=call('POST','/v1/subscriptions',{customer:c.id,'items[0][price]':price.id,'items[0][quantity]':String(item.seats),
    'discounts[0][coupon]':discount.id,currency:item.currency,payment_behavior:'error_if_incomplete','metadata[referral_check]':run});
   subscriptions.push(sub.id);assert.strictEqual(sub.livemode,false);
   const invoice=await client.retrieveInvoice({invoiceId:typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice.id});
   assert.strictEqual(invoice.amount_due,item.expected);assert.strictEqual(invoice.status,'paid');
   assert.ok(invoice.discounts.some(d=>couponId(d)===discount.id));
   receipt.cases.push({...item,actual:invoice.amount_due,status:invoice.status});
  }
  const c=customer(),discount=await coupon(1);
  const draftSubscription=call('POST','/v1/subscriptions',{customer:c.id,'items[0][price]':price.id,'items[0][quantity]':'10',
    collection_method:'send_invoice',days_until_due:'30','metadata[referral_check]':run});
  subscriptions.push(draftSubscription.id);
  const draft=await client.retrieveInvoice({invoiceId:typeof draftSubscription.latest_invoice==='string'?draftSubscription.latest_invoice:draftSubscription.latest_invoice.id});
  assert.strictEqual(draft.status,'draft');
  await client.updateInvoiceReferralDiscount({invoiceId:draft.id,discounts:[{coupon:discount.id}],redemptionId:run,idempotencyKey:'sandbox-draft-'+run});
  const updated=await client.retrieveInvoice({invoiceId:draft.id});assert.strictEqual(updated.amount_due,4500);
  assert.ok(updated.discounts.some(d=>couponId(d)===discount.id));
  receipt.cases.push({case:'draft renewal update',seats:10,credits:1,expected:4500,actual:updated.amount_due,status:updated.status});
  if(applicationKeyFile)await require('./check-referral-application')({applicationKeyFile,price,client,coupons,receipt});
 } finally {
  for(const object of subscriptions) try{call('DELETE','/v1/subscriptions/'+object);receipt.cleanup.push('subscription cancelled');}catch(e){receipt.cleanup.push('subscription cleanup failed: '+e.message);}
  for(const object of customers) try{call('DELETE','/v1/customers/'+object);receipt.cleanup.push('customer deleted');}catch(e){receipt.cleanup.push('customer cleanup failed: '+e.message);}
  for(const object of coupons) try{call('DELETE','/v1/coupons/'+object);receipt.cleanup.push('coupon deleted');}catch(e){receipt.cleanup.push('coupon cleanup failed: '+e.message);}
  if(price) try{call('POST','/v1/prices/'+price.id,{active:'false'});receipt.cleanup.push('price archived');}catch(e){receipt.cleanup.push('price cleanup failed: '+e.message);}
  if(product) try{call('POST','/v1/products/'+product.id,{active:'false'});receipt.cleanup.push('product archived');}catch(e){receipt.cleanup.push('product cleanup failed: '+e.message);}
  require('fs').writeFileSync('/tmp/sdocs-referral-stripe-sandbox-receipt.json',JSON.stringify(receipt,null,2));
 }
 console.log(JSON.stringify(receipt));
})().catch(error=>{console.error(error.message);process.exitCode=1;});

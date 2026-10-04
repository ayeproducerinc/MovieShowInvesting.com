import assert from "node:assert/strict";
import { test } from "node:test";
import { canAttributeReferral, classifyReferralPayment, isPublicReferralProject, referralStatus } from "./referral-policy";

const now = new Date("2026-10-04T12:00:00Z");
const attribution = {
  memberId: "firebase:new", referrerId: "firebase:friend", consumedBy: null,
  accountCreatedAt: new Date("2026-10-04T11:00:00Z"),
  capturedAt: new Date("2026-10-04T10:00:00Z"), expiresAt: new Date("2026-11-03T10:00:00Z"),
};
test("new verified signup, not an existing account or a self referral", () => {
  assert.equal(canAttributeReferral(attribution,now),true);
  assert.equal(canAttributeReferral({...attribution,accountCreatedAt:new Date("2026-10-03")},now),false);
  assert.equal(canAttributeReferral({...attribution,memberId:attribution.referrerId},now),false);
  assert.equal(canAttributeReferral({...attribution,accountCreatedAt:new Date("2026-10-05")},now),false);
});
test("expired and already-used receipts cannot be claimed", () => {
  assert.equal(canAttributeReferral({...attribution,expiresAt:now},now),false);
  assert.equal(canAttributeReferral({...attribution,consumedBy:"firebase:other"},now),false);
});
test("Firebase whole-second metadata does not reject a signup within the captured second", () => {
  assert.equal(canAttributeReferral({...attribution,
    accountCreatedAt:new Date("2026-10-04T10:00:00Z"),capturedAt:new Date("2026-10-04T10:00:00.900Z"),
    accountTimestampPrecisionMs:1000},now),true);
  assert.equal(canAttributeReferral({...attribution,
    accountCreatedAt:new Date("2026-10-04T09:59:59Z"),capturedAt:new Date("2026-10-04T10:00:00.001Z"),
    accountTimestampPrecisionMs:1000},now),false);
});
test("all Explore public listing gates are required", () => {
  const p = { approved:true,hidden:false,showcase_requested:true,slug:"pitch" };
  assert.equal(isPublicReferralProject(p),true);
  for (const change of [{approved:false},{hidden:true},{showcase_requested:false},{slug:null}]) {
    assert.equal(isPublicReferralProject({...p,...change}),false);
  }
  assert.equal(isPublicReferralProject(null),false);
});
test("only an approved public project with a valid payment earns an unpaid reward", () => {
  assert.equal(referralStatus(false,"valid",false),"pending");
  assert.equal(referralStatus(false,"valid",true),"eligible");
  assert.equal(referralStatus(false,"unverified",true),"pending");
  assert.equal(referralStatus(false,"refunded",true),"cancelled");
  assert.equal(referralStatus(false,"disputed",true),"cancelled");
});
test("paid exceptions preserve history and require manual review", () => {
  assert.equal(referralStatus(true,"valid",false),"paid");
  for (const status of ["refunded","disputed","unverified"] as const) {
    assert.equal(referralStatus(true,status,true),"review_required");
  }
});
const expected = {sessionId:"cs_test_fixture",projectId:99,live:false,priceId:"price_fixture"};
function evidence() {
  return {
    session:{id:expected.sessionId,livemode:false,client_reference_id:"99",metadata:{project_id:"99"},
      mode:"payment",currency:"usd",amount_total:4900,amount_subtotal:4900,
      total_details:{amount_discount:0,amount_tax:0},payment_status:"paid",status:"complete",payment_intent:"pi_fixture"},
    intent:{id:"pi_fixture",livemode:false,status:"succeeded",currency:"usd",amount_received:4900,amount:4900,
      metadata:{project_id:"99"},latest_charge:{livemode:false,payment_intent:"pi_fixture",amount:4900,
        currency:"usd",paid:true,refunded:false,amount_refunded:0,disputed:false}},
    items:{has_more:false,data:[{price:{id:expected.priceId},quantity:1,amount_total:4900}]},
  };
}
test("current settled provider evidence verifies the exact project, price, and environment", () => {
  const e=evidence(); assert.equal(classifyReferralPayment(e.session,e.intent,e.items,expected),"valid");
  assert.equal(classifyReferralPayment({...e.session,livemode:true},e.intent,e.items,expected),"unverified");
  assert.equal(classifyReferralPayment({...e.session,client_reference_id:"100"},e.intent,e.items,expected),"unverified");
  assert.equal(classifyReferralPayment({...e.session,payment_status:"unpaid"},e.intent,e.items,expected),"unverified");
  assert.equal(classifyReferralPayment(e.session,e.intent,{...e.items,has_more:true},expected),"unverified");
  assert.equal(classifyReferralPayment(e.session,e.intent,{data:[]},expected),"unverified");
  assert.equal(classifyReferralPayment(e.session,{...e.intent,latest_charge:"ch_not_expanded"},e.items,expected),"unverified");
});
test("partial/full refunds and disputes invalidate payment without confusing identity failures", () => {
  const e=evidence();
  assert.equal(classifyReferralPayment(e.session,{...e.intent,latest_charge:{...e.intent.latest_charge,amount_refunded:1}},e.items,expected),"refunded");
  assert.equal(classifyReferralPayment(e.session,{...e.intent,latest_charge:{...e.intent.latest_charge,refunded:true,amount_refunded:4900}},e.items,expected),"refunded");
  assert.equal(classifyReferralPayment(e.session,{...e.intent,latest_charge:{...e.intent.latest_charge,disputed:true}},e.items,expected),"disputed");
  assert.equal(classifyReferralPayment(e.session,{...e.intent,latest_charge:{...e.intent.latest_charge,amount:1,refunded:true}},e.items,expected),"unverified");
});
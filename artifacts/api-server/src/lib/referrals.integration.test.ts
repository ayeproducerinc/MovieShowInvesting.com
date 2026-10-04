import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "@workspace/db";
import type { FilmmakerIdentity } from "./filmmaker-auth";
import {
  captureReferral,enrollReferralMember,memberReferrals,referralLedger,refreshReferralReward,
  recordReferralPayout,referralIdentityId,
} from "./referrals";

test("development referral lifecycle and denial regressions", async t => {
  if (process.env.NODE_ENV === "production") throw new Error("Never run fixture tests in production");
  const users: FilmmakerIdentity[] = [];
  const visitors: string[] = [];
  const projects: number[] = [];
  const filmmakers: number[] = [];
  async function account(email?: string, old = false) {
    const uid=randomUUID();
    const actor:FilmmakerIdentity={uid,provider:"replit",email:email ?? `ref-test-${uid}@example.invalid`,phoneNumber:null};
    await pool.query(`INSERT INTO replit_auth_users(id,issuer,subject,email,created_at) VALUES($1::uuid,'referral-regression',$1::text,$2,$3)`,
      [uid,actor.email,new Date(Date.now()-(old ? 86400000 : 0))]);
    users.push(actor); return actor;
  }
  async function paidProject(actor:FilmmakerIdentity, listed=false) {
    const visitor=randomUUID(); visitors.push(visitor);
    await pool.query("INSERT INTO visitors(visitor_id) VALUES($1)",[visitor]);
    const f=(await pool.query("INSERT INTO filmmakers(replit_uid,email,visitor_id) VALUES($1,$2,$3) RETURNING id",
      [actor.uid,actor.email,visitor])).rows[0].id; filmmakers.push(f);
    const p=(await pool.query(`INSERT INTO projects(filmmaker_id,title,slug,review_paid_at,showcase_requested,approved,hidden)
      VALUES($1,'Referral regression',$2,now(),true,$3,false) RETURNING id`,[f,`ref-test-${randomUUID()}`,listed])).rows[0].id;
    projects.push(p);
    await pool.query(`INSERT INTO pitch_review_checkouts(session_id,project_id,visitor_id,state,paid_at)
      VALUES($1,$2,$3,'paid',now())`,[`cs_test_fixture_${randomUUID()}`,p,visitor]);
    return p;
  }
  const valid=async()=> "valid" as const;
  const payout={reference:`ref-regression-${randomUUID()}`,paid_on:new Date().toISOString().slice(0,10),confirmed_sent:true};
  try {
    const owner=await account(undefined,true);
    const ownerId=await enrollReferralMember(owner,null);
    const ownerCode=(await memberReferrals(ownerId)).code;
    const otherOwner=await account(undefined,true);
    const otherId=await enrollReferralMember(otherOwner,null);
    const otherCode=(await memberReferrals(otherId)).code;
    await t.test("invalid/missing codes reject; first link persists; manual code replaces before signup",async()=>{
      await assert.rejects(captureReferral("INVALID",null,false));
      await assert.rejects(captureReferral("AAAAAAAAAAAA",null,false));
      const first=await captureReferral(ownerCode,null,false);
      const keep=await captureReferral(otherCode,first.token,false);
      assert.equal(keep.token,first.token);
      const override=await captureReferral(otherCode,first.token,true);
      assert.notEqual(override.token,first.token);
      assert.equal((await pool.query("SELECT referrer_id FROM referral_receipts WHERE token_hash=encode(sha256($1::bytea),'hex')",
        [override.token])).rows[0].referrer_id,otherId);
    });
    const receipt=await captureReferral(ownerCode,null,false);
    const referred=await account();
    const referredId=await enrollReferralMember(referred,receipt.token);
    await t.test("new signup is attributed once; signup alone earns nothing",async()=>{
      assert.equal((await memberReferrals(referredId)).referred_by,true);
      const summary=await memberReferrals(ownerId);
      assert.equal(summary.signup_count,1); assert.equal(summary.eligible_cents,0); assert.equal(summary.pending_count,1);
      assert.equal(await enrollReferralMember(referred,receipt.token),referredId);
      assert.equal((await memberReferrals(ownerId)).signup_count,1);
      await assert.rejects(captureReferral(otherCode,receipt.token,true));
    });
    await t.test("existing accounts, expired receipts, repeated cookies and duplicate emails do not earn attribution",async()=>{
      const oldReceipt=await captureReferral(ownerCode,null,false);
      const old=await account(undefined,true);
      assert.equal((await memberReferrals(await enrollReferralMember(old,oldReceipt.token))).referred_by,false);
      const expired=await captureReferral(ownerCode,null,false);
      await pool.query("UPDATE referral_receipts SET expires_at=now()-interval '1 second' WHERE token_hash=encode(sha256($1::bytea),'hex')",[expired.token]);
      const fresh=await account();
      assert.equal((await memberReferrals(await enrollReferralMember(fresh,expired.token))).referred_by,false);
      const repeated=await account();
      assert.equal((await memberReferrals(await enrollReferralMember(repeated,receipt.token))).referred_by,false);
      const duplicate=await account(referred.email);
      await assert.rejects(enrollReferralMember(duplicate,null),/another sign-in method/);
      assert.equal((await memberReferrals(ownerId)).signup_count,1);
    });
    const project=await paidProject(referred);
    const reward=(await memberReferrals(ownerId)).rewards[0];
    await t.test("payment alone, declined, hidden and not-requested projects do not earn rewards",async()=>{
      assert.equal(reward.status,"pending");
      await assert.rejects(recordReferralPayout(reward.id,payout,"test-admin",valid),/public listing/);
      await pool.query("UPDATE projects SET review_decision='declined' WHERE id=$1",[project]);
      assert.equal((await memberReferrals(ownerId)).rewards[0].status,"cancelled");
      await pool.query("UPDATE projects SET approved=true,hidden=true,review_decision=NULL WHERE id=$1",[project]);
      assert.equal((await memberReferrals(ownerId)).eligible_cents,0);
      await pool.query("UPDATE projects SET hidden=false,showcase_requested=false WHERE id=$1",[project]);
      assert.equal((await memberReferrals(ownerId)).eligible_cents,0);
      await pool.query("UPDATE projects SET showcase_requested=true WHERE id=$1",[project]);
      assert.equal((await memberReferrals(ownerId)).eligible_cents,1000);
    });
    await t.test("repeat projects/events never award another reward or change the first project",async()=>{
      await paidProject(referred,true);
      await memberReferrals(ownerId); await memberReferrals(ownerId);
      assert.equal((await memberReferrals(ownerId)).rewards.length,1);
      const ledger=await referralLedger(1);
      assert.equal(ledger.rows.find(r=>r.referral_id===referredId)?.project_id,project);
      assert.equal((await memberReferrals(otherId)).rewards.length,0);
      assert.equal((await memberReferrals(ownerId)).rewards[0].project_title,null);
    });
    await t.test("unpaid refunds/disputes cancel; provider outage denies payout",async()=>{
      assert.equal((await refreshReferralReward(reward.id,async()=>"refunded")).status,"cancelled");
      await assert.rejects(recordReferralPayout(reward.id,payout,"test-admin",async()=>"disputed"),/public listing/);
      await assert.rejects(recordReferralPayout(reward.id,payout,"test-admin",async()=>{throw new Error("offline");}),/unavailable/);
      assert.equal((await refreshReferralReward(reward.id,valid)).status,"eligible");
      await assert.rejects(recordReferralPayout(reward.id,{...payout,confirmed_sent:false},"test-admin",valid),/already sent/);
    });
    await t.test("simultaneous payout submissions produce exactly one receipt",async()=>{
      const results=await Promise.allSettled([
        recordReferralPayout(reward.id,payout,"test-admin",valid),
        recordReferralPayout(reward.id,payout,"test-admin",valid),
      ]);
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(results.filter(r=>r.status==="rejected").length,1);
      assert.equal((await memberReferrals(ownerId)).paid_cents,1000);
      assert.equal((await memberReferrals(ownerId)).rewards[0].payout_reference,null);
    });
    await t.test("refund after payout flags review and preserves original receipt",async()=>{
      const result=await refreshReferralReward(reward.id,async()=>"refunded");
      assert.equal(result.status,"review_required"); assert.equal(result.review_flag,true);
      assert.equal(result.payout_reference,payout.reference); assert.ok(result.paid_at);
      assert.equal((await memberReferrals(ownerId)).paid_cents,1000);
    });
    await t.test("securely linked guest payment after capture but before signup still qualifies",async()=>{
      const guestReceipt=await captureReferral(ownerCode,null,false);
      const guest=await account();
      const guestProject=await paidProject(guest,true);
      // Simulate an earlier guest payment; the trusted provider-qualified owner is linked later.
      await pool.query(`UPDATE pitch_review_checkouts SET paid_at=(
        SELECT captured_at+interval '1 millisecond' FROM referral_receipts
        WHERE token_hash=encode(sha256($1::bytea),'hex')) WHERE project_id=$2`,[guestReceipt.token,guestProject]);
      await enrollReferralMember(guest,guestReceipt.token);
      const guestReward=(await pool.query(`SELECT r.project_id,c.paid_at,m.account_created_at
        FROM referral_rewards r JOIN referral_members m ON m.id=r.referred_id
        JOIN pitch_review_checkouts c ON c.session_id=r.session_id WHERE r.referred_id=$1`,
        [referralIdentityId(guest)])).rows[0];
      assert.ok(guestReward);
      assert.ok(guestReward.paid_at < guestReward.account_created_at);
      const result=(await referralLedger(1)).rows.find(row=>row.referral_id===referralIdentityId(guest));
      assert.equal(result?.project_id,guestProject);assert.equal(result?.reward?.status,"eligible");
    });
  } finally {
    const ids=users.map(referralIdentityId);
    await pool.query("DELETE FROM referral_rewards WHERE referred_id=ANY($1::text[]) OR referrer_id=ANY($1::text[])",[ids]);
    await pool.query("DELETE FROM referral_receipts WHERE referrer_id=ANY($1::text[])",[ids]);
    await pool.query("DELETE FROM referral_members WHERE id=ANY($1::text[])",[ids]);
    await pool.query("DELETE FROM pitch_review_checkouts WHERE project_id=ANY($1::int[])",[projects]);
    await pool.query("DELETE FROM projects WHERE id=ANY($1::int[])",[projects]);
    await pool.query("DELETE FROM filmmakers WHERE id=ANY($1::int[])",[filmmakers]);
    await pool.query("DELETE FROM visitors WHERE visitor_id=ANY($1::text[])",[visitors]);
    await pool.query("DELETE FROM replit_auth_users WHERE id=ANY($1::uuid[])",[users.map(u=>u.uid)]);
    await pool.end();
  }
});
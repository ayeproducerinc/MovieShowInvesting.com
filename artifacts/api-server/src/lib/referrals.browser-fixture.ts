// Development-only browser fixtures. Credentials stay in a private temporary file.
import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { pool } from "@workspace/db";
import { enrollReferralMember, memberReferrals } from "./referrals";
import { startReviewCheckout, reconcileReviewCheckouts } from "./pitch-review-payments";

const path="/tmp/msi-referrals-browser.json";
if(process.env.NODE_ENV==="production") throw new Error("Browser fixtures are development only");
const command=process.argv[2];
type State = {
  run:string; aliceUid:string; aliceToken:string; code:string; existingUid:string; existingToken:string;
  adminToken:string; bobUid?:string; bobToken?:string; visitorId?:string; filmmakerId?:number;
  projectId?:number; checkoutUrl?:string;
};
const account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!);
const app=getApps().find(a=>a.name==="msi-admin") ?? initializeApp({credential:cert(account)},"msi-admin");
const auth=getAuth(app);
let state:State;
async function persist(){await writeFile(path,JSON.stringify(state),{mode:0o600});}
async function newUser(run:string,label:string){
  const uid=`ref-browser-${run}-${label}`;
  const email=`${uid}@example.invalid`;
  await auth.createUser({uid,email,emailVerified:true});
  return {uid,email,token:await auth.createCustomToken(uid)};
}
try {
  if(command==="setup"){
    const run=randomUUID().slice(0,8);
    const alice=await newUser(run,"alice");
    const existing=await newUser(run,"existing");
    const admin=await auth.getUserByEmail(process.env.ADMIN_EMAIL!);
    const id=await enrollReferralMember({uid:alice.uid,email:alice.email,provider:"firebase",phoneNumber:null},null);
    state={run,aliceUid:alice.uid,aliceToken:alice.token,code:(await memberReferrals(id)).code,
      existingUid:existing.uid,existingToken:existing.token,adminToken:await auth.createCustomToken(admin.uid)};
    await persist();
    console.log("Private development browser credentials prepared.");
  }else{
    state=JSON.parse(await readFile(path,"utf8"));
    if(command==="referred"){
      const bob=await newUser(state.run,"bob");
      state.bobUid=bob.uid;state.bobToken=bob.token;await persist();
      console.log("New referred test account prepared AFTER referral capture.");
    }else if(command==="pitch"){
      if(!state.bobUid)throw new Error("Create referred account first");
      state.visitorId=randomUUID();
      await pool.query("INSERT INTO visitors(visitor_id) VALUES($1)",[state.visitorId]);
      state.filmmakerId=(await pool.query(`INSERT INTO filmmakers(name,email,firebase_uid,visitor_id)
        VALUES('Referral browser fixture',$1,$2,$3) RETURNING id`,
      [`${state.bobUid}@example.invalid`,state.bobUid,state.visitorId])).rows[0].id;
      state.projectId=(await pool.query(`INSERT INTO projects(filmmaker_id,title,slug,approved,hidden,showcase_requested)
        VALUES($1,'REFERRAL BROWSER FIXTURE',$2,false,false,false) RETURNING id`,
      [state.filmmakerId,`ref-browser-${state.run}`])).rows[0].id;
      await persist(); // Persist IDs before the external sandbox request, for reliable cleanup.
      if(!process.env.REPLIT_DOMAINS)process.env.REPLIT_DOMAINS=process.env.REPLIT_DEV_DOMAIN;
      state.checkoutUrl=await startReviewCheckout(state.projectId!,state.visitorId);
      await persist();console.log("Sandbox-only review checkout prepared; URL remains in private fixture file.");
    }else if(command==="reconcile"){
      await reconcileReviewCheckouts(state.projectId);
      console.log("Sandbox review payment checked with the provider.");
    }else if(command==="list"){
      await pool.query("UPDATE projects SET approved=true,hidden=false,showcase_requested=true,review_decision='approved' WHERE id=$1 AND review_paid_at IS NOT NULL",[state.projectId]);
      console.log("Only the paid browser-fixture project was publicly listed.");
    }else if(command==="cleanup"){
      const uids=[state.aliceUid,state.existingUid,state.bobUid].filter(Boolean);
      const ids=uids.map(uid=>`firebase:${uid}`);
      await pool.query("DELETE FROM referral_rewards WHERE referred_id=ANY($1::text[]) OR referrer_id=ANY($1::text[])",[ids]);
      await pool.query("DELETE FROM referral_receipts WHERE referrer_id=ANY($1::text[])",[ids]);
      await pool.query("DELETE FROM referral_members WHERE id=ANY($1::text[])",[ids]);
      if(state.projectId){
        await pool.query("DELETE FROM pitch_review_checkouts WHERE project_id=$1",[state.projectId]);
        await pool.query("DELETE FROM projects WHERE id=$1",[state.projectId]);
        await pool.query("DELETE FROM filmmakers WHERE id=$1",[state.filmmakerId]);
        await pool.query("DELETE FROM visitors WHERE visitor_id=$1",[state.visitorId]);
      }
      await Promise.all(uids.map(uid=>auth.deleteUser(uid!)));
      await unlink(path);
      console.log("Only created referral browser fixtures and temporary credentials removed.");
    }else throw new Error("Unknown fixture command");
  }
}finally{await pool.end();}
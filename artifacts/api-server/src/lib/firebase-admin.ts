import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

export class FirebaseConfigurationError extends Error {}

function getFirebaseAdminAuth() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new FirebaseConfigurationError("FIREBASE_SERVICE_ACCOUNT_JSON has not been configured.");
  }

  let serviceAccount: unknown;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new FirebaseConfigurationError("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }

  const app = getApps().find((existingApp) => existingApp.name === "msi-admin")
    ?? initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]) }, "msi-admin");
  return getAuth(app);
}

export async function verifyFirebaseIdToken(token: string) {
  return getFirebaseAdminAuth().verifyIdToken(token, true);
}
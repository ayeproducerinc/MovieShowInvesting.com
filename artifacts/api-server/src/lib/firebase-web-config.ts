import { cert } from "firebase-admin/app";

type WebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
};

type FirebaseWebApp = { name?: string; appId?: string };

let cached: { value: WebConfig; expiresAt: number } | null = null;
let pending: Promise<WebConfig> | null = null;

async function firebaseResponse<T>(url: string, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Firebase Management API returned HTTP ${response.status}.`);
  }
  return await response.json() as T;
}

async function loadWebConfig(): Promise<WebConfig> {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("Firebase service account is not configured.");

  let account: { project_id?: string };
  try {
    account = JSON.parse(serviceAccountJson) as typeof account;
  } catch {
    throw new Error("Firebase service account is not valid JSON.");
  }
  if (!account.project_id) throw new Error("Firebase service account has no project ID.");

  const { access_token: token } = await cert(account as Parameters<typeof cert>[0]).getAccessToken();
  const projectPath = `projects/${encodeURIComponent(account.project_id)}`;
  const apps = await firebaseResponse<{ apps?: FirebaseWebApp[] }>(
    `https://firebase.googleapis.com/v1beta1/${projectPath}/webApps?pageSize=100`,
    token,
  );
  const webApps = apps.apps ?? [];
  const selected = webApps.length === 1
    ? webApps[0]
    : webApps.find((app) => app.appId === process.env.FIREBASE_APP_ID);
  if (!selected?.name || (webApps.length > 1 && !process.env.FIREBASE_APP_ID)) {
    throw new Error("Select a Firebase web app; the project has no unambiguous web app.");
  }

  const config = await firebaseResponse<Partial<WebConfig>>(
    `https://firebase.googleapis.com/v1beta1/${selected.name}/config`,
    token,
  );
  if (!config.apiKey || !config.authDomain || !config.appId || config.projectId !== account.project_id) {
    throw new Error("Firebase returned incomplete or mismatched web app configuration.");
  }
  return {
    apiKey: config.apiKey,
    authDomain: config.authDomain,
    projectId: config.projectId,
    appId: config.appId,
  };
}

export function getFirebaseWebConfig(): Promise<WebConfig> {
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
  if (!pending) {
    pending = loadWebConfig()
      .then((value) => {
        cached = { value, expiresAt: Date.now() + 60 * 60 * 1000 };
        return value;
      })
      .finally(() => { pending = null; });
  }
  return pending;
}
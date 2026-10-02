#!/usr/bin/env node
// Regression: clearing private auth data must not orphan the mounted public counter.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const requireApi = createRequire(path.resolve("artifacts/api-server/package.json"));
const requireWeb = createRequire(path.resolve("artifacts/movie-show-investing/package.json"));
const { QueryClient, QueryObserver } = requireWeb("@tanstack/react-query");
const bundle = path.resolve(`artifacts/movie-show-investing/.community-cache-test-${randomUUID()}.mjs`);
await requireApi("esbuild").build({
  entryPoints: ["artifacts/movie-show-investing/src/lib/homepage-community.ts"],
  outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external",
  alias: { "@workspace/api-client-react": path.resolve("lib/api-client-react/src/index.ts") },
  logLevel: "silent",
});
const { clearPrivateAuthQueries, refreshCommunityCount } = await import(pathToFileURL(bundle).href);
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const key = ["/api/stats"];
let resolveOld;
let calls = 0;
const fetchCount = async () => {
  calls++;
  if (calls === 1) return new Promise(resolve => { resolveOld = resolve; });
  return { filmmakers: 2 };
};
const observer = new QueryObserver(client, {
  queryKey: key, queryFn: fetchCount, initialData: { filmmakers: 1 }, staleTime: Infinity,
});
const seen = [];
const unsubscribe = observer.subscribe(result => seen.push(result.data?.filmmakers));
try {
  client.setQueryData(["/api/private-account"], { label: "previous identity" });
  client.getMutationCache().build(client, { mutationFn: async () => null });
  const queryBefore = client.getQueryCache().find({ queryKey: key });
  const pendingOldRequest = client.fetchQuery({ queryKey: key, queryFn: fetchCount, staleTime: 0 }).catch(() => null);
  await Promise.resolve();
  clearPrivateAuthQueries(client);
  assert.equal(client.getQueryCache().find({ queryKey: key }), queryBefore, "mounted public Query object must survive sign-in");
  assert.equal(client.getQueryData(["/api/private-account"]), undefined, "old identity data must be removed");
  assert.equal(client.getMutationCache().getAll().length, 0, "old mutations must be removed");
  await refreshCommunityCount(client, 2);
  resolveOld({ filmmakers: 1 });
  await pendingOldRequest;
  assert.equal(client.getQueryData(key).filmmakers, 2, "late pre-join response must not overwrite authoritative total");
  assert.equal(observer.getCurrentResult().data.filmmakers, 2, "already-mounted homepage observer must update");
  assert(seen.includes(2), "existing observer must receive the new total without remount/reload");
  console.log("PASS community cache: private data cleared, mounted observer retained, immediate counter update, delayed old response cancelled.");
} finally {
  unsubscribe();
  client.clear();
  await unlink(bundle);
}
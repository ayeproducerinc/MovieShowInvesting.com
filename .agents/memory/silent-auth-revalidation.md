---
name: Silent background auth revalidation
description: Focus/visibility/other-tab session checks must not flip auth loading or clear the bearer token
---

`lib/replit-auth-web/src/use-auth.ts` re-checks `/api/auth/user` on window focus, visibility, `storage` and BroadcastChannel events. After the first check resolves, those background checks run silently: no `loading = true`, no `setAuthTokenGetter(null)`. They still call `setUser`, so a real sign-out or account switch still re-renders.

**Why:** Pages gate their whole body on `authLoading` (`pages/filmmaker.tsx`, `pages/filmmaker-done.tsx`). Flipping it on every focus (closing the file picker, returning from a tab, the Replit preview iframe) unmounted the worksheet. That dropped chosen files, jumped to the top and looked like a white refresh, and API calls lost the Firebase token mid-upload.

**How to apply:** Keep background revalidation silent. Show a full-page loading state only for the initial check or an explicit login/logout. Pass stable callbacks (`useCallback`) to `DraftPitchMaterials`' `onErrorChange`; an inline callback re-fires its effect every render and wipes worksheet messages.

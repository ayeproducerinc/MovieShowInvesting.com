---
name: Protected Bunny thumbnails
description: Why generated Stream thumbnail URLs may not be directly accessible
---

Bunny Stream video metadata can include a generated `thumbnailUrl`, but the underlying CDN may require a signed URL. The Stream API key authenticates metadata requests; it does not authorize CDN thumbnail downloads. The Stream API's thumbnail endpoint sets images rather than fetching them.

**Why:** In the shared Stream library, an encoded temporary video returned a thumbnail URL, but both direct CDN GET and GET with the Stream API key returned HTTP 403. A GET to the Stream thumbnail API endpoint returned HTTP 405.

**How to apply:** Retrieve metadata with the Stream API key, then use the associated Pull Zone's URL Token Authentication key to sign CDN access on the server. Do not expose either secret in the browser, and treat a missing image during encoding separately from an access error. Keep any read proxy owner-scoped.
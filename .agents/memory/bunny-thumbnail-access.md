---
name: Stream thumbnail fallback
description: Why the MVP uses a poster or video-only placeholder rather than fetching Stream thumbnails
---

Bunny Stream video metadata can include a generated `thumbnailUrl`, but it is not guaranteed to be publicly retrievable. The Stream API key authenticates metadata requests; it does not authorize CDN thumbnail downloads. The Stream API's thumbnail endpoint sets images rather than fetching them.

**Why:** The shared library's encoded video thumbnail returned HTTP 403 both directly and with the attempted Pull Zone signing approaches. The user's visible CDN security screen belonged to the separate image Storage zone; changing either shared zone's settings risks other products. The owner accepted using the uploaded poster as the trailer preview, with a labeled video-only placeholder when no poster is supplied.

**How to apply:** Keep this no-key preview approach for the MVP and make both states persist from saved project data. Do not retry protected Stream thumbnail fetching or modify shared Bunny security without new owner direction. If true generated frames become necessary later, verify access to the exact Stream Pull Zone before adding a thumbnail endpoint; never expose provider credentials to browsers.
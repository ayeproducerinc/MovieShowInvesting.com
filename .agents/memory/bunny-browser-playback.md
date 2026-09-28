---
name: Bunny browser playback
description: Distinguishing embedded preview codec failures from Bunny Stream media failures.
---

A preview browser can report `manifestIncompatibleCodecsError` for a fully processed Bunny Stream trailer with ordinary H.264/AAC variants, while a separate Chromium build can load and play that same video. Neither a ready transcoding status nor a preview error alone establishes whether viewers can play it.

**Why:** Treating a browser-specific codec limitation as a corrupt upload could prompt needless changes to valid media or shared Bunny configuration.

**How to apply:** When playback is in doubt, inspect the video's processing state and codec variants without exposing signed media URLs, then verify that playback time advances without a media error in another real browser. Preserve a separate-window player link for embedding failures; do not alter or delete existing shared media to test.
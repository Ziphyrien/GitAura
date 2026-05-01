# Share Button Pending State

## Goal

Show clear in-progress feedback after the Share button is clicked, because medium Nostr shares can take several seconds while relay discovery, probing, publishing, and clipboard handling run.

## Requirements

- When Share is clicked, the Share action enters a pending state immediately.
- While pending, the Share button stays visually active/highlighted and shows a spinning refresh/loading icon.
- While pending, Share should be disabled to prevent duplicate publish attempts.
- Copy as Markdown can remain usable unless the shared action component cannot separate disabled states cleanly.
- Pending state must clear when:
  - share link is copied successfully,
  - manual share link dialog appears after clipboard access is blocked,
  - share creation fails.
- Preserve existing manual-copy fallback dialog for clipboard permission failures.
- Do not change share link protocol, relay discovery, relay verification, storage, backend, or DB behavior.

## Acceptance Criteria

- [ ] Share button visually indicates pending state with a spinning refresh/loading icon.
- [ ] Share button is disabled during pending state.
- [ ] Pending state clears after success, manual fallback, or error.
- [ ] Type-check passes for changed package(s).

## Notes

- UI files: `packages/ui/src/components/chat.tsx`, `packages/ui/src/components/session-utility-actions.tsx`.
- Existing Share action lives in `Chat.handleShareSession()`.

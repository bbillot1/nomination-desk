## Summary

- What changed and why?

## Verification

- [ ] Relevant tests, type checks, and lint checks pass.
- [ ] `scripts/check-commit-safety.sh --history` passes.
- [ ] The staged diff contains no credentials, private data, generated artifacts, or local configuration.
- [ ] Browser code contains no server-only keys or service-role access.
- [ ] Database changes use reviewed migrations and preserve the approval/audit invariants.
- [ ] The change remains within the current `BUILD_SPEC.md` phase and scope.

## Risk and rollback

- Risk:
- Rollback:

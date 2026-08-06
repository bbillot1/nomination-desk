# Contributing Safely

## Branch workflow

1. Start from an up-to-date `main`.
2. Create a narrowly scoped feature branch.
3. Make small commits that each leave the project runnable.
4. Push the feature branch and open a pull request.
5. Merge only after repository-safety and project checks pass.

Direct and non-fast-forward pushes to `main` are blocked by the local pre-push hook. GitHub
branch protection is not currently available for this private repository on its present plan,
so the checked-in hook and pull-request workflow are the local enforcement layer.

## Commit checklist

- Inspect `git status`.
- Review staged and unstaged diffs separately.
- Stage explicit paths, never the entire working tree blindly.
- Confirm no secret, private data, local configuration, database dump, or large artifact is
  included.
- Run `scripts/check-commit-safety.sh --staged`.
- Run the tests and checks relevant to the changed code.
- Use a concise message describing why the change exists.

Never bypass a hook. A blocked operation requires a code or staging fix, not `--no-verify`.

## Build-spec discipline

`BUILD_SPEC.md` is the frozen source of truth. Implement its phases in order and stop at each
documented gate. Specification changes require an explicit request and separate review.

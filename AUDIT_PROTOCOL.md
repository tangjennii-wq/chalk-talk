# Audit protocol — pin the SHA

Three reviews in one day arrived against a commit that had already been superseded. Each cost a full
round trip: findings already fixed reported as open, a fix number matched to the wrong review's
numbering, and — the expensive one — me replying "already done" to a finding that was genuinely live,
because I matched *his* item #3 to a *different* list's item N3.

None of that was carelessness on either side. It is what happens when a review names findings by position
and the tree moves underneath it. The fix is to make the mismatch a hard failure instead of a discussion.

## Start every audit prompt with this

```
Audit exact HEAD: $(git rev-parse HEAD)
First print `git log -1 --oneline` and abort if its SHA differs.
```

## End every review with this

> Reviewed at `<sha>`.

## Why both halves are needed

The opening line makes the reviewer *check*; the closing line makes the result *falsifiable*. With only
the first, a review that drifted mid-run still reports as authoritative. With only the second, you find
out after the work.

## Two habits that go with it

**Refer to findings by name, not number.** "the image-key exposure on `handleImageGeneration`" survives a
rebase; "#3" does not, and silently means something else in the next list.

**Before replying "already fixed", show it.** `grep`/`git log` output in the reply, not an assertion. I
was wrong once this session while feeling certain, and the check would have caught it in seconds. It is
also the cheaper move even when you are right — it ends the exchange instead of extending it.

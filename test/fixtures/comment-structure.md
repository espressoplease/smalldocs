---
title: Release operations field guide
---

# Release operations field guide

This guide combines lists, code, quotations, and repeated phrases. Leave comments on individual words, complete items, and paragraphs, then switch between reading and commenting to check that the document stays intact.

## Prepare the release

3. **Confirm the target.** Check the release name, service, and region.

   Record the planned maintenance window. The production limit is **20 minutes**. Keep this second paragraph attached to step three.

   - Review the customer-facing change notes.
   - Check the dependency report.

     This bullet has its own second paragraph, with `release_id` in inline code and a [deployment guide](https://example.com/deploy).

     1. Inspect the runtime version.
     2. Inspect the database version.

   After the nested list, record the final release owner. This paragraph still belongs to step three.

4. **Run the checks.** Keep the test results with the release record.

   ```javascript
   async function prepareRelease(client, releaseId) {
     const release = await client.read(releaseId);
     if (!release.approved) {
       throw new Error('Approval is missing');
     }
     return { releaseId, ready: true };
   }
   ```

   The code belongs to step four. A comment on `release.approved` should stay with the code.

5. **Notify the operator.** Record the handoff in the change log.

   > The operator should confirm the target and the maintenance window.
   >
   > Keep this second quoted paragraph with the same handoff.

6. **Keep a rollback ready.** Save the previous revision before deploying.

## During the deployment

- Watch the error rate and the request queue.

  Keep a written observation every five minutes. This is a second paragraph within a bullet.

  7. Check the request timeout.
  8. Check the queue age.

     - Capture the oldest request ID.
     - Capture the current worker count.

  Continue watching after the nested checklist ends.

- Verify that the health endpoint returns a successful response.

  ```sh
  curl --fail --silent https://example.com/health
  printf '%s\n' 'Health check complete'
  ```

- Compare the result with the baseline.

## Repeated wording and formatting

1. Keep the phrase **check the target** in the preparation notes.
2. Keep the phrase **check the target** in the rollback notes.
3. Change only the occurrence the reviewer selected.

A phrase can cross **bold text**, *italic text*, `inline_code`, and a [link to more detail](https://example.com/detail). Select across these boundaries to test an inline comment without changing the formatting.

## A separate code example

```python
def retry_delays(attempts):
    for attempt in range(attempts):
        yield min(2 ** attempt, 30)

print(list(retry_delays(5)))
```

## Release record

| Check | Owner | Result |
| --- | --- | --- |
| Build | Alex | Passed |
| Database | Priya | Passed |
| Rollback | Maya | Ready |

## Close the release

1. Review each open comment against the final document.
2. Make the requested change and verify the saved passage.
3. Resolve addressed feedback, or delete it when the discussion is no longer needed.
4. Leave unresolved questions open with a short explanation.

The document should keep the same list numbering, nesting, code, and paragraph structure while feedback is added, edited, resolved, or deleted.

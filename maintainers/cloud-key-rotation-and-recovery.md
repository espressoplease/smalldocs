# Cloud key rotation and recovery

## Scope

Project-key rotation replaces the AES-256 key used for a project's document
revisions, protected metadata, creator source paths and encrypted retry receipts.
It also rebuilds the project's keyed search dictionary, postings and tags. It
does not create document revisions, change their identifiers, timestamps or
authors, alter permissions, publish content, or shorten the 90-day history window.
Retained revisions of soft-deleted documents are included.

Workspace-value keys, used for library names and invitation or notification
values, are separate. This operation does not replace those keys. Changing to a
different KMS root key is also a separate migration, not this command.

## Two rotation layers

AWS KMS automatic rotation replaces the KMS key's internal material. Its logical
key reference remains usable for older wrapped keys. It neither rotates our AES
project keys nor re-encrypts the document database.

Project-key rotation creates the next project key version and wraps it through
the configured key provider. Existing encrypted values authenticate with their
stored key versions. Old wrapped key records remain available for recovery.
`retired_at_ms` means not used for new writes; it does not disable or delete a
key in KMS.

## Maintenance transaction

1. Read the current project key version and unwrap its retained key versions.
2. Generate and wrap a new random key.
3. In one immediate SQLite transaction, verify the expected version, insert the
   wrapped key, re-encrypt project name, every retained revision, creator paths
   and retry receipts, then rebuild the complete search index with the new key.
4. Switch the project's active key version, mark old versions retired and append
   a `project.key.rotate` audit event in the same transaction.
5. Clear working key buffers on success and failure.

Ciphertext is processed in batches of eight rows. Memory does not grow with the
whole library's plaintext. A malformed authentication tag, missing key, failed
KMS call, search-index failure or concurrent rotation aborts the operation. No
partially rotated project becomes visible. SQLite rollback also covers a process
exit before commit.

An in-flight write prepared with an old key cannot commit after the switch. It
returns a retryable `temporary_service_failure`; retrying its idempotency key
saves once using the active key. Search also rechecks its key version after
asynchronous work. A search spanning a rotation asks the caller to retry instead
of returning an incomplete result or mixing key generations.

## Operator commands

Use the matching deployment environment, database, idempotency secret and key
provider. Keep administrative KMS permissions outside the application identity.
The operator command is not exposed through the public API or end-user CLI.

```sh
node ops/cloud-key-rotation.js status --project PROJECT_ID
node ops/cloud-key-rotation.js rotate --project PROJECT_ID --backup /secure/backups/before-rotation.db
node ops/cloud-key-rotation.js verify-backup --backup /secure/backups/before-rotation.db --sha256 HASH_FROM_BACKUP_RECEIPT
```

`rotate` always creates a consistent SQLite backup using the backup API before
rotating. It includes committed WAL state, refuses to overwrite an existing
backup, creates the file with mode `0600` and returns its SHA-256. The receipt is
printed before rotation starts, so a failed operation still leaves a usable
backup reference. Store the receipt with the encrypted backup.

Use a maintenance window for a large project. The atomic write transaction holds
SQLite's writer lock while it runs. This first implementation prioritises atomic
recovery over zero-downtime rotation; it is not a scheduled background task.
Deploy version-aware readers and writers before rotating any live project. An
older application that assumes key version 1 cannot be a rollback target after
rotation. Restoring the pre-rotation database also discards later writes, so a
code rollback must normally use a version-aware release instead.

## Recovery requirements

Preserve all of the following:

- The encrypted database snapshot, including wrapped key records.
- Its checksum and the matching application configuration, including the
  idempotency secret used to authenticate retry receipts.
- Access to every KMS key reference needed by that snapshot, through a separate
  recovery identity. A backup uploader should not gain restore permissions.
- A compatible application release and the documented database location.

Full-service recovery also restores the authentication, billing and job databases
from the coordinated service archive. This command validates the Cloud document
database; it does not reconstruct those other stores from document user IDs.

Do not export a plaintext KMS root key into an archive. Automatic KMS rotation
retains old internal key material. Disabling or permanently deleting a referenced
KMS key can make backups unrecoverable. Never remove a reference merely because
no current document uses it; retained backups may still need it.

`verify-backup` validates the supplied checksum, copies the snapshot to an
isolated temporary directory, opens it using fresh provider caches, checks SQLite
integrity and foreign keys, and authenticates workspaces, project names, current
and historical revisions, source paths, retry receipts and searchable metadata.
It reports counts, not document content or keys, and removes the temporary copy.
It does not overwrite the live database or contact billing, email or webhooks.

```sh
npm run cloud:kms:recovery-smoke
```

The KMS smoke uses only synthetic documents in temporary databases. It creates
snapshots before and after project-key rotation, discards the original process's
cache, and proves both snapshots open with new KMS clients. It uses the configured
key's Encrypt and Decrypt permissions only. It does not rotate, disable or delete
the KMS root key or touch the configured live Cloud database.

Set `CLOUD_RECOVERY_DRILL_OUTPUT` to a private directory to retain the synthetic
before/after snapshots and their generated fixture configuration for an off-site
drill. `fixture.json` contains a test-only idempotency secret and snapshot
checksums, not AWS credentials. Upload the archive using the backup writer,
retrieve it using the recovery identity, verify the archive and individual
snapshot checksums, and run the backup verifier with new KMS clients. Remove
local copies after verification. A locked off-site fixture follows the bucket's
retention lifecycle.

## Validation

`test/test-cloud-key-rotation.js` covers history and content preservation, key
version changes, replay receipts, comments and resolution, restores, moves,
creator-only paths, member and company isolation, search and tag filters,
soft-deleted documents, late rollback, KMS failures, stale rotations, races through
a second database connection, cold restores across root-key generations and the
actual operator commands.

Production automatic KMS rotation and access policies must be checked through
AWS, not inferred from source code. A restore test of synthetic local snapshots
does not establish that the off-site backup bucket and recovery identity work.
Repeat an off-site restore and decrypt drill before production launch.

## References

- [AWS envelope encryption](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)
- [AWS KMS encryption context](https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html)
- [AWS KMS least privilege](https://docs.aws.amazon.com/kms/latest/developerguide/least-privilege.html)
- [AWS KMS key rotation](https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html)

These describe the mechanisms and operational requirements. They are not a
certification or an independent audit of SmallDocs.

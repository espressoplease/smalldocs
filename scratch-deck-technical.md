---
title: "Migrating to Postgres 16"
---

~~~slide
@extends cover
#eyebrow: Platform Engineering
#title: Migrating to Postgres 16
#subtitle: Cutting over our primary OLTP cluster from 13.11 to 16.3
#meta: Internal tech talk - Data Infrastructure - Q2 2026
~~~

~~~slide
@extends section
#kicker: Why now
#title: Postgres 13 is past its useful life for us
#subtitle: End of upstream support, and we are leaving real performance on the table
~~~

~~~slide
@extends title-body
#title: What we get on 16
#body:
- Logical replication can now run from a standby, so we cut over with the primary still serving reads
- Parallel application of large `COPY` streams during the load phase
- Better query planning for correlated columns via extended statistics
- `pg_stat_io` gives us per-backend I/O accounting we never had on 13
- SCRAM is the default; we finally retire `md5` auth across the fleet
#footer: All numbers below come from a two-week shadow run on production-sized data
~~~

~~~slide
@extends two-column
#title: How we are doing the cutover
#left-header: Before (Postgres 13.11)
#left:
- Single primary, two streaming replicas
- `md5` password auth
- Nightly `pg_dump` logical backups, 4h 20m to restore
- Manual failover runbook, ~12 min of downtime in the last drill
#right-header: After (Postgres 16.3)
#right:
- Logical replication from a 16 standby, near-zero-downtime switch
- SCRAM-SHA-256 everywhere
- Continuous WAL archiving to object storage, point-in-time recovery
- Patroni-managed failover, target under 30s
~~~

~~~slide
@extends metric
#metric: 41% faster
#context: Median latency on our hottest join-heavy endpoint dropped from 38ms to 22ms p50 in the shadow run, driven mostly by the improved planner handling of our multi-column predicates.
~~~

~~~slide
@extends metric
#metric: 18 seconds
#context: Measured write-path downtime during the logical-replication cutover rehearsal, down from the 11-12 minutes our old dump-and-restore failover took. The window is just the time to promote the 16 standby and flip the connection string.
~~~

~~~slide
@extends three-column
#title: Risks we tracked, and what we did about them
#left-header: Risk
#left:
- Sequence values not carried by logical replication
- Extension version drift (`pg_stat_statements`, `postgis`)
- Long-running transactions blocking the cutover
#mid-header: Blast radius
#mid:
- Duplicate primary keys on first write after switch
- Queries fail at parse time on the new node
- Replication lag never reaches zero, cutover stalls
#right-header: Mitigation
#right:
- Script to reset all sequences from `max(id)` post-switch
- Pin and pre-install matching extension builds on 16
- Kill switch on transactions older than 5 min during the window
~~~

~~~slide
@extends quote
#lead: Logical replication is great until you forget that it does not replicate sequences, large objects, or DDL. The cutover checklist exists because we learned each of those the hard way.
#attribution: Postmortem, staging cutover #2
~~~

~~~slide
@extends closing
#lead: Cutover window is Saturday 03:00 UTC. Read the runbook, claim a role on the rota.
#contact: #postgres-migration on Slack - runbook in the infra wiki
~~~

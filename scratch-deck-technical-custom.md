---
title: "Migrating to Postgres 16"
---

~~~slide
grid 100 56.25 bg=#0f172a
r 8 17.5 0.6 4 fill=#38bdf8
r 9.7 17.4 70 4 align=left valign=center size=18px color=#38bdf8 | PLATFORM ENGINEERING
r 7.8 23 86 8 text=title align=left color=#f1f5f9 | Migrating to Postgres 16
l 8 33.6 46 33.6 stroke=#1e3a5a strokeWidth=0.08
r 7.8 35 78 7 align=left valign=center size=27px color=#94a3b8 | Cutting over our primary OLTP cluster from 13.11 to 16.3
r 7.8 49.5 84 3 align=left valign=center size=17px color=#64748b | Internal tech talk - Data Infrastructure - Q2 2026
~~~

~~~slide
grid 100 56.25 bg=#082f49
r 8 17 0.6 4 fill=#38bdf8
r 9.7 16.9 60 4 align=left valign=center size=19px color=#38bdf8 | WHY NOW
r 7.8 22 86 14 text=title align=left color=#f1f5f9 | Postgres 13 is past its useful life for us
r 7.8 39 80 7 align=left valign=center size=25px color=#9fc7dd | End of upstream support, and we are leaving real performance on the table
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4.3 0.55 3.4 fill=#38bdf8
r 5.5 4.2 70 3 align=left valign=center size=17px color=#38bdf8 | WHAT POSTGRES 16 GIVES US
r 3.9 8 90 7 text=subtitle align=left color=#f1f5f9 | What we get on 16
icon 5 16.2 4.4 4.4 name=database-zap color=#38bdf8
r 11 16 84 5 align=left valign=center size=21px color=#e2e8f0 | **Logical replication from a standby**, so we cut over with the primary still serving reads
icon 5 23.4 4.4 4.4 name=layers color=#38bdf8
r 11 23.2 84 5 align=left valign=center size=21px color=#e2e8f0 | **Parallel apply** of large COPY streams during load
icon 5 30.6 4.4 4.4 name=trending-up color=#38bdf8
r 11 30.4 84 5 align=left valign=center size=21px color=#e2e8f0 | **Better query planning** for correlated columns via extended statistics
icon 5 37.8 4.4 4.4 name=activity color=#38bdf8
r 11 37.6 84 5 align=left valign=center size=21px color=#e2e8f0 | **pg_stat_io** gives per-backend I/O accounting
icon 5 45 4.4 4.4 name=shield-check color=#38bdf8
r 11 44.8 84 5 align=left valign=center size=21px color=#e2e8f0 | **SCRAM is the default** now; retire md5
l 4 52.4 96 52.4 stroke=#1e293b strokeWidth=0.06
r 4 53 90 2.5 align=left valign=center size=15px color=#64748b | Numbers from a two-week shadow run on production-sized data.
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4.3 0.55 3.4 fill=#38bdf8
r 5.5 4.2 70 3 align=left valign=center size=17px color=#38bdf8 | THE CUTOVER
r 3.9 8 90 7 text=subtitle align=left color=#f1f5f9 | How we are doing the cutover
r 4 16 44 4.6 fill=#1e293b align=left valign=center padding=1.6 size=18px color=#94a3b8 | BEFORE  ·  Postgres 13.11
r 4 20.6 44 25 fill=#16202e align=left valign=top padding=2 size=18px color=#cbd5e1 |
  - Single primary + two streaming replicas
  - md5 auth
  - Nightly pg_dump, **4h 20m** to restore
  - Manual failover, **~12 min** downtime in last drill
r 52 16 44 4.6 fill=#38bdf8 align=left valign=center padding=1.6 size=18px color=#082f49 | AFTER  ·  Postgres 16.3
r 52 20.6 44 25 fill=#16202e align=left valign=top padding=2 size=18px color=#cbd5e1 |
  - Logical replication from a 16 standby, **near-zero-downtime** switch
  - **SCRAM-SHA-256** everywhere
  - Continuous WAL archiving to object storage, **PITR**
  - Patroni-managed failover, **target under 30s**
r 4 48 92 5.4 fill=#11203a align=center valign=center size=20px color=#e2e8f0 | Restore  **4h 20m → near-zero**       ·       Failover  **~12 min → under 30s**
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4.3 0.55 3.4 fill=#38bdf8
r 5.5 4.2 80 3 align=left valign=center size=17px color=#38bdf8 | MEDIAN LATENCY  ·  SHADOW RUN
r 3.5 11 56 26 align=left valign=center size=210px color=#38bdf8 | **41%**
r 4 36.5 56 7 align=left valign=center size=40px color=#e2e8f0 | faster
r 62 13.5 33 14 align=left valign=top size=19px color=#94a3b8 | On the hottest join-heavy endpoint, from improved planner handling of multi-column predicates.
r 62 29 33 13 fill=#1e293b align=left valign=center padding=2 color=#f1f5f9 |
  ## 38ms → 22ms
  p50 median, hottest endpoint
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4.3 0.55 3.4 fill=#38bdf8
r 5.5 4.2 80 3 align=left valign=center size=17px color=#38bdf8 | WRITE-PATH DOWNTIME  ·  CUTOVER REHEARSAL
r 3.5 11 56 26 align=left valign=center size=210px color=#38bdf8 | **18s**
r 4 36.5 56 7 align=left valign=center size=40px color=#e2e8f0 | of write downtime
r 62 13.5 33 14 align=left valign=top size=19px color=#94a3b8 | During the logical-replication cutover. The window is just promoting the 16 standby and flipping the connection string.
r 62 29 33 13 fill=#1e293b align=left valign=center padding=2 color=#f1f5f9 |
  ## 11-12 min → 18s
  old dump-and-restore failover
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 4 4.3 0.55 3.4 fill=#38bdf8
r 5.5 4.2 80 3 align=left valign=center size=17px color=#38bdf8 | WHAT COULD GO WRONG
r 3.9 8 92 7 text=subtitle align=left color=#f1f5f9 | Risks we tracked, and what we did about them
r 4 16 29.3 27 fill=#1e293b
icon 6 18 4.4 4.4 name=hash color=#38bdf8
r 6 23.6 25.3 17 align=left valign=top size=15.5px color=#cbd5e1 |
  **Sequences not carried by logical replication**

  **Blast** · duplicate PKs on the first write after the switch

  **Fix** · script to reset every sequence from max(id) post-switch
r 35.35 16 29.3 27 fill=#1e293b
icon 37.35 18 4.4 4.4 name=layers color=#38bdf8
r 37.35 23.6 25.3 17 align=left valign=top size=15.5px color=#cbd5e1 |
  **Extension version drift** (pg_stat_statements, postgis)

  **Blast** · queries fail at parse time on the new node

  **Fix** · pin and pre-install matching extension builds on 16
r 66.7 16 29.3 27 fill=#1e293b
icon 68.7 18 4.4 4.4 name=clock color=#38bdf8
r 68.7 23.6 25.3 17 align=left valign=top size=15.5px color=#cbd5e1 |
  **Long-running transactions blocking cutover**

  **Blast** · replication lag never reaches zero, cutover stalls

  **Fix** · kill switch on transactions older than 5 min in the window
~~~

~~~slide
grid 100 56.25 bg=#082f49
icon 7 11 8 8 name=quote color=#2b6a8f
r 9 21 82 22 align=left valign=top size=33px color=#eaf2f7 | Logical replication is great until you forget that it does not replicate sequences, large objects, or DDL. The cutover checklist exists because we learned each of those the hard way.
r 9 39 70 4 align=left valign=center size=20px color=#38bdf8 | Postmortem, staging cutover #2
~~~

~~~slide
grid 100 56.25 bg=#0f172a
r 8 14 0.6 4 fill=#38bdf8
r 9.7 13.9 70 4 align=left valign=center size=18px color=#38bdf8 | GO LIVE
r 7.8 20 84 9 align=left valign=center size=50px color=#f1f5f9 | Cutover window: **Saturday 03:00 UTC**
r 7.8 31 84 6 align=left valign=center size=29px color=#38bdf8 | Read the runbook, claim a role on the rota
l 8 44 50 44 stroke=#1e3a5a strokeWidth=0.08
r 7.8 46 84 4 align=left valign=center size=18px color=#94a3b8 | #postgres-migration on Slack  ·  runbook in the infra wiki
~~~

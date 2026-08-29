# AGENTS.md

## Purpose

This repository is a financial-systems test project: a distributed P2P ledger and payments platform built around event sourcing, CQRS, saga orchestration, double-entry accounting, idempotency, resilience, observability, and multiple independently deployable services.

Treat correctness of money movement as the highest priority. A change is not complete merely because the UI works or an endpoint returns `200`; the ledger invariants, failure behavior, concurrency behavior, tests, and documentation must also remain correct.

This file applies to the entire repository unless a more specific nested `AGENTS.md` overrides it.

---

## Primary objective

Extend the provided starter repository safely instead of rewriting it from scratch.

The expected system contains at least:

- `ledger-service`
- `payments-service`
- `notifications-service`
- a frontend-facing gateway/BFF
- a Next.js frontend
- an event broker
- a separate PostgreSQL database/schema per service
- Docker Compose wiring all required infrastructure together

The starter code is intentionally incomplete and contains several defects. Preserve working code where reasonable, identify the intentionally planted defects, reproduce them with tests, fix them, and document the findings.

---

## Core working rules

1. **Inspect before editing.**
   - Read the root `README.md`.
   - Inspect workspace/package manager configuration.
   - Inspect `docker-compose.yml`.
   - Inspect root and service-level `package.json` files.
   - Inspect existing tests and CI workflows.
   - Inspect existing environment files/examples.
   - Inspect existing service boundaries and communication patterns.
   - Do not assume directory names, commands, ports, ORMs, broker choices, or test runners before checking the repository.

2. **Do not rewrite working starter code without a concrete reason.**
   - Prefer small, reviewable refactors.
   - Preserve public contracts when reasonable.
   - If a breaking API/event/schema change is unavoidable, update all affected consumers and document the reason in `README.md`.

3. **Do not optimize for the shortest implementation if it weakens financial correctness.**
   - Money cannot disappear.
   - Money cannot be duplicated.
   - The same client request cannot create two transfers.
   - A retried event cannot apply the same financial effect twice.
   - Concurrent spending cannot overdraw a wallet unless overdraft is an explicit supported domain rule.

4. **Never bypass a service boundary by directly reading another service's database.**
   - Cross-service interaction must use an API and/or domain events.
   - Each service owns its own persistence.

5. **Do not introduce distributed database transactions / XA transactions.**
   - Local service consistency belongs inside a normal local DB transaction.
   - Cross-service consistency belongs to the saga/event model.

6. **Prefer the technologies and conventions already present in the repository.**
   - Do not replace the broker, ORM, test framework, logger, package manager, or auth approach just because another option is personally preferred.
   - Add a new major dependency only when it solves a concrete requirement and is justified.

7. **Do not claim completion without verification.**
   - Run the relevant lint, typecheck, unit, integration, and e2e tests.
   - Run or build the affected service.
   - For infrastructure-sensitive changes, verify Docker Compose where feasible.
   - Report any command that could not be run and why.

8. **Never hide failures.**
   - Do not weaken assertions merely to make tests green.
   - Do not delete failing tests unless the test itself is demonstrably invalid.
   - Do not add broad `try/catch` blocks that swallow errors.
   - Do not turn real failures into unconditional success responses.

9. **Keep implementation reviewable.**
   - Avoid unrelated formatting churn.
   - Avoid mass renames unless required.
   - Avoid giant all-in-one services.
   - Prefer focused commits/changes by capability.

10. **Use safe Git behavior.**
    - Do not run destructive commands such as `git reset --hard`, `git clean -fd`, force-push, or history rewriting unless explicitly instructed by the user.
    - Do not discard user changes that are outside the current task.

---

# Required discovery phase

Before substantial implementation, create a mental/review map of the repository.

Determine:

- package manager and workspace structure
- service directories
- database/ORM per service
- database migration strategy
- broker and event transport
- HTTP/GraphQL communication paths
- existing auth module and guards
- existing wallet/balance implementation
- current transfer skeleton
- current frontend data-fetching pattern
- current WebSocket support, if any
- existing observability code
- test frameworks and test scripts
- current CI commands
- current Docker Compose topology
- TODO/skipped tests
- suspicious authorization/validation paths
- places where wallet balances are updated directly

Before choosing a new architecture, first identify what the starter repository is already trying to do.

---

# Architecture guardrails

## Service boundaries

### `ledger-service`

The ledger is the source of truth for financial state.

Responsibilities should include:

- wallet/account lifecycle
- immutable financial event history
- double-entry journal/postings
- wallet event streams
- holds/reservations
- balance projections/read models
- reconciliation
- ownership/authorization checks for ledger operations
- publishing ledger domain events

It must not become a generic orchestration layer for the entire system.

### `payments-service`

The payments service owns transfer/split-payment workflow state.

Responsibilities should include:

- transfer creation
- API-level idempotency
- transfer state
- saga orchestration or choreography coordination
- step retries/timeouts
- compensation
- split bills and participant payment state
- calls/messages to the ledger through explicit contracts
- publishing payment lifecycle events

It must not directly mutate ledger tables.

### `notifications-service`

Responsibilities should include:

- subscribing to domain events
- idempotently processing notifications/activity events
- user activity feed persistence if required
- WebSocket fan-out
- reconnect/re-sync support via an authoritative query path

It must not be a source of truth for balances or transfer state.

### Gateway / BFF

The gateway/BFF should:

- expose an intentional frontend-facing API
- aggregate data where needed
- preserve auth context
- avoid duplicating ledger/payment business rules

If the repository already chose GraphQL, extend that approach. If it already uses a Nest BFF, preserve it unless a change is necessary and justified.

### Frontend

Use Next.js App Router conventions already established by the starter code.

Keep the distinction intentional:

- initial non-live reads may use Server Components
- live transfer state, balance updates, reconnect state, and WebSocket interactions require Client Components
- non-real-time mutations may use Server Actions when appropriate
- transfer creation must preserve explicit control over the `Idempotency-Key`

Do not move everything to client-side rendering merely for implementation convenience.

---

# Financial invariants

These rules are non-negotiable.

## Double-entry invariant

Every finalized monetary operation must be represented by balanced postings.

For each journal transaction:

```text
sum(debits) == sum(credits)
```

or, when represented as signed entries:

```text
sum(entries.amount) == 0
```

Enforce this in domain logic and test it.

Where practical, also use database constraints/transaction boundaries to prevent partially written journal operations.

## Balance is derived state

Do not treat a mutable `wallet.balance` field as the source of truth.

The source of truth must be an immutable event/journal history.

A materialized balance/read model is allowed and expected, but it is a projection that can be rebuilt.

There must be a deterministic replay/rebuild path.

## Reconciliation

Provide a way to:

- rebuild wallet balances from the event log
- compare rebuilt values against current projections
- verify the global debit/credit invariant for a requested period

A reconciliation failure must be observable and must not be silently ignored.

## Holds

A hold/reserve must distinguish at least conceptually between:

- total/current ledger balance
- reserved/held amount
- available-to-spend amount

Do not make held funds spendable by a second concurrent transfer.

Hold creation, completion/consumption, and release must be idempotent.

## No double spending

Any command that spends or reserves funds must be concurrency-safe.

Do not implement correctness as:

1. `SELECT balance`
2. check balance in application memory
3. later `UPDATE balance`

without an appropriate concurrency mechanism.

Use the persistence mechanism already selected by the project and implement an atomic strategy such as:

- optimistic concurrency using stream/version checks
- row/version locking where appropriate
- atomic conditional updates
- transactionally enforced event stream version constraints

Then prove the race behavior with a concurrent test.

---

# Event sourcing rules

## Event store

Financial domain events must be append-only.

An event record should have enough information to support reliable replay and auditing, typically including:

- globally unique event ID
- aggregate/wallet/stream ID
- event type
- event version/schema version
- stream sequence/version
- payload
- metadata
- timestamp
- trace/correlation identifiers where available

Do not edit historical events to "fix" state.

If correction is needed, append a correcting/compensating event.

## Optimistic concurrency

Appending events to the same wallet/aggregate must protect against conflicting expected versions.

Concurrent commands must not both succeed against the same stale aggregate version if that would violate the available-balance invariant.

## Projection handling

Projection updates must be:

- deterministic
- replayable
- idempotent
- safe to retry

Projection code must not depend on non-deterministic external state during replay.

## Event versioning

Do not silently change the meaning/shape of an already persisted event type.

When the event schema changes:

- introduce a version
- support old persisted versions via upcasting/adaptation or version-specific handlers
- document the compatibility strategy

## Event publication reliability

Avoid the unsafe pattern:

1. commit DB transaction
2. publish event
3. hope both succeeded

Prefer the existing repository strategy if one exists. If none exists, use a reliable pattern such as a transactional outbox for integration-event publication.

Event consumers must deduplicate by event/message ID.

---

# CQRS rules

Keep command/write responsibilities separate from query/read responsibilities where practical.

Write path:

- validate command
- authorize actor
- load aggregate/current stream version
- enforce domain invariant
- append events atomically
- publish integration events reliably

Read path:

- query projection/read model
- never mutate financial source-of-truth state

Do not over-engineer CQRS into unnecessary abstractions. The goal is explicit write/read responsibility, not ceremony.

---

# Transfer saga

A transfer must have an explicit lifecycle rather than a single boolean flag.

Use clear states appropriate to the existing codebase, for example:

```text
Pending
Validating
FundsHeld
Processing
Completed
Compensating
Failed
```

Exact names may differ, but the model must distinguish successful, retryable, compensating, failed, and terminal states.

## Saga responsibilities

The transfer flow must address:

1. request validation
2. idempotency resolution
3. authorization / ownership
4. receiver validation
5. fraud/limit checks
6. sender funds reservation
7. optional FX resolution
8. debit/credit settlement
9. hold consumption/release
10. final transfer state
11. domain-event publication
12. user notification

## Compensation

For every step with an external side effect, define:

- success condition
- retry policy
- timeout behavior
- whether the step is idempotent
- compensation command/event
- terminal state if compensation itself needs retry

A failed downstream step after funds have been held must not leave money permanently unavailable.

Compensation must itself be safe to retry.

## Stuck sagas

Do not allow a saga to remain indefinitely in an in-progress state.

There must be an explicit strategy for:

- step timeout
- bounded retries
- exponential/backoff behavior where appropriate
- retryable vs terminal failures
- automatic compensation
- operational visibility into unresolved/retrying sagas

---

# Idempotency

## API boundary

Mutating financial endpoints such as transfer creation must support `Idempotency-Key`.

Required semantics:

- same key + same logical request => return/reuse the original result
- same key + conflicting payload => reject deterministically
- simultaneous requests with the same key => only one transfer is created
- idempotency state must survive process restarts

Do not implement idempotency only with an in-memory map.

Back the guarantee with persistence and a unique constraint/index.

## Event consumers

Each consumer that applies a side effect must record processed event/message IDs or otherwise implement durable deduplication.

The order of operations must make duplicate delivery harmless.

Assume at-least-once delivery unless the broker and implementation prove stronger semantics.

---

# Authorization and validation

The starter repository intentionally contains at least one weak validation and/or authorization path. Search for it.

For every wallet/transfer/split-bill operation:

- authenticate the request
- validate DTO/input shape
- validate amount and currency
- reject zero/negative/non-finite amounts
- do not trust a user-supplied owner/user ID if identity should come from the authenticated principal
- verify the actor may access the referenced wallet/resource
- prevent IDOR
- prevent modifying another user's wallet by guessing IDs
- keep admin-only endpoints protected by explicit role/permission checks

Do not solve authorization only in the frontend.

Use allow-list validation for currencies/status values when appropriate.

Keep secrets out of source control.

---

# Rate limiting

At minimum, ensure rate limiting exists for:

- login
- transfer creation

Prefer repository-standard mechanisms.

Rate limiting must not replace idempotency.

---

# Resilience

For calls from `payments-service` to `ledger-service`, implement or preserve:

- bounded timeout
- bounded retries where the operation is retry-safe
- backoff
- circuit breaker or equivalent failure-isolation strategy
- clear mapping of transient vs terminal failures

Never retry non-idempotent side effects blindly.

A temporary ledger outage must not convert into a lost transfer or an infinite hang.

---

# Observability

A single logical request/transfer should be traceable across:

```text
frontend/gateway
-> payments-service
-> ledger-service
-> broker
-> notifications-service
```

Preserve trace/correlation context across:

- HTTP
- asynchronous messages/events
- WebSocket-related event delivery where useful

Expected observability:

- OpenTelemetry tracing
- structured logs
- trace ID / correlation ID in logs
- service name
- relevant operation/transfer IDs
- `/metrics`
- useful error metrics
- saga duration/step timing where practical

Never log:

- passwords
- JWTs/refresh tokens
- secrets
- full sensitive authorization headers

Prefer structured log fields over string-concatenated logs.

---

# WebSocket and real-time behavior

Real-time delivery is an enhancement to authoritative state, not the sole source of truth.

After WebSocket reconnect:

- re-fetch/resynchronize current balance
- re-fetch/reconcile transfer status
- do not assume every missed event will be replayed to the browser

Prevent cross-user event leakage.

A connected user may receive only events they are authorized to see.

---

# Split bills

A split bill must track participant shares separately.

Expected aggregate states include the equivalent of:

```text
Pending -> PartiallyPaid -> Settled
```

Validate that:

- participant shares reconcile to the intended bill amount
- a participant cannot pay another participant's share without an explicit supported rule
- the same share cannot be paid twice through retries
- each payment uses the normal transfer/ledger rules rather than bypassing them
- overdue behavior can trigger a notification/reminder path

Do not create a separate unsafe balance mutation path just for split bills.

---

# Starter-code defect hunt

The task explicitly expects defects to be discovered and fixed.

Search intentionally for these categories:

## 1. Concurrent wallet access / double-spend bug

Look for:

- read-check-write balance updates
- missing transaction/locking/version checks
- parallel transfer requests against one wallet
- race windows between hold creation and balance update

Required proof:

- create a test that reproduces the issue
- demonstrate it would fail before the fix
- make it pass after the fix
- document the root cause and fix in `README.md`

## 2. Validation or authorization bug

Look for:

- user-controlled wallet owner IDs
- wallet lookups without owner checks
- transfer source wallet not tied to authenticated principal
- missing DTO validation
- unsafe admin endpoints
- route-level guard gaps

Again, prove the defect with a regression test.

## 3. TODO/skipped/false-positive tests

Search for:

- `.skip`
- `xit`
- `xdescribe`
- `test.todo`
- `it.todo`
- TODO comments around tests
- assertions that do not actually verify the named behavior
- tests that omit awaiting asynchronous work
- mocks that make the test pass regardless of implementation

Turn the relevant tests into meaningful green tests.

Do not invent additional "hidden bugs" merely to look thorough.

---

# Database requirements

For frequently queried and correctness-critical fields, verify indexes/constraints exist where appropriate.

Examples:

- `(stream_id, version)` unique constraint for event streams
- event ID unique constraint
- idempotency key unique constraint
- processed event/message ID unique constraint
- transfer ID
- saga state/status where operational queries depend on it
- wallet owner/user ID
- wallet currency
- projection lookup fields
- outbox publication state if an outbox is used

Prefer database-enforced uniqueness for concurrency-sensitive guarantees.

Migrations must be deterministic and checked into the repository.

Do not modify an already-applied migration when a new migration is the safer approach, unless project conventions explicitly say otherwise.

---

# Frontend requirements

Preserve the starter application's visual conventions unless there is a strong reason to change them.

Required user-facing areas include:

- transfer form
- transfer live status/progress
- wallets/balances
- split-bill creation
- split-bill list/detail/payment
- real-time activity feed
- loading states
- empty states
- error states
- offline/WebSocket reconnect indicator
- admin event-log/reconciliation/trace views

Frontend correctness rules:

- generate/reuse an idempotency key intentionally for a transfer submission/retry flow
- do not generate a brand-new idempotency key for an automatic retry of the same logical transfer
- disable accidental duplicate submissions where appropriate, but do not rely on button disabling as the server-side guarantee
- do not expose admin data based solely on hidden UI controls
- after reconnect, refresh authoritative state

Do not spend disproportionate time on perfect visual polish; functional correctness and architecture have higher priority.

---

# Testing strategy

Testing is part of the implementation, not cleanup at the end.

## Unit tests

Cover at minimum the critical domain logic for:

- rebuilding a balance projection from events
- double-entry invariant enforcement
- available-balance calculation with holds
- saga state transitions
- compensation decisions
- idempotency conflict behavior

## Integration/e2e tests

Cover at minimum:

### Successful transfer

Verify:

- exactly one transfer created
- sender and receiver financial effects are correct
- event/journal history is correct
- projections match the source of truth
- transfer reaches a terminal successful state

### Failed saga after hold

Intentionally fail a downstream step.

Verify:

- hold is compensated/released
- money is neither lost nor duplicated
- final saga state is `Failed` or equivalent
- repeated compensation is harmless

### Duplicate idempotency key

Test both:

- sequential duplicate requests
- simultaneous/concurrent duplicate requests

Verify one logical transfer only.

### Reconciliation

After a non-trivial series of operations, verify global journal balance is zero.

### Double-spend race

Run concurrent transfer attempts from one wallet where the total requested amount exceeds available funds only under concurrency.

Verify successful operations never exceed the wallet's spendable amount.

### Starter-code regression tests

Add/repair tests that prove each intentionally planted issue.

## Test quality

Avoid:

- arbitrary sleeps when a deterministic wait/helper is possible
- tests whose assertion can pass without the intended side effect
- mocks that bypass the code under test
- merely checking HTTP status when ledger state is the real invariant

Use fake timers only when they make retry/timeout behavior deterministic.

---

# Load/race testing

Provide a repeatable load/concurrency test or script for the double-spend scenario.

Record/document:

- test setup
- concurrency level
- starting balance
- transfer amount/count
- expected maximum successful transfers
- actual results
- evidence that final ledger/projection remains consistent

Keep the test reproducible for a reviewer.

---

# Docker and environment

The finished system should be startable through the repository's Docker Compose workflow.

Verify:

- every deployable service has a Dockerfile if required by the current setup
- each service has its own DB/schema as required
- the broker is included
- dependencies have health checks where appropriate
- services use container hostnames internally rather than `localhost`
- `.env.example` exists for each service that requires service-specific configuration
- no real secret is committed
- startup ordering/readiness does not rely only on container creation order

Do not unnecessarily rewrite a working `docker-compose.yml`; extend/fix it.

---

# CI

Preserve the existing green CI.

The expected CI should run the repository-appropriate equivalents of:

- lint
- typecheck
- unit tests
- integration tests
- service-specific test jobs where practical

Do not silently remove an existing CI check.

If an existing test/API contract must change because of the required event-sourcing refactor, update it deliberately and explain the change in `README.md`.

---

# README requirements

Maintain the root `README.md` as part of the work.

It must clearly document:

## Architecture

Include a diagram showing:

- services
- databases
- broker
- gateway/BFF
- frontend
- synchronous calls
- asynchronous events
- transaction boundaries

Mermaid is acceptable if the repository renders it.

## Starter code

Document:

- what was preserved
- what was refactored
- why

## Found issues

For every planted issue found, document:

- symptom/problem
- root cause
- reproduction
- test proving the issue
- fix
- why the fix is safe

## Architecture decisions

Document the rationale for:

- event-store choice
- event broker choice
- gateway/BFF choice
- saga strategy
- consistency model
- compensation strategy
- event versioning
- concurrency control
- idempotency strategy

## Consistency model

Explicitly identify which guarantees are:

- strongly consistent inside one service/local transaction
- eventually consistent across services

Do not use vague phrases like "eventually consistent" without naming the concrete data/state involved.

## Running locally

Document a reviewer-friendly path to run the whole system, preferably from a clean checkout using the supported Docker Compose command.

## Verification

Document:

- test commands
- reconciliation usage
- load/race test
- relevant observability endpoints/UI
- API/Swagger/GraphQL location

## Trade-offs / unfinished work

List honestly what remains incomplete or what would be improved with more time.

Do not label unfinished functionality as complete.

---

# API and contract discipline

Prefer explicit DTOs/contracts over passing untyped objects between services.

For APIs/events:

- validate input at the boundary
- use stable identifiers
- use explicit enums/status values
- version event schemas
- keep internal database models out of public contracts where practical
- update producers and consumers together when contracts change

Swagger should remain correct for REST APIs where used.

GraphQL schema should remain consistent if a GraphQL gateway is used.

---

# TypeScript / NestJS conventions

Follow repository conventions first.

Unless the codebase clearly does something different:

- keep `strict` typing intact
- avoid `any`
- avoid unsafe non-null assertions
- use dependency injection instead of manually constructing services
- keep controllers thin
- keep domain/business logic out of controllers
- validate DTOs
- use explicit exception types/statuses
- keep infrastructure adapters separate from core business decisions where practical
- avoid circular module dependencies
- do not make every operation a generic CRUD service

Financial operations should be modeled by domain commands/actions such as placing a hold, completing a transfer, or releasing a hold rather than generic `updateWallet()` calls.

---

# Error handling

Classify failures rather than flattening everything into `500`.

Examples:

- validation error
- unauthenticated
- unauthorized
- insufficient funds
- idempotency conflict
- resource not found
- transient ledger unavailable
- transfer already terminal
- duplicate event
- retry exhausted

Do not leak internal stack traces or secrets through API responses.

Log internal context with correlation identifiers.

---

# Performance and correctness priorities

Optimize in this order:

1. financial correctness
2. consistency and idempotency
3. security/authorization
4. recoverability/resilience
5. testability
6. observability
7. maintainability
8. performance
9. UI polish

Do not sacrifice correctness for micro-optimizations.

---

# Preferred implementation workflow

For each significant task:

1. inspect the existing implementation and tests
2. state the concrete invariant/behavior being changed
3. add or update a failing regression/domain test when practical
4. make the smallest coherent implementation change
5. run targeted tests
6. run affected service typecheck/lint
7. run broader relevant tests
8. inspect logs/errors instead of guessing
9. update documentation if behavior/architecture changed
10. only then mark the task complete

When several components are involved, complete a vertical slice rather than leaving many half-finished abstractions.

---

# Recommended delivery order

Use the repository state to adjust this order when necessary, but prefer:

## Phase 0 — Baseline

- run existing checks
- run Docker Compose
- record what currently works/fails
- map architecture
- identify existing contracts

## Phase 1 — Hidden defect discovery

- concurrency/double-spend defect
- validation/authorization defect
- skipped/TODO/false-positive tests
- add regression tests
- fix defects without broad rewrites

## Phase 2 — Ledger foundation

- append-only event store
- aggregate/stream versioning
- double-entry journal/postings
- balance projection
- holds
- projection replay
- reconciliation
- concurrency protection
- event publication reliability

## Phase 3 — Payments

- durable transfer state
- idempotent transfer creation
- saga
- retries/timeouts
- compensation
- ledger integration
- transfer status query

## Phase 4 — Notifications / real-time

- broker consumers
- durable deduplication
- activity feed
- WebSocket delivery
- reconnect/resync behavior

## Phase 5 — Split bills

- split creation
- shares
- participant payment flow
- aggregate status
- reminders/overdue behavior

## Phase 6 — Gateway/frontend

- frontend API aggregation
- transfer UI
- live status
- split-bill UI
- activity feed
- admin tools
- loading/error/offline states

## Phase 7 — Resilience / observability / security

- OpenTelemetry
- correlation IDs
- metrics
- circuit breaker
- rate limiting
- authorization review
- validation review

## Phase 8 — Verification

- unit tests
- integration/e2e tests
- idempotency concurrency test
- compensation test
- reconciliation test
- double-spend load/race test
- Docker Compose full-system verification
- CI verification

## Phase 9 — Delivery docs

- architecture diagram
- starter-code changes
- found defects
- architecture decisions
- consistency/compensation strategy
- run instructions
- tests/results
- limitations/trade-offs

---

# Definition of done

A task is done only when all applicable items are true:

- implementation is complete
- no known financial invariant is broken
- authorization is correct
- validation is present
- idempotency/retry behavior is correct where relevant
- concurrency behavior is considered
- targeted tests pass
- typecheck passes
- lint passes
- affected integrations pass
- documentation is updated if required
- no unrelated working code was broken

For financial workflow changes, "manual UI test succeeded" is not sufficient.

---

# Final response expectations for Codex

After completing a coding task, provide a concise report containing:

1. what changed
2. important design decisions
3. tests/checks run and their result
4. any remaining risks, failures, or TODOs
5. files/areas that deserve reviewer attention

Do not report a command as passing unless it was actually run successfully.

If blocked by a genuine repository/environment problem, explain the exact blocker and leave the codebase in the safest state possible rather than inventing a result.

---

# Anti-patterns to avoid

Do not:

- convert the project back into a monolith
- make services share one database as a shortcut
- directly edit balances as the source of truth
- use in-memory idempotency for financial endpoints
- rely on frontend duplicate-submit prevention for correctness
- assume "exactly once" delivery removes the need for idempotent consumers
- publish integration events unreliably after DB commit without considering failure
- retry non-idempotent operations blindly
- let failed sagas remain stuck forever
- swallow compensation failures
- expose another user's wallet/events/activity
- use `localhost` for service-to-service Docker networking
- replace the existing auth implementation without a requirement
- rebuild the entire starter repository for stylistic reasons
- disable CI/tests to make the task look complete
- over-focus on UI polish while ledger correctness is incomplete

---

# Project success criteria

The completed project should convincingly demonstrate:

- real multi-service decomposition
- independent persistence per service
- event-sourced ledger state
- CQRS read projections
- balanced double-entry accounting
- safe holds and concurrent spending
- a durable transfer saga with compensation
- API and event-level idempotency
- retry-safe event consumers
- no double spending under concurrent requests
- observable distributed request flow
- resilience to partial service failure
- secure ownership/authorization boundaries
- real-time UX with reconnect recovery
- repeatable tests proving the critical guarantees
- clear documentation of decisions and discovered starter-code defects

When requirements compete, protect money correctness and evidence through tests first.

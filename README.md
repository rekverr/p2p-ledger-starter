# P2P Ledger — стартовий репозиторій

Це стартовий каркас для тестового завдання (`ТЗ_тестове_завдання_6`). Частина
сервісів уже працює, частина — лише каркас або TODO. Повний опис завдання —
у файлі ТЗ, який ви отримали окремо.

## Що вже працює

- `apps/ledger-service` — автентифікація, event-sourced wallets, double-entry
  journal, CQRS balance/hold projection та admin reconciliation API.
- `apps/frontend` — сторінки логіну, реєстрації та список гаманців (Next.js
  App Router, Server Component + API-роут-проксі для авторизації).

## Що ще НЕ реалізовано

- `apps/payments-service` — лише каркас контролера/DTO, бізнес-логіки саги
  переказу немає (`NotImplementedException`).
- `apps/notifications-service` — порожній Nest-проєкт, лише `/health`.
- Форма переказу, split-рахунки, admin-екран на фронтенді.

## Запуск

```bash
docker-compose up --build
```

- ledger-service: http://localhost:3001
- payments-service: http://localhost:3002
- notifications-service: http://localhost:3003
- frontend: http://localhost:3000

Для локальної розробки без Docker: скопіюйте `.env.example` → `.env` у
кожному сервісі, підніміть Postgres окремо, `npm ci && npm run start:dev`
у потрібному сервісі.

Кожен app є окремим npm package і має власний `package-lock.json`. Для
відтворюваного install локально, у CI та Docker використовується `npm ci`.

## Тести

```bash
cd apps/ledger-service && npm test
```

Не всі тести в репозиторії однаково надійні — це навмисно, дивись ТЗ.

## Знайдені проблеми стартового коду

### IDOR у wallet endpoints

- **Проблема:** authenticated user міг прочитати або змінити чужий гаманець,
  якщо знав його ID.
- **Причина:** `GET /wallets/:id`, `POST /wallets/:id/deposit` і
  `POST /wallets/:id/withdraw` перевіряли JWT, але шукали гаманець лише за ID,
  без перевірки власника.
- **Відтворення:** автентифікуватися як user A та передати ID гаманця user B в
  один із цих endpoint-ів.
- **Доказ:** regression-тести перевіряють owner-доступ, відмову іншому
  користувачу для всіх трьох операцій і передачу identity саме з JWT principal.
- **Виправлення:** controller передає `req.user.userId`, а service виконує один
  owner-scoped lookup за `{ id, ownerId }`. Неіснуючий і чужий гаманець
  послідовно повертають `404`, не розкриваючи існування ресурсу.

### Wallet lifecycle і дублікати

- **Модель starter code:** wallet створюється ліниво при першому
  `GET /wallets` користувача. Поточна default currency — `USD`.
- **DB-інваріант:** у таблиці `wallets` діє unique index на
  `(ownerId, currency)`. Це дозволяє додавати інші валюти пізніше, але не
  дозволяє два логічно однакові wallets одного користувача.
- **Конкурентне створення:** service виконує insert, а PostgreSQL constraint є
  остаточною гарантією. Caller, який отримав unique violation `23505`, перечитує
  вже створений wallet. Інші database errors не приховуються.
- **Валідація amount:** deposit/withdraw приймають лише додатне скінченне число
  з не більш ніж двома десятковими знаками. `0`, negative, `NaN`, `Infinity`,
  numeric strings і malformed strings відхиляються. Global whitelist видаляє
  поля без validation decorators, тому `ownerId` або `balance` з body не
  потрапляють у DTO.

### False-positive insufficient-funds test

- **Проблема:** початковий withdraw test викликав Promise без `await` або
  `return` і додавав assertion лише всередині `.catch()`. Якщо `withdraw()`
  помилково resolve-ився, assertion не виконувався, але test міг бути зеленим.
- **Виправлення:** test очікує rejected Promise через `await expect(...).rejects`,
  перевіряє `BadRequestException`, повідомлення `Недостатньо коштів` і те, що
  repository `save()` не викликався.
- **Додатковий захист:** успішні withdraw tests перевіряють змінений balance,
  об'єкт, переданий у `save()`, і boundary case повного списання до `0.00`.
- **Skip/TODO audit:** у поточному test tree не знайдено `.skip`, `xit`,
  `xdescribe`, `test.todo`, `it.todo` або TODO навколо tests.

### Concurrent wallet mutation / double spending

- **Проблема:** starter implementation виконував `SELECT balance`, перевірку в
  application memory і пізніший `save()`. Паралельні requests читали один
  старий balance та перезаписували результати один одного.
- **Відтворення:** PostgreSQL integration regression запускає 10 одночасних
  withdrawals по `30` з balance `100`. До виправлення всі 10 requests повертали
  success, а persisted balance був `40.00`. Десять одночасних deposits по `10`
  збільшували balance лише зі `100.00` до `110.00`.
- **Виправлення:** command replay-ить wallet stream, перевіряє invariant та
  append-ить event з expected stream version разом з projection update в одній
  TypeORM/PostgreSQL transaction. Unique `(stream_id, stream_version)` змушує
  конкурентного loser перечитати stream і повторити domain validation.
  Application mutex не використовується.
- **Гарантія:** два withdrawals по `80` з balance `100` дають рівно один
  success і final balance `20.00`; десять withdrawals по `30` дають максимум
  три success і final balance `10.00`. Insufficient operations не змінюють
  state, concurrent deposits не губляться, IDOR semantics залишаються `404`.
- **Запуск regression:** підняти dedicated PostgreSQL database
  `ledger_concurrency_test` на `127.0.0.1:55432`, потім виконати
  `cd apps/ledger-service && npm run test:integration:concurrency`.

### TypeORM metadata auth entity

Real-DB test виявив, що TypeORM не міг infer PostgreSQL type для
`User.refreshTokenHash: string | null`. Колонка тепер явно має type `varchar`,
тому production entities проходять DataSource initialization, а concurrency
integration test перевіряє саме production `User` і `Wallet` metadata.

## Event Store foundation

`ledger-service` має PostgreSQL-backed append-only таблицю `ledger_events`.
Wallet financial history тепер є source of truth у цьому Event Store; public
wallet API зберігає попередню форму відповіді з decimal `balance`, але значення
читається з CQRS projection, а не з mutable колонки `wallets.balance`.

### Схема event record

- `event_id UUID` — глобальний primary key події;
- `stream_id UUID` + `stream_version INTEGER` — identity та послідовність
  aggregate stream, захищені unique constraint;
- `aggregate_type`, `event_type`, `schema_version` — тип aggregate, тип події
  та версія її persisted schema;
- `payload JSONB`, `metadata JSONB` — domain data і технічний контекст;
- nullable `correlation_id`, `trace_id` — зв'язок із command/trace;
- `created_at TIMESTAMPTZ` — database timestamp append-у.

Positive check constraints діють для `stream_version` та `schema_version`.
PostgreSQL trigger `ledger_events_append_only` відхиляє `UPDATE` і `DELETE` з
SQLSTATE `55000`: виправлення історії мають бути лише новими compensating
events. `TRUNCATE` використовується виключно для ізольованого test database.

### Append і optimistic concurrency

`EventStoreService.append()` приймає `streamId`, `aggregateType`,
`expectedVersion` та один або кілька events. В одній local DB transaction він:

1. читає поточну версію stream;
2. перевіряє expected version та незмінність aggregate type;
3. призначає послідовні stream versions;
4. вставляє весь batch одним atomic insert.

Unique constraint `(stream_id, stream_version)` є остаточною гарантією race:
два concurrent commands з одним expected version не можуть обидва commit-нутись.
Конфлікт повертається як `ExpectedStreamVersionError`; глобальний duplicate
`event_id` — як `DuplicateEventIdError`. Помилка будь-якої події відкочує весь
batch. `loadStream()` завжди читає за `stream_version ASC`, а `replay()`
застосовує переданий deterministic reducer до persisted payload.

`event_type + schema_version` є contract для майбутніх version-specific
handlers/upcasters: значення старих подій не переписуються. Upcaster registry
ще не потрібен і на цьому етапі не реалізований.

### Migrations

Production configuration більше не використовує `synchronize: true`.
Checked-in migrations створюють базові starter tables та `ledger_events`;
`migrationsRun: true` застосовує їх під час startup. Для явного запуску:

```bash
cd apps/ledger-service
npm run migration:run
```

Migration `CreateLedgerBaseSchema1725000000000` безпечно приймає database зі
старими synchronize-created `users`/`wallets`, а
`CreateLedgerEvents1725000001000` створює Event Store constraints, index і
append-only trigger.

### Wallet aggregate, journal і CQRS projection

Один wallet відповідає stream `aggregate_type=Wallet`. Aggregate replay-ить:

- `WalletCreated` — identity власника й currency;
- `MoneyDeposited` — завершене зовнішнє поповнення;
- `WithdrawalCompleted` — завершене зовнішнє списання.

Кожна monetary event містить `transactionId` і signed postings. Поповнення має
`+amount` на `wallet:<walletId>` та `-amount` на `system:external`; withdrawal —
навпаки. Domain layer відхиляє transaction, якщо postings менше двох або їхня
сума не дорівнює нулю. Amount зберігається як integer minor units у string
формі всередині JSON, щоб не залежати від floating-point replay.

Write path авторизує owner, replay-ить aggregate, перевіряє balance та journal
invariant, append-ить event з expected stream version і в тій самій PostgreSQL
transaction оновлює `wallet_balance_projection`. Read path (`list/get`) читає
projection. Projection містить `balance_minor` і оброблену `stream_version`,
тому її можна детерміновано перебудувати з wallet stream.

Migration `EventSourceWalletBalances1725000002000` конвертує кожен legacy
`wallets.balance` у `WalletCreated` та, для ненульового balance, balanced
`MoneyDeposited` event, створює projection і видаляє стару колонку. Негативний
legacy balance або unsupported/unbalanced existing wallet event зупиняє
migration замість створення двох суперечливих джерел істини.

### Holds, rebuild і reconciliation

Hold lifecycle представлений immutable events `FundsHeld`, `HoldReleased` та
`HoldConsumed`. `FundsHeld` зменшує лише available balance; settlement
`HoldConsumed` створює balanced postings і тоді зменшує total balance. Формула
projection: `available_minor = balance_minor - held_minor`. PostgreSQL check
constraints забороняють negative held/available та projection, що порушує цю
формулу.

`holdId` є idempotency identity всередині wallet stream. Повторний place з тією
самою сумою, release уже released hold та consume уже consumed hold повертають
поточний state без нового event. Повторне використання ID з іншою сумою або
несумісний terminal transition відхиляється. Concurrent holds захищені тією
самою expected-version гарантією, що й withdraw, тому сума active holds не може
перевищити event-derived total.

Admin-only endpoints, захищені JWT guard та server-side `role=admin` guard:

- `GET /admin/ledger/wallets/:id/events` — chronological immutable stream;
- `GET /admin/ledger/reconciliation/wallets/:id` — event-derived state проти
  materialized projection;
- `GET /admin/ledger/reconciliation/global?from=&to=` — суми debit/credit
  postings за inclusive period;
- `POST /admin/ledger/projections/rebuild` — atomic deterministic rebuild усіх
  wallet projections із event streams.

Rebuild сортує wallets і replay-ить events у `stream_version ASC`; зовнішній
стан або поточний час у reducer не використовуються. Migration
`AddHeldBalanceProjection1725000003000` додає held/available поля та DB
constraints до існуючих projections.

## Відтворювана перевірка

CI використовує Node.js 20 та виконує `npm ci`, lint і build для всіх чотирьох
apps. Ledger job додатково запускає unit tests та PostgreSQL concurrency
integration tests. Payments і notifications поки не мають test files, тому CI
не маскує їх відсутність через `--passWithNoTests`.

Локальний набір команд для кожного app:

```bash
cd apps/<app>
npm ci
npm run lint
npm run build
```

Для ledger додатково:

```bash
npm test -- --runInBand --no-watchman
npm run test:integration:concurrency
npm run test:integration:event-store
npm run test:integration:migration
```

Остання команда очікує dedicated PostgreSQL database
`ledger_concurrency_test` на `127.0.0.1:55432`; налаштування можна змінити через
`TEST_DATABASE_*` environment variables.

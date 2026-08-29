# P2P Ledger — стартовий репозиторій

Це стартовий каркас для тестового завдання (`ТЗ_тестове_завдання_6`). Частина
сервісів уже працює, частина — лише каркас або TODO. Повний опис завдання —
у файлі ТЗ, який ви отримали окремо.

## Що вже працює

- `apps/ledger-service` — автентифікація (register/login/refresh) і базовий
  CRUD гаманців. Балансу гаманця бракує event sourcing — це частина завдання.
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
кожному сервісі, підніміть Postgres окремо, `npm install && npm run start:dev`
у потрібному сервісі.

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

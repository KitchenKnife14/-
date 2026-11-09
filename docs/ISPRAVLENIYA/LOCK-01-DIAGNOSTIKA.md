# LOCK-01 — диагностика глобальной блокировки Apps Script

Дата: 2026-11-09  
База кода: Production commit a7f105df927a54fe7351fc928b896fe473714386  
Рабочая ветка: ispravleniya  
Статус: диагностика исходного поведения; код приложения пока не менялся.

## 1. Подтверждённая реализация

В google-apps-script/Code.gs функция doPost(e):

1. Создаёт один ScriptLock.
2. Для action telegramWebhook вызывает waitLock(20000), затем выполняет всю telegramWebhook_(req) под блокировкой.
3. Для любого другого action вызывает waitLock(20000).
4. Внутри общей блокировки выполняет signup/signin/signout/batch либо requireUser_ + route_.
5. Освобождает блокировку в finally.

Это означает, что долгий запрос записи может заставить ждать независимый запрос чтения. Один и тот же ScriptLock общий для всех пользователей и семей данного Apps Script проекта.

doGet() блокировку не захватывает. JSON parse и проверка наличия action происходят до захвата lock.

## 2. Текущая классификация запросов по исходному коду

### Чистое чтение — кандидат на выполнение без длительной общей блокировки

| Вход | Действие | Наблюдение |
|---|---|---|
| action=getSession | route_ | Возвращает user из уже проверенного токена |
| action=getUser | route_ | Возвращает user из уже проверенного токена |
| action=query, mode=select | query_ | Читает таблицу и фильтрует доступные пользователю строки |
| action=query без mode | query_ | По умолчанию select |
| action=rpc, name=get_table_revision | rpc_ | Читает ScriptProperties |
| action=rpc, name=get_telegram_link_status | rpc_ | Читает telegram_links |
| action=rpc, name=get_my_context | rpc_ | Читает profiles, family_members, families |

Оговорка: requireUser_ читает сессию из ScriptProperties и пользователя из auth sheet. При истёкшей сессии он удаляет session property. Перед выносом read-only пути из общей блокировки нужно отдельно решить, как выполнять эту очистку без гонок. Чтение таблиц также должно не создавать/не мигрировать данные в штатном пути.

### Запись или смешанное действие — должно оставаться защищённым до безопасного рефакторинга

| Вход | Почему |
|---|---|
| signup | Создание auth/profile/session; проверка уникальности email |
| signin | Счётчик неудачных попыток, session property, возможная миграция legacy password hash |
| signout | Удаление session property |
| action=ensureProfile | Может создать профиль |
| action=createFamily | Создаёт family, membership, seed categories; имеет rollback |
| action=joinFamily | Добавляет участника; проверяет лимит семьи |
| query mode=insert | Добавляет строки |
| query mode=update | Изменяет строки |
| query mode=delete | Удаляет строки и может обновлять связанные данные |
| query mode=upsert | Может одновременно обновлять и добавлять строки |
| RPC ensure_supplemental_categories | Может добавлять категории |
| RPC create_goal_with_purchase | Создаёт goal и опционально purchase, с ручным rollback |
| RPC create_telegram_link_code | Удаляет старые коды и создаёт новый |
| RPC unlink_telegram | Удаляет Telegram link и коды |
| RPC join_family_by_invite | Вызывает joinFamily |
| RPC create_family | Вызывает createFamily |
| RPC confirm_planned_purchase | Может создавать transaction и обновлять purchase |
| RPC confirm_recurring_payment | Может создавать transaction и обновлять recurring payment |
| action=telegramWebhook | Обновляет Telegram links/codes, может создать transaction, меняет ScriptProperties idempotency marker |

### Batch

Batch принимает список внутренних действий и исполняет их последовательно. Поскольку пакет может содержать разные действия, его нельзя считать read-only только по action=batch.

Безопасное правило для будущей реализации:
- если каждый элемент пакета однозначно классифицирован как read-only, пакет может идти по read-only пути;
- если хотя бы один элемент пишет, пакет целиком остаётся под write lock;
- неизвестное, некорректное или нераспознанное действие по умолчанию считается write/mixed (fail closed).

Внутренние signup/signin/signout/batch запрещены batch_(), но все разрешённые route actions и RPC всё равно требуют классификации.

## 3. Что текущие тесты не доказывают

В tests/apps-script.test.cjs mock LockService сейчас имеет пустой waitLock(), releaseLock() и hasLock() всегда false. Поэтому текущие unit-тесты:
- проверяют бизнес-логику и API envelope;
- не проверяют реальную очередь ScriptLock;
- не проверяют lock timeout;
- не проверяют одновременные запросы;
- не проверяют, что read-only путь свободен от блокировки.

Нужны отдельные тесты классификатора/lock lifecycle плюс реальная конкурентная проверка в отдельном тестовом Apps Script проекте.

## 4. Предлагаемое направление решения (ещё не внедрено)

Минимальный первый безопасный шаг — не удалять глобальную блокировку полностью, а разделить запросы на read-only и write/mixed:

1. До выполнения route определить категорию входящего запроса.
2. Для чистого чтения выполнять проверку сессии и чтение без удержания глобального lock на протяжении всех операций Sheets.
3. Для записи сохранить текущую сериализацию на первом этапе.
4. Для batch использовать строгую классификацию каждого вложенного действия.
5. Для Telegram webhook сохранить сериализацию update idempotency до появления доказанной атомарной альтернативы.
6. Для signup/signin/signout сохранить критические участки; отдельно оценить PBKDF2 длительность signin, чтобы не держать lock на дорогостоящем вычислении, если можно безопасно перепроверить auth state внутри короткой критической секции.
7. Не заменять ScriptLock на UserLock: это не синхронизирует двух участников одной семьи.
8. DocumentLock можно оценить отдельно, но нельзя предполагать его поведение/доступность без теста для bound spreadsheet web app.
9. После первого безопасного этапа измерить, насколько снизился lock wait у чтения. Более глубокое разделение write locks — отдельная задача и требует проверки атомарности многотабличных операций.

## 5. Риски, которые надо закрыть до изменения doPost

- Проверка сессии и signout в конкурентном сценарии.
- Signup email uniqueness.
- Login attempt counters и password hash migration.
- Batch со смешанными операциями.
- Telegram duplicate update delivery.
- Семейные create/join race conditions.
- Составные RPC с изменениями нескольких листов.
- query delete/update с каскадными изменениями связанных таблиц.
- Устаревшие row numbers после снятия блокировки.
- Табличные ревизии в ScriptProperties.
- Освобождение lock при исключении и тайм-ауте.

## 6. Следующие действия

- [x] Прочитать doPost и определить область блокировки.
- [x] Подтвердить, что обычные чтения тоже ждут ScriptLock.
- [x] Найти все query modes.
- [x] Перечислить все RPC и выделить чтение/запись.
- [x] Зафиксировать, что batch может быть смешанным.
- [x] Проверить текущий mock LockService в unit tests.
- [ ] Добавить тестируемый классификатор read/write/mixed.
- [ ] Добавить тесты классификации всех RPC и batch.
- [ ] Добавить lock mock со счётчиками захвата/освобождения/тайм-аутов.
- [ ] Реализовать минимальное разделение read-only и write пути.
- [ ] Запустить полный набор тестов и сборку.
- [ ] Провести конкурентный тест в изолированном Apps Script проекте.
- [ ] Снять и сравнить p50/p95 lockMs для чтения и записи.
- [ ] Записать результаты, коммит и откат в общий журнал.

## 7. Границы изменений

На момент создания этого отчёта:
- исходный Code.gs не изменён;
- тесты не изменены;
- Google Sheets не читалась/не менялась из Apps Script;
- Production Apps Script deployment не менялся;
- Vercel и Telegram webhook не менялись;
- существующие операции пользователя не затронуты.


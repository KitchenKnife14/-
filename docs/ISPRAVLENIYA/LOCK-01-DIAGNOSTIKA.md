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



## 8. Дополнительные side effects, обнаруженные при углублении

Классифицировать select/get_my_context как read-only только по верхнему уровню недостаточно.

### 8.1 Ленивое создание/исправление структуры таблиц
- sheet_(name) создаёт отсутствующий лист и записывает заголовки.
- sheet_(name) при обнаружении точного префикса заголовков автоматически дописывает недостающие конечные колонки.
- authSheet_() создаёт скрытый auth sheet, если он отсутствует.
- authRows_(), используемый requireUser_(), вызывает authSheet_().

Следовательно, даже запрос чтения может вызвать запись, если лист отсутствует или схема не полностью актуальна. До снятия общей блокировки нужно выбрать явную стратегию:
1. read path не исправляет схему автоматически, а возвращает безопасную ошибку при отсутствующем листе/колонках; или
2. схема проверяется/ремонтируется отдельной короткой критической секцией, после чего чтение выполняется без длительной блокировки.

Нельзя просто предположить, что все таблицы существуют и схема всегда прогрета CacheService.

### 8.2 Дорогие вычисления пароля под глобальной блокировкой
- signup_() выполняет makePasswordHash_() после захвата общего ScriptLock.
- signin_() выполняет passwordMatches_() / PBKDF2 после захвата общего ScriptLock.
- При неизвестном email signin_() также выполняет dummy PBKDF2 под блокировкой.

Это означает, что вход/регистрация могут удерживать общий lock на время CPU-вычисления пароля, блокируя независимые запросы чтения и записи. В план включить отдельное проектирование:
- вычислять хеш/проверку вне общей критической секции, где это безопасно;
- внутри короткой критической секции повторно проверять уникальность email, актуальность password hash и login attempt state;
- сохранить одинаковую по смыслу защиту от перебора и не раскрывать существование email;
- не ослаблять лимит попыток и не допустить гонки счётчика.

### 8.3 Обновлённый вывод
Основная цель LOCK-01 — убрать длительную общую блокировку из независимых чтений и дорогостоящих вычислений, но сохранить короткие атомарные секции там, где они защищают запись и idempotency. Вначале нужно закрыть schema side effects и auth race conditions; только после этого менять doPost().


## 9. Статус после первого подготовительного изменения

- [x] Добавлен fail-closed классификатор requestLockMode_() в Code.gs.
- [x] Добавлены unit tests на явные read candidates, write actions, unknown actions и смешанный batch.
- [ ] Классификатор не подключён к doPost: это намеренно, пока не решены schema side effects и конкурентные auth semantics.
- [ ] Тесты ещё не исполнены. GitHub Actions для ветки не запустились; текущий workflow в main не включает эту ветку, а main менять нельзя.
- [ ] Локальный git clone не состоялся из-за сетевой недоступности github.com в контейнере.
- [ ] Основной Vercel проект автоматически создал Preview deployment от push; target=null, alias git-ispravleniya-nikita-aa7c.vercel.app. Production alias не менялся.
- Изменение helper/test — подготовительная основа, а не исправление глобальной блокировки.



---

## 10. Полная матрица код-путей по загруженному Code.gs (2026-11-09)

Источник: пользовательская загруженная копия Code.gs (1078 строк), дополнительно сопоставлена с веточной версией. Матрица отражает семантику кода, а не только имена методов.

| Вход | Код-путь | Фактическая классификация | Почему |
|---|---|---|---|
| signup | signup_() | AUTH + WRITE | Читает auth, проверяет уникальность email, пишет auth row, session property, profile; PBKDF2 внутри lock |
| signin | signin_() | AUTH + WRITE | Читает auth, меняет loginfail/session properties; может обновлять legacy password hash; PBKDF2 внутри lock |
| signout | signout_() | AUTH + WRITE | Удаляет session property |
| getSession | requireUser_() → route_() | READ с auth side effect | Проверяет session и auth rows; истёкшая session удаляется; authSheet_() может создать лист |
| getUser | requireUser_() → route_() | READ с auth side effect | Те же side effects, что getSession |
| ensureProfile | ensureProfile_() | WRITE | Может добавить профиль |
| createFamily | route_() + rollback/seed | COMPOUND WRITE | Пишет family, membership, категории; при ошибке пытается откатить |
| joinFamily | route_() | WRITE | Проверяет membership и добавляет участника |
| query/select | query_() | READ с schema/auth side effect | Читает таблицы и проверяет доступ; requireUser_ может удалять сессию; sheet_ может создать лист/дописать заголовки |
| query/insert | query_() | WRITE | Создаёт строки и может синхронизировать totals |
| query/update | query_() | WRITE / COMPOUND WRITE | Обновляет строки; для целей/вкладов может пересчитывать связанные записи |
| query/delete | query_() | WRITE / COMPOUND WRITE | Удаляет строки и каскадно обновляет связанные таблицы; удаление goal удаляет contributions |
| query/upsert | query_() | WRITE | Обновляет или добавляет строки, возможен syncGoalTotals_ |
| batch | batch_() | MIXED, целиком WRITE | Внутри допускает query/RPC read и write; каждый вложенный route обрабатывается с тем же user; любая мутация требует сериализации всего batch |
| rpc/get_table_revision | rpc_() | READ с auth/schema side effect | Читает ScriptProperties и membership; авторизация может удалять сессию/создавать _auth |
| rpc/get_telegram_link_status | rpc_() | READ с auth/schema side effect | Читает telegram_links; авторизация имеет side effects |
| rpc/get_my_context | rpc_() | READ с auth/schema side effect | Читает profile, memberships, family и profiles; авторизация имеет side effects |
| rpc/ensure_supplemental_categories | rpc_() | WRITE | Может создать категории |
| rpc/create_goal_with_purchase | rpc_() | COMPOUND WRITE | Создаёт goal и опционально planned purchase; rollback goal при ошибке не проверяет отдельно ошибку компенсации |
| rpc/create_telegram_link_code | rpc_() | WRITE | Удаляет старые неиспользованные коды и создаёт новый |
| rpc/unlink_telegram | rpc_() | WRITE | Удаляет Telegram links и link codes |
| rpc/join_family_by_invite | rpc_() → joinFamily | WRITE | Добавляет участника |
| rpc/create_family | rpc_() → createFamily | COMPOUND WRITE | Создаёт family, membership и категории |
| rpc/confirm_planned_purchase | rpc_() | COMPOUND WRITE | Создаёт deterministic transaction и обновляет planned purchase |
| rpc/confirm_recurring_payment | rpc_() | COMPOUND WRITE | Создаёт deterministic transaction и обновляет recurring payment |
| telegramWebhook | telegramWebhook_() | MIXED + IDEMPOTENCY WRITE | Даже /help, /start и /balance сохраняют update reply в ScriptProperties; /link, /unlink и transaction messages дополнительно меняют таблицы |

### Вывод по классификатору

Текущий helper requestLockMode_() в ветке — только предварительный классификатор, не готовое решение:
- read candidates всё ещё проходят requireUser_(), где есть property deletion и возможное создание auth sheet;
- чтение таблиц проходит через sheet_(), где возможно создание листов/запись заголовков;
- webhook нельзя считать чистым read даже для /help: обработанный update сохраняется в ScriptProperties;
- batch целиком должен оставаться в write lane, если в нём есть хотя бы одна запись, auth action, unknown action или malformed item.

### Дополнительные правила будущей реализации

1. Разделить sheetReadExisting_() (только существующий лист и валидная схема; никаких insertSheet/setValues/format) и административную инициализацию/repair, выполняемую отдельно.
2. В read-auth пути просроченная сессия должна приводить к ошибке без удаления ScriptProperty. Уборка session keys — отдельная операция под write lock.
3. authSheet_() не должен создавать лист во время API read; если _auth отсутствует, вернуть контролируемую серверную ошибку и выполнить инициализацию отдельно.
4. Не освобождать глобальный lock до проверки/защиты операции, если дальше используется row index. После разделения повторно искать строку по ID и проверять ожидаемое состояние внутри write lock.
5. Для signin допустимо рассмотреть PBKDF2 до lock, но счётчик попыток, актуальный password hash, legacy migration и выдача session должны быть повторно проверены/обновлены в короткой атомарной секции.
6. Для signup PBKDF2 можно вычислять до lock, но уникальность email нужно повторно проверять под lock непосредственно перед append.
7. Telegram требует отдельного протокола claim/lease/finalize для update_id либо другого устойчивого idempotency key на уровне transaction. Просто перенести webhook вне ScriptLock нельзя.
8. Составные RPC должны иметь проверяемую компенсацию или устойчивые deterministic IDs и проверку состояния; ScriptLock не превращает несколько Sheets операций в транзакцию.

## 11. Дополнительные замечания загруженной копии Code.gs

- Расширенный Telegram alias parser — это изменение относительно Code.gs ветки ispravleniya. Оно улучшает покрытие категорий, но не исправляет default-to-expense и не реализует transfer.
- Загруженная копия не содержит requestLockMode_(), который уже добавлен в ветку; не перезаписывать веточный Code.gs загруженной копией без осознанного объединения.
- selfTest() удаляет лист _selftest_tmp, если он уже существует. Не запускать на основной таблице; перед дальнейшим использованием сделать имя уникальным и не удалять заранее существующий лист.
- writeRows_() содержит clearContent() ниже нового набора строк, но в загруженной копии нет вызовов этой функции кроме объявления. Не вызывать без отдельного доказательства безопасного сценария.


## 12. Baseline-тест текущего ScriptLock

В tests/apps-script.test.cjs добавлены счётчики вызовов waitLock/releaseLock и проверка, что обычный query/select в текущей реализации делает один acquire и один release после подготовки auth/family. Это диагностический тест текущего поведения, который нужно будет изменить после безопасного рефакторинга. Он не моделирует параллельные выполнения, реальный LockService, ожидание, timeout или конкуренцию между двумя запросами. Тест добавлен в commit 38939b934f0044793a6d3162afe50cb8f10c3ee7, но ещё не запускался.

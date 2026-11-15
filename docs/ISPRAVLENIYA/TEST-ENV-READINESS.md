# TEST GAS readiness — Family Cash

> Актуализировано: 2026-11-15  
> Рабочая ветка: `ispravleniya`  
> Назначение: единый безопасный порядок обновления изолированного TEST GAS и запуска подготовленного runtime acceptance batch.

## 1. Подтверждённое состояние TEST-контура

- Отдельный TEST Apps Script project и отдельная TEST Google Sheet существуют.
- Последняя read-only диагностика подтвердила: `spreadsheetNameIsTest=true`, Script ID suffix `KMTZTF`, spreadsheet ID suffix `bqT8qQ`; Script timezone и Spreadsheet timezone — `Europe/Moscow`; профиль timezone — `Europe/Moscow`.
- TEST Web App URL уже сохранён в Script Properties как `CONCURRENT_ROW_TEST_WEB_APP_URL`; повторно запрашивать URL не нужно.
- Ранее в TEST GAS уже были успешно выполнены отдельные live probes: duplicate signup; конкурентное обновление одной операции (один update принят, второй отклонён как stale); duplicate goal contribution/retry. Эти результаты не заменяют новые probes из batch.
- Важное различие: подтверждение TEST-проекта/таблицы не означает, что в TEST deployment уже загружен актуальный `google-apps-script/Code.gs` из текущего HEAD. Для следующего batch требуется обновить TEST Code.gs из ветки `ispravleniya`.

## 2. Текущие файлы ветки

- `google-apps-script/Code.gs` — актуальный backend, `API_VERSION=11`, V8-compatible source. Blob SHA: `e2bbaeb9e2c81d8da9159c81f9264f6b71ef40a3`.
- `tests/gas/IsolatedTestGuard.gs` — общий fail-closed guard. Он проверяет:
  - `CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY`;
  - `BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID` равен фактическому Script ID;
  - `GAS_TEST_ALLOWED_SPREADSHEET_ID` равен активной таблице, имя которой содержит TEST/ТЕСТ;
  - `CONCURRENT_ROW_TEST_WEB_APP_URL` имеет формат отдельного Apps Script deployment и не совпадает с известным Production deployment.
- `tests/gas/RuntimeAcceptanceBundle.gs` — единый self-contained файл с четырьмя pending runtime probes и orchestrator. Blob SHA: `f781fa6cafa58892bc0d83dce383b095bdae7989`.
- Точка входа в bundle: `runIsolatedRuntimeAcceptanceBatch()`. Она существует в bundle; отдельный файл `RuntimeAcceptanceBatch.gs` вручную добавлять не нужно.
- Отдельные source modules в `tests/gas/` — исходники для сопровождения bundle. В TEST Apps Script добавляется только собранный `RuntimeAcceptanceBundle.gs`, не все отдельные probe-файлы.

## 3. Что выполняет единый batch

В последовательном порядке запускаются четыре пробы:

1. **Telegram duplicate delivery and retry** — повторная доставка одного синтетического webhook update; проверка одной финансовой записи и replay/cache поведения.
2. **Optimistic read/write consistency** — проверка согласованности чтения и конкурентной записи.
3. **Monthly-plan concurrent stale update** — два конкурентных изменения одного snapshot месячного плана; проверка stale rejection.
4. **Two-member transaction insert concurrency** — параллельные вставки операций двумя синтетическими участниками семьи.

Каждая проба создаёт собственные синтетические сущности и удаляет их в `finally`. Batch сбрасывает per-execution caches между тестами. При ошибке очистки batch прекращает последующие тесты, чтобы не накапливать fixtures.

Batch не использует реальные Telegram Bot API, Vercel, Production deployment, основную Google Sheet или реальные семейные записи. Он обращается только к сохранённому TEST Web App URL.

## 4. Восстановление после неуспешного запуска 2026-11-15

Последний live batch завершился `FAIL`: Telegram probe прошёл; read-consistency probe упал на одном параллельном чтении; monthly-plan probe не подтвердил очистку. Batch остановился до запуска transaction-insert probe. Не запускать batch повторно, пока не выполнена точечная очистка.

В bundle добавлена строго ограниченная функция `cleanupFailedMonthlyPlanFixture()`. Она проверяет тот же TEST-only guard и работает только с конкретной синтетической записью:
- Plan ID: `monthrace_c9b44a7e653b4b90b366d4bc9a710d83`
- Synthetic emails: `monthly-plan-a+c9b44a7e653b4b90b366d4bc9a710d83@example.test` и `monthly-plan-b+c9b44a7e653b4b90b366d4bc9a710d83@example.test`
- Семья удаляется только при совпадении её ID с ID из этой записи и точного имени `TEST monthly plan c9b44a7e653b4b90b366d4bc9a710d83`.

Перед следующим batch:
1. Обновить только `RuntimeAcceptanceBundle.gs` в TEST Apps Script файлом из текущей ветки (Code.gs не менялся).
2. Сохранить проект. Для этой правки повторное развёртывание Web App не требуется: helper работает непосредственно с TEST spreadsheet, а API backend не изменён.
3. Запустить `cleanupFailedMonthlyPlanFixture()` один раз и проверить в журнале `result=PASS`, `cleanup=PASS`, а также `verified_remaining` со всеми значениями `false`.
4. Если recovery cleanup не PASS — остановиться и прислать полный error/report; не удалять строки вручную наугад.
5. Только после подтверждённой очистки запустить `runIsolatedRuntimeAcceptanceBatch()`.

Read-consistency probe теперь выводит тело вложенного ошибочного ответа, а monthly-plan cleanup повторно проверяет листы после `SpreadsheetApp.flush()` и сброса локальных caches. Это диагностические изменения; они не меняют бизнес-логику приложения.

## 5. Следующие ручные действия после восстановления

Поскольку TEST `Code.gs` уже был обновлён и batch уже запускался, повторно менять `Code.gs`, `IsolatedTestGuard.gs` или Web App deployment не нужно.

1. В TEST Apps Script открыть существующий `RuntimeAcceptanceBundle.gs`.
2. Полностью заменить содержимое актуальной версией из [ветки ispravleniya](https://github.com/KitchenKnife14/-/blob/ispravleniya/tests/gas/RuntimeAcceptanceBundle.gs).
3. Сохранить файл.
4. Запустить `cleanupFailedMonthlyPlanFixture()` один раз. Продолжать только при `result=PASS`, `cleanup=PASS` и всех `verified_remaining=false`.
5. После подтверждённой очистки запустить `runIsolatedRuntimeAcceptanceBatch()` и прислать полный JSON из журнала.

Новый deployment не требуется: изменения в bundle относятся к тестовым функциям и прямой очистке TEST-таблицы; backend `Code.gs` не менялся.

## 6. CI и границы доказательств

GitHub CI проверяет синтаксис `Code.gs`, `IsolatedTestGuard.gs`, individual probes, orchestrator и bundle; это не исполняет Apps Script runtime и не доказывает работу реального LockService/Sheets.

Финальный live batch должен быть запущен в TEST Apps Script вручную. Результат засчитывается только по фактическому журналу Apps Script и подтверждённой очистке fixtures.

Никакие секреты, токены, URL deployment или содержимое финансовой таблицы не нужно отправлять в чат. Для разбора достаточно JSON-отчёта; чувствительные значения в нём должны оставаться замаскированы.

## 7. Не выполнять

- Не запускать batch в Production GAS.
- Не открывать и не менять основную Google Sheet.
- Не менять Production Vercel environment/deployment и опубликованный Telegram webhook.
- Не удалять и не очищать существующие семейные данные.
- Не менять Script Properties с реальными секретами ради теста; probes должны самостоятельно временно подменять только тестируемое свойство и восстанавливать его в `finally`.


## Recovery after the latest monthly-plan auth cleanup failure

The latest TEST batch passed Telegram duplicate/retry and optimistic read/write consistency. The monthly-plan probe stopped during cleanup: the plan/family rows were removed, but two synthetic auth rows remained. This does not establish whether the concurrent stale-update assertion passed; the test did not complete. The transaction-insert probe was not run.

The bundle now uses `monthlyPlanDeleteSyntheticAuthRows_()`, which scans the live `_auth` email column immediately before deleting only the exact synthetic emails, rather than relying on previously captured auth row numbers. A recovery function is restricted to fixture suffix `c4c8cab147c74f1cb9d87540ef684349`.

In TEST GAS, replace only `RuntimeAcceptanceBundle.gs` from branch `ispravleniya`, save, and run `cleanupLatestFailedMonthlyPlanFixture()`. Confirm `result=PASS`, `cleanup=PASS`, and every `verified_remaining` flag is false. Only then run `runIsolatedRuntimeAcceptanceBatch()`. Do not change `Code.gs`, the isolated guard, or the deployment.

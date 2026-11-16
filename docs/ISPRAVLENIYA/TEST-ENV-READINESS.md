# TEST GAS readiness — Family Cash

> Актуализировано: 2026-11-16  
> Рабочая ветка: `ispravleniya`  
> Назначение: безопасный порядок восстановления TEST-контура и запуска runtime acceptance batch.

## 1. Подтверждённая конфигурация TEST

По последней read-only диагностике:
- отдельный TEST Apps Script project и отдельная TEST Google Sheet существуют;
- Script ID suffix: `KMTZTF`;
- Spreadsheet ID suffix: `bqT8qQ`;
- Script и Spreadsheet timezone: `Europe/Moscow`;
- TEST Web App URL хранится в Script Properties `CONCURRENT_ROW_TEST_WEB_APP_URL`.

Перед каждым запуском общий guard повторно проверяет:
- `CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY`;
- точное совпадение Script ID с `BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID`;
- точное совпадение активной таблицы с `GAS_TEST_ALLOWED_SPREADSHEET_ID` и TEST/ТЕСТ в её имени;
- URL отдельного TEST deployment и отличие от известного Production deployment.

## 2. Файлы и назначение

- `google-apps-script/Code.gs` — backend API v11. Для текущего восстановления его менять не нужно.
- `tests/gas/IsolatedTestGuard.gs` — fail-closed проверка TEST-окружения. Не менять.
- `tests/gas/RuntimeAcceptanceBundle.gs` — единственный bundle-файл, который требуется обновить в TEST Apps Script.
- Отдельные файлы в `tests/gas/` — поддерживаемые исходные модули; вручную добавлять их в GAS не нужно.
- `tests/gas/RuntimeAcceptanceBatch.gs` — последовательный запуск четырёх runtime probes.

Bundle автоматически сверяется регрессионным тестом с исходными модулями. Последний GitHub Actions run для HEAD `60d63594b4f1e9086639de996d87fbf536f51213` завершился успешно: 293/293 регрессионных тестов, включая byte-for-byte sync bundle, и все последующие Apps Script syntax checks прошли. CI не исполняет Apps Script runtime.

## 3. Что проверяет runtime batch

`runIsolatedRuntimeAcceptanceBatch()` последовательно запускает:
1. Telegram duplicate delivery/retry и защиту от повторного `update_id` с другим payload.
2. Optimistic read/write consistency при параллельных чтениях и подтверждении покупки.
3. Конкурентное обновление одной записи monthly plan: один update должен пройти, второй получить stale rejection.
4. Параллельное создание операций двумя синтетическими участниками одной TEST-семьи.

Все сущности синтетические. Batch использует только TEST Web App и TEST spreadsheet. Он не вызывает Telegram Bot API, Vercel или Production.

## 4. Текущее состояние последнего live batch

По последнему предоставленному журналу:
- Telegram duplicate/retry: `PASS`, `cleanup=PASS`;
- optimistic read/write consistency: `PASS`;
- monthly-plan probe остановился на этапе очистки; наличие успешной stale-update проверки не подтверждено;
- transaction-insert probe после остановки batch не запускался.

После monthly-plan probe остались только две синтетические строки в `_auth`. Их точные адреса:
- `monthly-plan-a+c4c8cab147c74f1cb9d87540ef684349@example.test`
- `monthly-plan-b+c4c8cab147c74f1cb9d87540ef684349@example.test`

## 5. Исправление и восстановление

В исходный модуль `MonthlyPlanConcurrencyTest.gs` добавлена функция `monthlyPlanDeleteSyntheticAuthRows_()`. Она:
- заново читает текущий столбец email листа `_auth` непосредственно перед удалением;
- выбирает только точные переданные адреса;
- удаляет найденные строки снизу вверх;
- повторно читает лист и возвращает число оставшихся совпадений.

В `finally` monthly-plan probe теперь использует этот helper вместо сохранённых ранее номеров строк. Добавлена одноразовая функция `cleanupLatestFailedMonthlyPlanFixture()`, ограниченная двумя адресами из раздела 4 и общим TEST guard.

### Действия в TEST Apps Script

1. Открой TEST Apps Script project.
2. Открой существующий файл `RuntimeAcceptanceBundle.gs`.
3. Полностью замени только его содержимое версией из [ветки ispravleniya](https://github.com/KitchenKnife14/-/blob/ispravleniya/tests/gas/RuntimeAcceptanceBundle.gs).
4. Сохрани файл. Новый Web App deployment не нужен.
5. Запусти `cleanupLatestFailedMonthlyPlanFixture()` один раз.
6. Продолжай только если журнал показывает `result=PASS`, `cleanup=PASS`, `verified_remaining.auth=false`.
7. После успешной очистки запусти `runIsolatedRuntimeAcceptanceBatch()` и передай полный JSON-журнал.

Если recovery helper завершится ошибкой или не подтвердит отсутствие строк — остановись и передай полный журнал. Не удаляй строки вручную.

## 6. Границы безопасности

- Не запускать тесты в Production GAS.
- Не открывать и не менять основную Google Sheet.
- Не менять Production Vercel, Telegram webhook или реальные секреты.
- Не менять `Code.gs`, `IsolatedTestGuard.gs` и deployment для этого исправления.
- Не очищать никакие строки, кроме двух точных синтетических email, указанных в разделе 4.

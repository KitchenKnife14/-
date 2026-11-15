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
- `tests/gas/RuntimeAcceptanceBundle.gs` — единый self-contained файл с четырьмя pending runtime probes и orchestrator. Blob SHA: `36b19fd8988bbd52a5b5d6f60fcea9a042852e16`.
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

## 4. Единственное оставшееся ручное действие — M-04

Выполнить один раз после подготовки текущего HEAD:

1. Открыть именно отдельный TEST Apps Script project, привязанный к TEST-таблице. Не открывать основной проект «Семейный бюджет».
2. В файле `Code.gs` заменить содержимое на актуальный файл из ветки `ispravleniya`: [google-apps-script/Code.gs](https://github.com/KitchenKnife14/-/blob/ispravleniya/google-apps-script/Code.gs).
3. Существующий `IsolatedTestGuard.gs` оставить без изменений. Не заменять его старой версией и не удалять.
4. Создать один новый файл Apps Script с именем `RuntimeAcceptanceBundle.gs` и вставить в него полное содержимое: [RuntimeAcceptanceBundle.gs](https://github.com/KitchenKnife14/-/blob/ispravleniya/tests/gas/RuntimeAcceptanceBundle.gs). Не добавлять отдельно `RuntimeAcceptanceBatch.gs` и четыре individual probe files.
5. Сохранить проект. В разделе **Развернуть → Управление развертываниями** отредактировать существующее TEST Web App deployment, выбрать новую версию и развернуть. Не создавать новый URL и не менять Production deployment.
6. В списке функций выбрать точное имя `runIsolatedRuntimeAcceptanceBatch` и запустить один раз.
7. Открыть журнал выполнения и сохранить полный JSON-отчёт.

Ожидаемый успешный итог: `completed=4`, `passed=4`, `failed=0`, `result="PASS"`; у каждого из четырёх вложенных отчётов должны быть `result="PASS"` и `cleanup="PASS"`.

Если функция не появилась в списке после сохранения, сначала проверить, что весь bundle вставлен в правильный TEST project и сохранён. Не создавать отдельные копии функций вручную и не запускать individual probes по одному.

Если любой тест завершился FAIL или cleanup не PASS — не повторять batch вслепую. Нужен отчёт выполнения, после чего разбирается конкретный сбой и состояние синтетических данных.

## 5. CI и границы доказательств

GitHub CI проверяет синтаксис `Code.gs`, `IsolatedTestGuard.gs`, individual probes, orchestrator и bundle; это не исполняет Apps Script runtime и не доказывает работу реального LockService/Sheets.

Финальный live batch должен быть запущен в TEST Apps Script вручную. Результат засчитывается только по фактическому журналу Apps Script и подтверждённой очистке fixtures.

Никакие секреты, токены, URL deployment или содержимое финансовой таблицы не нужно отправлять в чат. Для разбора достаточно JSON-отчёта; чувствительные значения в нём должны оставаться замаскированы.

## 6. Не выполнять

- Не запускать batch в Production GAS.
- Не открывать и не менять основную Google Sheet.
- Не менять Production Vercel environment/deployment и опубликованный Telegram webhook.
- Не удалять и не очищать существующие семейные данные.
- Не менять Script Properties с реальными секретами ради теста; probes должны самостоятельно временно подменять только тестируемое свойство и восстанавливать его в `finally`.

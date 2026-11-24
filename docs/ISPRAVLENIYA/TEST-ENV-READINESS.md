# TEST GAS readiness — Family Cash

> Обновлено: 2026-11-23  
> Рабочая ветка: `ispravleniya`  
> Статус: исторический live TEST batch 17.11.2026 — 4/4 PASS; **актуальный HEAD ещё не опубликован и не проверен в TEST GAS**. В очереди M-04.

## 0. Текущая область изменений

После live batch 4/4 PASS были временно добавлены дополнительные меры для кодов приглашения и Telegram. По решению пользователя эти меры удалены как избыточные для небольшого семейного приложения. Текущая версия использует прежний формат кодов (12 символов). Минимальная длина нового пароля — 8 символов на фронтенде и backend. В коммите `88ace0ef9c291670481a92840e0b0a4f840ffaa2` CI полностью прошёл: build, browser E2E, financial CRUD/transfer E2E, 303/303 regression tests и синтаксические проверки Apps Script. Дополнительно frontend account-balance расчёт помечает затронутые счета недостоверными при неизвестном типе операции вместо молчаливого пропуска. В `Code.gs` восстановлены корректные объявления кода приглашения и Telegram после удаления лишнего `const attemptKey=`. Важно: TEST GAS ещё не обновлялся этим `Code.gs`; CI не заменяет live-проверку в отдельном TEST GAS. Production и основная таблица не затрагивались.

## 1. Назначение и границы

Этот документ описывает изолированный TEST-контур Apps Script и фактический результат последнего runtime acceptance batch.

- Используется отдельный TEST Apps Script project и отдельная TEST Google Sheet.
- Часовой пояс обоих контуров: `Europe/Moscow`.
- TEST Script ID suffix: `KMTZTF`; TEST Spreadsheet ID suffix: `bqT8qQ`.
- TEST Web App URL хранится в Script Properties `CONCURRENT_ROW_TEST_WEB_APP_URL`.
- Guard проверяет `CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY`, allowlist Script ID и Spreadsheet ID, TEST-имя таблицы и отдельный TEST deployment.
- Полные ID, URL и секреты в документацию не записываются.

**Запрещено:** запускать эти тесты в Production GAS, менять основную таблицу, Production Vercel, Production deployment или действующий Telegram webhook.

## 2. Файлы TEST-пакета

- `google-apps-script/Code.gs` — актуальный backend API.
- `tests/gas/IsolatedTestGuard.gs` — fail-closed TEST guard; оставлять без изменений.
- `tests/gas/RuntimeAcceptanceBundle.gs` — единый переносимый bundle четырёх runtime probes.
- Исходные отдельные модули в `tests/gas/` поддерживаются в Git; вручную добавлять их в GAS отдельно не требуется.
- Отдельный `RuntimeAcceptanceBatch.gs` не нужен: функция-оркестратор находится в bundle.

## 3. Результат live TEST batch — 2026-11-17

Пользователь запустил `runIsolatedRuntimeAcceptanceBatch()` в изолированном TEST GAS. Итоговый отчёт:

- `completed=4`
- `passed=4`
- `failed=0`
- `stopped_for_cleanup_failure=false`
- `result=PASS`

Все четыре сценария завершились `PASS`, каждый с `cleanup=PASS`:

| Проверка | Фактический результат |
|---|---|
| Telegram duplicate delivery и retry | Два параллельных запроса и повторная доставка; одна Telegram link row и одна transaction row; конфликт другого payload отклонён |
| Optimistic read/write consistency | 16 параллельных чтений; 16 снимков после проверки; `PASS` |
| Concurrent monthly-plan stale update | Два конкурентных обновления: одно принято, одно отклонено как устаревшее; итог 15000 копеек |
| Concurrent transaction inserts | Два синтетических участника; сохранены обе операции на 12345 и 67890 копеек |

Отдельное восстановление предыдущего fixture до запуска batch также завершилось `result=PASS`, `cleanup=PASS`; остаточные auth/transaction/family/user/member/category/account записи не обнаружены.

Числа времени, попавшие в логи отдельных тестов, не являются полноценным performance benchmark и не закрывают этап замеров производительности.

## 4. Что это подтверждает — и чего не подтверждает

Подтверждено на TEST-контуре:
- защита от дублирующей доставки Telegram update в проверенном сценарии;
- согласованность параллельных чтений в проверенном сценарии;
- отклонение устаревшего конкурентного обновления месячного плана;
- сохранение двух конкурентно созданных операций двумя синтетическими участниками;
- очистка синтетических данных после каждого из четырёх сценариев.

Не подтверждено этим batch:
- безопасность всех возможных сценариев авторизации и доступа к семейным данным;
- полноценная проверка реальных двух пользовательских аккаунтов через браузер;
- поведение Production;
- производительность под репрезентативной нагрузкой;
- резервное копирование и восстановление полного набора данных;
- доступность и корректность всех функций на реальных устройствах.

## 5. Дальнейшие действия

1. Зафиксировать успешный live acceptance batch в общем журнале проекта.
2. Продолжить оставшиеся пункты текущего аудита безопасности и финансовой целостности.
3. Не закрывать макроэтап только на основании этого batch: закрытие возможно после проверки всех критериев этапа.
4. Полные замеры производительности выполнять после основных макроэтапов, как согласовано.

При повторном запуске использовать только TEST project, TEST spreadsheet и TEST deployment. Если любой тест или cleanup завершится неуспешно — остановиться и сохранить полный журнал; строки вручную не удалять.


## 6. Контроль состояния перед следующим TEST-выпуском — 23 ноября 2026

- Контрольный кодовый коммит ветки `ispravleniya`: [`fcd7a9a`](https://github.com/KitchenKnife14/-/commit/fcd7a9a7925f346bcc2663819c32b1261d4d8a44). [CI 45140689260](https://github.com/KitchenKnife14/-/actions/runs/45140689260) — **SUCCESS**: 322/322 теста, 0 ошибок, TypeScript/build, Chromium, мобильный WebKit, финансовый E2E и Apps Script syntax.
- Обновлён `accessSnapshot_()` в `Code.gs`: при старых множественных членствах доступ к чтению/записи ограничивается **первой семьёй**, совпадающей с выбором `get_my_context`. VM-тест проверяет доступные операции и профили, скрытие второй семьи, запрет записи/ревизии и сохранение доступа настоящего владельца второй семьи.
- До этого в текущей ветке усилен `runIsolatedRuntimeAcceptanceBatch()`: после исключения или отсутствия явного `cleanup=PASS` дальнейшие пробы не запускаются. Как поддерживаемый исходник `RuntimeAcceptanceBatch.gs`, так и переносимый `RuntimeAcceptanceBundle.gs` содержат исправление; 12 VM-сценариев остановки пройдены.
- В репозитории уже есть автоматическая **байт-в-байт** проверка переносимого bundle против пяти поддерживаемых модулей (`tests/apps-script.test.cjs`), поэтому повторная генерация или новый параллельный тест не нужны. Этот чек пройден в указанном CI.
- Исторический результат live TEST от **17.11.2026** остаётся действительным только для той опубликованной тогда версии GAS. **Он не подтверждает текущие изменения Code.gs и bundle.** Для них ручная операция **M-04** остаётся открытой: после подтверждения точного TEST deployment обновить исключительно изолированный TEST GAS, оставить `IsolatedTestGuard.gs`, перенести текущие `Code.gs` и `RuntimeAcceptanceBundle.gs` одним согласованным пакетом, затем отдельно запустить `runIsolatedRuntimeAcceptanceBatch()` и зафиксировать `cleanup` для каждой пробы.
- **Никакое развёртывание в этом пункте не выполнялось**. Не менять Production/`main`, основную Google Sheet, основной Apps Script, TEST данные без проверки guard, Vercel Production, webhook или секреты. **Не просить владельца повторно создавать семью, учётную запись или TEST-операцию.** Проверка существующего расхода на физическом iPhone остаётся отложенной до дома.

## 7. Дополнительная проверка семейной изоляции (23.11.2026)

- В рамках уже открытого макроэтапа №8 исправлено чтение таблицы `families`: доступ к записи допускается только для активной семьи по `family_members`, а устаревшее/ошибочное поле `created_by` больше не расширяет область видимости. Изменение не затрагивает обычное создание семьи и роль владельца.
- Расширен уже существующий VM-тест исторических множественных членств: в нём смоделирована неконсистентная метка `created_by` у второй семьи и проверено, что первая семья остаётся единственной доступной через `query` и `get_my_context`. Обычный участник второй семьи сохраняет доступ по членству.
- Это локальная регрессия, **не** подтверждение live TEST GAS и **не** закрытие M-04. Отдельное обновление TEST GAS и runtime acceptance остаются обязательными. CI и точный SHA нового коммита проверяются после публикации.
- Ранее завершён ожидавшийся [CI 45142422185](https://github.com/KitchenKnife14/-/actions/runs/45142422185): SUCCESS на `274fc72`, включая весь pipeline. В Production ничего не менять.

## 8. Подтверждённый CI после исправления изоляции семей (23.11.2026)

- [Коммит `c419c08`](https://github.com/KitchenKnife14/-/commit/c419c08b32ecf056b7bf8b0842c534f5bc1ce980) — доступ к строкам `families` допускается только по active family membership; тест на несогласованное поле `created_by` добавлен в существующий multi-family regression.
- [CI 45179005322](https://github.com/KitchenKnife14/-/actions/runs/45179005322) — **SUCCESS**, 323/323 регрессионных тестов, 0 FAIL; сборка, WebKit, Chromium, финансовые E2E и синтаксические проверки пройдены.
- **M-04 остаётся открытым.** CI не заменяет переноса текущего Code.gs + RuntimeAcceptanceBundle.gs в изолированный TEST GAS и его реальную проверку. Данные TEST и Production не менялись.

## 9. Дополнение по insert категорий в legacy-семьи (23.11.2026)

- [Коммит `fa7fc113`](https://github.com/KitchenKnife14/-/commit/fa7fc113afdd5464762a1bef650ec7c82646d09a): удалено исключение `created_by` в `query_()` для вставки категорий в неактивную семью. Доступ по active family membership унифицирован с остальными путями.
- Дополнен ранее существующий multi-family VM-тест: отказ для чужой семьи по устаревшей creator metadata, успешная вставка категории в свою и участником второй семьи.
- [CI 45180767114](https://github.com/KitchenKnife14/-/actions/runs/45180767114) на кодовом коммите запущен, результат на момент записи ещё не подтверждён; проверять актуальный статус. Не считать TEST GAS развёрнутым: M-04 открыт. Production не затрагивался.

## 10. Изоляция активной семьи для старых Telegram-привязок (23.11.2026)

- [Коммит `64363f7`](https://github.com/KitchenKnife14/-/commit/64363f7a52f2aa05e70153b116d009543814c1fc) — статус Telegram, `/start`, `/balance`, запись операции и `/link` теперь проверяют первую active membership пользователя, согласованную с `get_my_context`.
- Добавлен один отрицательный VM-тест для старой link row во второй семье и legacy membership: прочитать или записать финансовые данные через такую привязку нельзя; обычные связи проверяются регрессионным набором.
- [CI 45182262181](https://github.com/KitchenKnife14/-/actions/runs/45182262181) на этом SHA на момент записи **in_progress**; результат дополнительно сверять. Реальный TEST GAS и M-04 по этому коммиту остаются незавершёнными. Изменений Production нет.

## 11. Поправка тестовых данных категории перед итоговым CI (23.11.2026)

- [Коммит `955cf3a`](https://github.com/KitchenKnife14/-/commit/955cf3aa65538cdcfe166baa1fa2e50f86f98635) исправляет только три тестовые вставки: `kind:'expense'` вместо ошибочного `type:'expense'`.
- [GitHub Actions 45182828519](https://github.com/KitchenKnife14/-/actions/runs/45182828519) — точный новый SHA, статус на момент записи **in_progress**. Ожидается итог для регрессионных, браузерных, финансовых и GAS syntax checks. Это не TEST GAS runtime. M-04 не закрыт.

## 12. Завершённый контрольный CI 324/324 (23.11.2026)

- [CI 45182828519](https://github.com/KitchenKnife14/-/actions/runs/45182828519) на SHA `955cf3aa65538cdcfe166baa1fa2e50f86f98635`: **SUCCESS, 324/324 Node tests, 0 FAIL**. Кроме регрессий прошли TypeScript/build, Chromium browser, WebKit mobile, финансовые E2E, Apps Script syntax и manifest.
- Это последний подтверждённый **кодовый** контрольный SHA; последующие коммиты только документируют результат с `[skip ci]`. TEST GAS ещё не обновлён; M-04 не закрыт. Не менять Production.

## 13. Закрытие обхода generic family insert — проверенный CI (23.11.2026)

- [Коммит `3bc4fc7`](https://github.com/KitchenKnife14/-/commit/3bc4fc75a0be2eac5c148781778af0440081e409) запрещает `query_()` insert в таблицу `families` вне штатного `createFamily`/RPC `create_family`; текущий Onboarding использует RPC. Цель — исключить семейные строки без участника-владельца и без seeded categories.
- [CI 45185213741](https://github.com/KitchenKnife14/-/actions/runs/45185213741) на этом SHA — **SUCCESS, 325/325 Node regression tests, 0 FAIL**, сборка, Chromium/WebKit browser, финансовые E2E, Apps Script syntax/manifest PASS. Проверена штатная регистрация семьи и приглашение второго участника, а также отказ generic insert напрямую и в batch.
- Это проверка кода, а не его публикация. Перед TEST M-04 обязательно переносить **именно актуальный Code.gs** и переносимый bundle, без независимых ручных модулей, и соблюдать fail-closed TEST guard. Production не менялся.

## 14. M-04 — проверенный пакет ручной публикации только в TEST GAS (23.11.2026)

**Статус:** подготовка и фиксация пакета завершены; **публикация TEST GAS и live runtime batch не выполнялись**. Описанные ниже действия выполняются отдельно, одним согласованным TEST-only пакетом. Это продолжение существующего M-04, не новый микроэтап и не разрешение на Production.

### Исходники для переноса: закреплённая контрольная точка

Ветка `ispravleniya`, неизменяемый SHA `4c085776618f07a5c1d4dbebebc48dac32ed19ad`. Два переносимых файла и один файл, который **не изменять**:

| Файл | Git blob SHA | Действие |
|---|---|---|
| [google-apps-script/Code.gs](https://github.com/KitchenKnife14/-/blob/4c085776618f07a5c1d4dbebebc48dac32ed19ad/google-apps-script/Code.gs) | `907d0099b5921bd694ef8f921727eeea28fb7d93` | Полностью заменить содержимое **существующего** `Code.gs` в TEST-редакторе |
| [tests/gas/RuntimeAcceptanceBundle.gs](https://github.com/KitchenKnife14/-/blob/4c085776618f07a5c1d4dbebebc48dac32ed19ad/tests/gas/RuntimeAcceptanceBundle.gs) | `623ef052d969f3bd2244bf07da80b4e4c2fbc74a` | Полностью заменить содержимое **существующего** `RuntimeAcceptanceBundle.gs` в TEST-редакторе |
| [tests/gas/IsolatedTestGuard.gs](https://github.com/KitchenKnife14/-/blob/4c085776618f07a5c1d4dbebebc48dac32ed19ad/tests/gas/IsolatedTestGuard.gs) | `1d7bf7b9598fdebc45e78a813f4c38f16e2e4c56` | **Оставить как есть**, не пересоздавать и не править |

Новые независимые .gs модули или `RuntimeAcceptanceBatch.gs` в редактор не добавлять: они объединены в bundle; возможны совпадающие глобальные имена. Полные ID, URL и секреты не копировать в журнал или чат.

### Последовательность — только после подтверждения TEST-проекта

1. Открыть существующий **TEST Apps Script project**, НЕ Production. В настройках проекта проверить Script ID с окончанием `KMTZTF`; у связанной **TEST** таблицы — ID с окончанием `bqT8qQ` и явное слово «TEST»/«тест» в названии. Если хоть одно несовпадение — **СТОП без изменения файлов**.
2. Проверить в настройках TEST Script Properties наличие `BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID`, `GAS_TEST_ALLOWED_SPREADSHEET_ID`, `CONCURRENT_ROW_TEST_CONFIRM` и `CONCURRENT_ROW_TEST_WEB_APP_URL`. Значения не отправлять. Проверить, что первые два содержат **полные идентификаторы именно открытых TEST** Script и Spreadsheet, confirmation — `ISOLATED_TEST_ONLY`. Не создавать новые настройки, если они уже есть.
3. В **Deploy → Manage deployments** открыть **существующий TEST Web App deployment** и независимо сравнить его `/exec` URL со значением `CONCURRENT_ROW_TEST_WEB_APP_URL` в TEST Script Properties. Это обязательная положительная проверка идентичности: `IsolatedTestGuard.gs` сам по себе проверяет формат URL и исключает один известный Production deployment ID, но **не удостоверяет принадлежность любого другого URL этому TEST-проекту**. Если URL отличаются или нужного deployment нет — **СТОП**, не менять URL наугад.
4. Только после проверок выше в редакторе TEST Apps Script сохранить предыдущий TEST-код для отката (например, существующая версия в истории). Полностью заменить **два** переносимых файла ровно содержимым из ссылок на закреплённый SHA, сохранить изменения. `IsolatedTestGuard.gs` оставить неизменным. Не менять схемы/данные TEST или Production Sheet.
5. В **том же существующем TEST deployment** выбрать **Edit → Version: New version → Deploy**. Не использовать создание нового deployment и не менять параметры доступа / execute-as без отдельной необходимости. Проверить, что URL `/exec` остался прежним и совпадает с TEST property. Production deployment не открывать.
6. В редакторе **только TEST** выбрать `runIsolatedRuntimeAcceptanceBatch` и запустить один раз. Проверить сводку: `result=PASS`, `completed=4`, `passed=4`, `failed=0`, `stopped_for_cleanup_failure=false`; у каждого из четырёх сценариев `cleanup=PASS`. При любом FAIL, отсутствии cleanup или несоответствии идентификаторов — **СТОП**, ничего не удалять вручную, сохранить журнал и использовать rollback существующей TEST версии.
7. В отчёт передать **только обезличенную сводку** полей результата и статусы cleanup; не передавать токены, session IDs, полные Script/Spreadsheet IDs, Telegram update payload и секреты. После успешного полного TEST acceptance отметить M-04 в журнале отдельным фактическим доказательством.

**Предварительная автоматическая проверка:** [CI 45207703165](https://github.com/KitchenKnife14/-/actions/runs/45207703165) на кодовом SHA `968421c3322681fddedfb94179a693296e31540f`: **SUCCESS, 326/326 tests, 0 FAIL**, включая синтаксис Apps Script, guard/bundle проверки и финансовые/браузерные сценарии. Последующие коммиты до зафиксированной контрольной точки — только тесты и документы; переносимые файлы сверены по Git blob SHA. CI не является разрешением на deploy.

## 15. M-04 — проверка доступности актуального Preview и разделения окружений (23.11.2026)

- Read-only Vercel API: проект сайта `-` (id `prj_reGhIDISp8jlwxj1zppgEOS6dMBm`), домен Production `nikita-aa7c.vercel.app` сохраняется; последний Preview для ветки `ispravleniya` — `https://1fjstwfyh-lk8bmwvf8-nikita-aa7c.vercel.app/`, deployment `dpl_524PaTWaGkA24uSyXvzMVdutzQbq`, commit **`2d0ed818ecbb088884db86928c0459ebf81f4411`**, state **READY**, target `null` (не Production).
- Независимая read-only проверка открыла этот Preview и получила страницу «Общий бюджет — для двоих», форму «Вход» / «Регистрация», поля Email/Пароль; страница доступна без пользовательской сессии. Это **только проверка загрузки auth UI**, она не подтверждает серверную авторизацию, POST или работу функций.
- Vercel project environment metadata показывает две **раздельные** записи `VITE_GOOGLE_APPS_SCRIPT_URL`: одна scope `preview` (комментарий TEST Apps Script API), другая `production` (комментарий основного Apps Script API). Значения URL и секретов не запрашивались и не менялись. Наличие разных scoped variables не доказывает само по себе, что backend URL актуального Preview действительно совпадает с TEST deployment; перед публикацией M-04 нужна документированная в разделе 14 **проверка exact `/exec` URL** в TEST Apps Script.
- В подключённом браузерном профиле «Family Cash — TEST Apps Script» отсутствует подтверждённый signed-in session Google: нельзя безопасно открыть/обновить Apps Script редактор от лица владельца. В текущих доступных прямых коннекторах нет действия для публикации Apps Script deployment. **Никаких публикаций или тестовых записей не выполнено.**
- **M-04 остаётся открытым:** владелец должен разрешить/выполнить TEST-only обновление существующего deployment после сверки TEST Script ID suffix `KMTZTF`, TEST spreadsheet suffix `bqT8qQ`, точного TEST URL и гарантированного сохранения старой версии. Затем провести live `runIsolatedRuntimeAcceptanceBatch()` 4/4 с `cleanup=PASS`. Production не трогать. Процент общего плана не увеличивать из-за предзапусковой проверки.

## 16. M-04 — подтверждение TEST Script и Deployment через подключённый Google (24.11.2026)

- Пользователь подключил Google к браузеру для проверки TEST GAS. В Apps Script открыт привязанный к таблице «Семейный бюджет Тестирование» проект «Для тестирования». Script ID заканчивается на `KMTZTF`, Spreadsheet ID — `bqT8qQ`. Данные Production не открывались, Script Properties values не записывались в журнал.
- Через браузер найден существующий активный **TEST Web App version 11** (по данным интерфейса развернут 20.11.2026), выполнением **от имени владельца**, доступ «Все»; имеется `/exec`. Результат браузерной проверки относится к состоянию развертывания, **не** доказывает актуальность исходников `Code.gs` и runtime-бандла. Нестандартное отображение имени файла в GAS: `RuntimeAcceptanceBundle.gs.gs` вместо ожидаемого `RuntimeAcceptanceBundle.gs`; не переименовывать вслепую и не добавлять второй дублирующий файл без проверки функций.
- Отдельно проверено через Vercel API (read-only): единственная Preview-scoped переменная `VITE_GOOGLE_APPS_SCRIPT_URL` проекта «-» **в точности содержит найденный TEST deployment ID и завершается `/exec`**. Значение переменной в Git или журнал не помещалось, Production env не запрашивался. Таким образом, цепочка TEST Spreadsheet → TEST Script → Web App URL → Vercel Preview согласована.
- **Блокирующее условие:** просмотр вкладки Project Settings через браузер не подтвердил наличие значений и даже списка 4 необходимых Script Properties (`BACKEND_DIAGNOSTICS_ALLOWED_SCRIPT_ID`, `GAS_TEST_ALLOWED_SPREADSHEET_ID`, `CONCURRENT_ROW_TEST_CONFIRM`, `CONCURRENT_ROW_TEST_WEB_APP_URL`). Прежний успешный run 17.11 утверждает наличие guard в то время; **отсутствие отображения свойств в браузере не позволяет заключить, что они удалены**, но до live тестов нужно проверить их существование и правильное соответствие TEST окружению без раскрытия секретов. Подключённый браузер периодически показывает Signed out при новом сеансе и перенаправляет прямые URL редактора на документацию; поэтому нельзя утверждать, что доступ к редактированию стабилен.
- **Не выполнялось:** обновление `Code.gs`, `RuntimeAcceptanceBundle`, деплой версии 12 или любой другой версии, запуск `runIsolatedRuntimeAcceptanceBatch()`, изменение Script Properties, TEST Spreadsheet, Production Script, основного сайта, секретов, бота или финансовых записей. Ветка main не менялась.
- **Следующее разрешаемое действие:** после отдельного согласия на **конкретное обновление существующего TEST Web App** при подтверждённых guard properties — загрузить ровно два подготовленных файла из Git `ispravleniya`, сохранив старую version 11 как вариант возврата, и запустить 4/4 live probes с cleanup PASS. При любой неопределённости доступа/URL/guard **остановиться**. M-04 остаётся открытым до реального результата. План стабилизации остаётся **216/227 (95,2%)**, 11 открытых критериев.

## 17. M-04 — опубликована TEST version 12, batch отменён (24.11.2026)

- После явного разрешения владельца браузер подтвердил проект «Для тестирования»: Script ID suffix `KMTZTF`, связанная таблица «Семейный бюджет Тестирование», Spreadsheet ID suffix `bqT8qQ`, EXISTING TEST Web App deployment suffix `WsbCe`. Четыре guard properties присутствуют и совпадают с TEST Script/Sheet, `CONCURRENT_ROW_TEST_CONFIRM=ISOLATED_TEST_ONLY`; URL свойств и существующего TEST deployment совпадают. Значения секретов и полные идентификаторы в Git не помещались.
- В TEST GAS обновлены **только** `Code.gs` (Git blob `907d0099b5921bd694ef8f921727eeea28fb7d93`, редактор 1797 строк) и существующий `RuntimeAcceptanceBundle.gs.gs` (Git blob `623ef052d969f3bd2244bf07da80b4e4c2fbc74a`, редактор 1333 строки); копирование из immutable raw GitHub через браузерный clipboard, подтверждено сохранение на Google Drive и ключевые границы кода. **Побайтовое сравнение содержимого редактора с Git blob не выполнялось**; первоначальные неполные попытки (1784 строки Code.gs и 1329 строк bundle) были обнаружены до публикации и исправлены повторным копированием.
- 24.11.2026 в **существующем** TEST deployment опубликована **version 12** с прежним URL/Deployment ID (suffix `WsbCe`), режимы execute-as-owner и access=Everyone сохранены. Предыдущая **version 11** доступна для отката. Никакие Vercel-переменные, TEST Spreadsheet, Production Apps Script, Production data, Production Vercel, Git main или Telegram webhook не изменялись.
- **Результат запуска** `runIsolatedRuntimeAcceptanceBatch` на TEST: функция запущена один раз. В журнале исполнения отдельно подтверждён сценарий `telegram duplicate concurrent delivery and retry` с `result=PASS`, `cleanup=PASS` (2 параллельные доставки и повтор, без дубликатов). Однако **весь orchestrator имеет статус «Выполнение отменено» через 161,219 секунды**. Его финальный JSON с `completed=4,passed=4,failed=0,result=PASS` **отсутствует**. По второй, третьей, четвёртой проверке и их очистке нет достаточного подтверждения. Вначале браузерный агент ошибочно интерпретировал первый JSON как успех batch; повторная read-only проверка в разделе **«Выполнения»** это опровергла. **Причина отмены НЕ установлена; не приписывать её таймауту GAS или пользовательскому действию без доказательств.**
- **Блокировка M-04:** результат приёмки `FAIL/INCOMPLETE` (не скриптовый assertion FAIL, а отменённый общий запуск). Не запускать этот batch второй раз и не очищать тестовые строки вручную до выяснения причины отмены и проверки, не остались ли fixture-данные от незавершённого сценария. Сохранить TEST version 12 и ранее работающую version 11; возможность rollback уже есть, но возврат ещё не применялся. Запрет на Production остаётся.
- Прогресс исходного плана **216/227 = 95,2%**, открыто **11** критериев. M-04 и M-03 остаются открыты; **реального результата 4/4 PASS на version 12 нет**.

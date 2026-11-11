# LOCK-01B — карта read/write-путей Google Apps Script

Дата: 2026-11-11  
Ветка: `ispravleniya`  
Основание: статический разбор `google-apps-script/Code.gs` на HEAD `c5cf7cb780404065c10375037f51126ccddebe5d`.

## Классификация входных действий

| Действие / путь | Класс | Основание |
|---|---|---|
| `getSession`, `getUser` | Read-only | `requireUser_` читает ScriptProperties и строку пользователя из `_auth`; route возвращает user. |
| `query` + `select` | Read-only | Чтение строк, фильтрация и сортировка в памяти; sheet read path не записывает. |
| `query` + `insert/update/delete/upsert` | Write | Записывает строки и/или агрегаты/связи. |
| `signup`, `signin`, `signout` | Write | Создание пользователя/сессии, изменение сессии или обслуживание auth-данных. |
| `ensureProfile`, `createFamily`, `joinFamily` | Write | Создают или изменяют профиль, семью, членство и категории. |
| RPC `get_table_revision` | Read-only | Читает ScriptProperties. |
| RPC `get_telegram_link_status` | Read-only | Читает `telegram_links`. |
| RPC `get_my_context` | Read-only | Читает профиль, членство и семью. |
| Все остальные RPC | Write | Включают создание/изменение категорий, целей, покупок, Telegram-кодов/связей, подтверждение покупок и регулярных платежей. |
| `telegramWebhook` | Write | Даже команды без финансовой записи обновляют replay cache; операции и link/unlink меняют данные. Нужна сериализация повторов. |
| `batch` | Read-only только если каждый элемент read-only; иначе Write | Классификатор рекурсивно проверяет все вложенные запросы; вложенный batch запрещён в `batch_`. |

## Проверка скрытых записей на read-path

- `requireUser_` только читает session property и `authRows_`; нет lazy password rehash, session cleanup или profile update.
- `authSheet_` при `READ_ONLY_REQUEST=true` завершает запрос ошибкой, если `_auth` отсутствует; не создаёт и не форматирует лист.
- `sheet_` при `READ_ONLY_REQUEST=true` не создаёт отсутствующий лист и не исправляет заголовки.
- `query/select` не вызывает write helpers; сортировка меняет только локальный массив.
- Три read-only RPC перечислены выше; остальные RPC используют write-пути.
- `batch` может считаться read-only только при полностью read-only составе.

## Важное ограничение

Это статическая классификация, не доказательство безопасного снятия блокировки. В текущем `doPost` общий `ScriptLock` всё ещё захватывается и для read-only запросов. Перед изменением этого поведения обязательны реальные измерения lock wait/work time и тесты конкуренции на отдельной тестовой таблице. Не удалять глобальную блокировку на основании одной этой карты.

## Следующие действия

1. Снять baseline `lockMs`, `workMs`, `totalMs`, `SHEET_READS`, `SHEET_WRITES` в тестовом deployment.
2. Сопоставить p50/p95 по read-only и write сценариям.
3. Провести конкурентные тесты signup, join, повторного Telegram update и конфликтующих операций.
4. Только после результатов проектировать отдельный read path без write-lock.

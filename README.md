# Бюджет для двоих

Веб-приложение для совместного управления семейным бюджетом на двоих.

## Возможности

- Учёт доходов и расходов с категориями и автором операции
- Финансовый календарь (месяц / неделя / день / список)
- Регулярные платежи с ручным подтверждением
- Бюджеты по категориям с предупреждениями 75 / 90 / 100 %
- Финансовые цели с историей пополнений
- Будущие покупки с приоритетами и статусами
- Месячное планирование: план vs факт
- Отчёты с экспортом в CSV
- Анализ доходов и расходов по каждому участнику
- Центр уведомлений
- Telegram-бот (опционально)
- Синхронизация в реальном времени между двумя участниками

## Технологии

- React 18 + TypeScript + Vite
- Supabase (PostgreSQL, Auth, Realtime)
- Tailwind CSS
- React Router v6

## Запуск

```bash
npm install
npm run dev
```

## Сборка

```bash
npm run build
```

## Настройка Supabase

Переменные окружения уже заданы в `.env`:
- `VITE_SUPABASE_URL` — URL проекта Supabase
- `VITE_SUPABASE_ANON_KEY` — анонимный ключ

## Схема БД

Схема создана одной миграцией (`0001_core_schema`) и включает 14 таблиц:
profiles, families, family_members, categories, accounts, transactions,
recurring_payments, budgets, goals, goal_contributions, planned_purchases,
monthly_plans, notifications, telegram_links.

Все суммы хранятся в копейках (bigint `amount_kopecks`).
На всех таблицах включён RLS — доступ ограничен членами одной семьи.

## Telegram-бот (опционально)

1. Создайте бота через @BotFather и получите токен.
2. Добавьте секрет `TELEGRAM_BOT_TOKEN` в проект Supabase.
3. Установите webhook: `https://api.telegram.org/bot<TOKEN>/setWebhook?url=<SUPABASE_URL>/functions/v1/telegram-bot/webhook`
4. В приложении отправьте боту `/link <код_семьи>` для привязки.

## Резервное копирование

- Экспорт данных: страница «Отчёты» → «Экспорт CSV».
- Полное резервное копирование БД: панель Supabase → Database → Backups.
- Версии проекта: кнопка «История версий» (часы) в заголовке Bolt.

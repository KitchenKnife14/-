# Бюджет для двоих

Приватное веб-приложение для совместного управления семейным бюджетом двух участников.

## Возможности

- Доходы и расходы с категориями, автором и ответственным участником
- Счета и балансы
- Финансовый календарь
- Регулярные платежи с ручным подтверждением
- Бюджеты по категориям
- Финансовые цели и история пополнений
- Планируемые покупки
- Месячное планирование и сравнение плана с фактом
- Отчёты и экспорт CSV
- Анализ доходов и расходов по участникам
- Уведомления
- Адаптивный интерфейс для компьютера и телефона
- Telegram-бот для привязки аккаунта и добавления простых операций

## Технологии

- React 18, TypeScript, Vite
- Tailwind CSS, React Router v6
- Google Sheets — хранение данных
- Google Apps Script — API и авторизация
- Vercel Serverless Function — защищённый Telegram webhook

## Локальный запуск

```bash
npm install
cp .env.example .env
```

В `.env` укажите URL опубликованного Apps Script Web App:

```env
VITE_GOOGLE_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Затем запустите:

```bash
npm run dev
```

## Настройка backend

- Инструкция: [google-apps-script/SETUP.md](google-apps-script/SETUP.md)
- Исходный API: [google-apps-script/Code.gs](google-apps-script/Code.gs)
- Версия API в исходном коде: **11**
- Переменная фронтенда: `VITE_GOOGLE_APPS_SCRIPT_URL`

Таблица Google Sheets должна оставаться закрытой для публичного доступа. Веб-приложение Apps Script выполняется от имени владельца таблицы; доступ к операциям контролируется собственной авторизацией приложения.

## Telegram

- Бот: [@My_Family_cash_bot](https://t.me/My_Family_cash_bot)
- Публичный endpoint размещён в основном Vercel-проекте по пути `/api/telegram/webhook`.
- Реализация endpoint: [api/telegram/webhook.ts](api/telegram/webhook.ts).
- Общий обработчик: [telegram-webhook/handler.ts](telegram-webhook/handler.ts).
- Порядок настройки и проверки: [docs/TELEGRAM_INTEGRATION.md](docs/TELEGRAM_INTEGRATION.md).

Секреты Telegram хранятся только в серверных переменных окружения основного Vercel-проекта и Script Properties Apps Script. Они не должны попадать во frontend, Git или сообщения. Наличие переменных окружения само по себе не означает, что webhook уже опубликован или зарегистрирован в Telegram.

## Статус выпуска

- Рабочая ветка: `work/final-features-performance`.
- Изменения PR #8 направлены в `feature/telegram-integration`; PR остаётся отдельным от Production.
- Preview основного Vercel-проекта использует отдельную тестовую таблицу. Не вводите туда реальные финансовые данные.
- Production сайта пока не переключён на эту ветку. Не меняйте Production branch и не объединяйте рабочую ветку в `main`, пока не завершены тесты и проверка безопасного выпуска.
- API v11 добавляет только отсутствующие конечные столбцы при точном совпадении существующих заголовков с началом ожидаемой схемы. Существующие столбцы и строки не переставляются и не очищаются.
- Регрессионные тесты не заменяют проверку реального Apps Script, двух пользовательских аккаунтов, изоляции семейных данных и Telegram end-to-end.

Суммы хранятся в целых копейках. Часовой пояс приложения — Europe/Moscow.

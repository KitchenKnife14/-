export interface DefaultCategory {
  name: string
  kind: 'expense' | 'income' | 'transfer'
  icon: string
  color: string
  children?: { name: string; icon: string; color: string }[]
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  {
    name: 'Жильё и обязательные платежи', kind: 'expense', icon: '🏠', color: '#2563eb',
    children: [
      { name: 'Аренда квартиры', icon: '🔑', color: '#2563eb' },
      { name: 'Ипотека', icon: '🏦', color: '#2563eb' },
      { name: 'Коммунальные услуги', icon: '💡', color: '#2563eb' },
      { name: 'Интернет', icon: '🌐', color: '#2563eb' },
      { name: 'Мобильная связь', icon: '📱', color: '#2563eb' },
      { name: 'Обслуживание жилья', icon: '🧰', color: '#2563eb' },
      { name: 'Ремонт', icon: '🛠️', color: '#2563eb' },
      { name: 'Мебель и предметы интерьера', icon: '🛋️', color: '#2563eb' },
    ],
  },
  {
    name: 'Продукты и питание', kind: 'expense', icon: '🛒', color: '#16a34a',
    children: [
      { name: 'Продукты домой', icon: '🥦', color: '#16a34a' },
      { name: 'Кафе и рестораны', icon: '🍽️', color: '#16a34a' },
      { name: 'Доставка еды', icon: '🛵', color: '#16a34a' },
      { name: 'Кофе и перекусы на работе', icon: '☕', color: '#16a34a' },
    ],
  },
  {
    name: 'Быт', kind: 'expense', icon: '🧴', color: '#0891b2',
    children: [
      { name: 'Бытовая химия', icon: '🧼', color: '#0891b2' },
      { name: 'Средства гигиены', icon: '🪥', color: '#0891b2' },
      { name: 'Товары для дома', icon: '🏠', color: '#0891b2' },
      { name: 'Расходные материалы', icon: '📦', color: '#0891b2' },
      { name: 'Мелкие бытовые покупки', icon: '🧺', color: '#0891b2' },
    ],
  },
  {
    name: 'Транспорт', kind: 'expense', icon: '🚌', color: '#ea580c',
    children: [
      { name: 'Общественный транспорт', icon: '🚇', color: '#ea580c' },
      { name: 'Такси', icon: '🚕', color: '#ea580c' },
      { name: 'Бензин', icon: '⛽', color: '#ea580c' },
      { name: 'Обслуживание автомобиля', icon: '🚗', color: '#ea580c' },
      { name: 'Ремонт автомобиля', icon: '🔧', color: '#ea580c' },
      { name: 'Страхование и документы', icon: '📄', color: '#ea580c' },
      { name: 'Парковка', icon: '🅿️', color: '#ea580c' },
    ],
  },
  {
    name: 'Здоровье', kind: 'expense', icon: '🩺', color: '#dc2626',
    children: [
      { name: 'Врачи', icon: '👨‍⚕️', color: '#dc2626' },
      { name: 'Анализы и обследования', icon: '🧪', color: '#dc2626' },
      { name: 'Лекарства', icon: '💊', color: '#dc2626' },
      { name: 'Стоматология', icon: '🦷', color: '#dc2626' },
      { name: 'Медицинские процедуры', icon: '💉', color: '#dc2626' },
    ],
  },
  {
    name: 'Личные расходы', kind: 'expense', icon: '👕', color: '#7c3aed',
    children: [
      { name: 'Одежда и обувь', icon: '👕', color: '#7c3aed' },
      { name: 'Косметика', icon: '💄', color: '#7c3aed' },
      { name: 'Уход за собой', icon: '💆', color: '#7c3aed' },
      { name: 'Личные покупки', icon: '🛍️', color: '#7c3aed' },
    ],
  },
  {
    name: 'Развлечения', kind: 'expense', icon: '🎮', color: '#db2777',
    children: [
      { name: 'Кино и мероприятия', icon: '🎬', color: '#db2777' },
      { name: 'Игры', icon: '🎮', color: '#db2777' },
      { name: 'Подписки', icon: '📺', color: '#db2777' },
      { name: 'Музыка', icon: '🎵', color: '#db2777' },
      { name: 'Хобби', icon: '🎨', color: '#db2777' },
      { name: 'Путешествия и отдых', icon: '✈️', color: '#db2777' },
    ],
  },
  {
    name: 'Техника', kind: 'expense', icon: '💻', color: '#0f766e',
    children: [
      { name: 'Смартфоны', icon: '📱', color: '#0f766e' },
      { name: 'Компьютеры и комплектующие', icon: '💻', color: '#0f766e' },
      { name: 'Телевизоры', icon: '📺', color: '#0f766e' },
      { name: 'Бытовая техника', icon: '🔌', color: '#0f766e' },
      { name: 'Аудиотехника', icon: '🎧', color: '#0f766e' },
      { name: 'Аксессуары', icon: '🎮', color: '#0f766e' },
    ],
  },
  {
    name: 'Семья и подарки', kind: 'expense', icon: '🎁', color: '#c026d3',
    children: [
      { name: 'Подарки', icon: '🎁', color: '#c026d3' },
      { name: 'Праздники', icon: '🎉', color: '#c026d3' },
      { name: 'Совместные мероприятия', icon: '🥳', color: '#c026d3' },
      { name: 'Расходы на родственников', icon: '👨‍👩‍👧', color: '#c026d3' },
    ],
  },
  {
    name: 'Финансовые операции', kind: 'transfer', icon: '🔁', color: '#64748b',
    children: [
      { name: 'Погашение кредитов', icon: '💳', color: '#64748b' },
      { name: 'Проценты по кредитам', icon: '📈', color: '#64748b' },
      { name: 'Комиссии', icon: '💸', color: '#64748b' },
      { name: 'Банковские услуги', icon: '🏦', color: '#64748b' },
      { name: 'Переводы между счетами', icon: '🔁', color: '#64748b' },
    ],
  },
  {
    name: 'Накопления', kind: 'expense', icon: '🐷', color: '#059669',
    children: [
      { name: 'Резервный фонд', icon: '🛟', color: '#059669' },
      { name: 'Накопления на квартиру', icon: '🏢', color: '#059669' },
      { name: 'Накопления на автомобиль', icon: '🚙', color: '#059669' },
      { name: 'Накопления на крупные покупки', icon: '💰', color: '#059669' },
      { name: 'Другие цели', icon: '🎯', color: '#059669' },
    ],
  },
  {
    name: 'Прочее', kind: 'expense', icon: '📦', color: '#6b7280',
    children: [
      { name: 'Непредвиденные расходы', icon: '⚠️', color: '#6b7280' },
      { name: 'Неопределённая категория', icon: '❓', color: '#6b7280' },
    ],
  },
  {
    name: 'Доходы', kind: 'income', icon: '💵', color: '#16a34a',
    children: [
      { name: 'Зарплата первого участника', icon: '👨', color: '#16a34a' },
      { name: 'Зарплата второго участника', icon: '👩', color: '#16a34a' },
      { name: 'Премии', icon: '🌟', color: '#16a34a' },
      { name: 'Подработки', icon: '🛠️', color: '#16a34a' },
      { name: 'Возвраты и компенсации', icon: '↩️', color: '#16a34a' },
      { name: 'Доходы от продажи вещей', icon: '🏷️', color: '#16a34a' },
      { name: 'Проценты и инвестиционный доход', icon: '📈', color: '#16a34a' },
      { name: 'Прочие доходы', icon: '➕', color: '#16a34a' },
    ],
  },
]

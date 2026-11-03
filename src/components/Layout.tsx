import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Home, ListTree, Tag, LogOut, Calendar, Repeat, Target, ShoppingCart, ClipboardList, ChartBar as BarChart3, Bell, Users, Wallet, MessageCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'

const navItems = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/transactions', label: 'Операции', icon: ListTree, end: false },
  { to: '/accounts', label: 'Счета', icon: Wallet, end: false },
  { to: '/calendar', label: 'Календарь', icon: Calendar, end: false },
  { to: '/recurring', label: 'Регулярные платежи', icon: Repeat, end: false },
  { to: '/budgets', label: 'Бюджеты', icon: Target, end: false },
  { to: '/goals', label: 'Цели', icon: Target, end: false },
  { to: '/purchases', label: 'Планируемые покупки', icon: ShoppingCart, end: false },
  { to: '/planning', label: 'Планирование', icon: ClipboardList, end: false },
  { to: '/reports', label: 'Отчёты', icon: BarChart3, end: false },
  { to: '/analysis', label: 'Анализ по участникам', icon: Users, end: false },
  { to: '/notifications', label: 'Уведомления', icon: Bell, end: false },
  { to: '/categories', label: 'Категории', icon: Tag, end: false },
  { to: '/telegram', label: 'Telegram', icon: MessageCircle, end: false },
]

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav aria-label="Основная навигация" className={mobile
      ? 'flex gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
      : 'flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1'}>
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `group flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary-100 bg-primary-50 text-primary-800'
                : 'border-transparent text-muted hover:bg-canvas hover:text-ink'
            } ${mobile ? 'whitespace-nowrap' : 'w-full'}`}
        >
          <item.icon size={18} strokeWidth={1.8} className="shrink-0" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export default function Layout() {
  const { profile, family } = useAuth()
  const navigate = useNavigate()
  const signOut = async () => {
    await googleSheets.auth.signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-canvas md:flex">
      <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col border-r border-line bg-surface px-4 py-5 md:flex">
        <div className="mb-7 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-100 text-lg font-semibold text-primary-800">Б</div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight text-ink">Общий бюджет</div>
            <div className="mt-0.5 text-xs text-muted">личное пространство для двоих</div>
          </div>
        </div>

        <div className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Меню</div>
        <Navigation />

        <div className="mt-5 rounded-2xl border border-primary-100 bg-primary-50/70 p-3.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-700/70">Ваше пространство</div>
          <div className="mt-1.5 truncate text-sm font-semibold text-ink">{family?.name || 'Семейный бюджет'}</div>
          {family?.invite_code && (
            <div className="mt-2 text-xs text-muted">
              Код приглашения <span className="ml-1 font-mono font-semibold tracking-wide text-primary-800">{family.invite_code}</span>
            </div>
          )}
        </div>

        <div className="mt-auto flex items-center gap-3 border-t border-line px-2 pt-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-semibold text-primary-800">
            {(profile?.display_name || 'П').trim().charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{profile?.display_name || 'Пользователь'}</div>
            <div className="truncate text-xs text-muted">Участник семьи</div>
          </div>
          <button onClick={signOut} className="rounded-xl p-2 text-muted transition-colors hover:bg-canvas hover:text-ink" aria-label="Выйти" title="Выйти">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 font-semibold text-primary-800">Б</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">Общий бюджет</div>
                <div className="truncate text-[11px] text-muted">{family?.name || 'Для двоих'}</div>
              </div>
            </div>
            <button onClick={signOut} className="rounded-xl p-2 text-muted hover:bg-canvas hover:text-ink" aria-label="Выйти">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="border-b border-line bg-surface md:hidden">
          <Navigation mobile />
        </div>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-9 lg:py-9">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

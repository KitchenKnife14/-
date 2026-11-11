import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Home, ListTree, Tag, LogOut, Calendar, Repeat, Target, ShoppingCart, ClipboardList, ChartBar as BarChart3, Bell, Users, Wallet, MessageCircle, MoreHorizontal, X } from 'lucide-react'
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

const mobilePrimary = ['/', '/transactions', '/accounts', '/budgets']
const mobileMoreItems = navItems.filter(item => !mobilePrimary.includes(item.to))

function Navigation() {
  return (
    <nav aria-label="Основная навигация" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `group flex w-full shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary-100 bg-primary-50 text-primary-800'
                : 'border-transparent text-muted hover:bg-canvas hover:text-ink'
            }`}
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
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const moreActive = mobileMoreItems.some(item => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await googleSheets.auth.signOut()
    } finally {
      navigate('/', { replace: true })
      setSigningOut(false)
    }
  }

  return (
    <div className="app-shell min-h-screen bg-canvas md:flex">
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
          <button onClick={signOut} disabled={signingOut} className="rounded-xl p-2 text-muted transition-colors hover:bg-canvas hover:text-ink disabled:opacity-50" aria-label="Выйти" title="Выйти">
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
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-5 pb-28 sm:px-6 sm:py-7 sm:pb-28 lg:px-9 lg:py-9 md:pb-9">
          <Outlet />
        </main>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,23,42,0.06)] backdrop-blur md:hidden">
        {moreOpen && (
          <>
            <button type="button" aria-label="Закрыть меню" className="fixed inset-0 z-0 bg-black/20" onClick={() => setMoreOpen(false)} />
            <div className="absolute z-10 bottom-full left-3 right-3 mb-2 rounded-2xl border border-line bg-surface p-2 shadow-xl">
              <nav aria-label="Дополнительная навигация" className="grid max-h-[55vh] grid-cols-2 gap-1 overflow-y-auto">
                {mobileMoreItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) => `flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors ${
                      isActive ? 'bg-primary-50 font-semibold text-primary-800' : 'text-muted hover:bg-canvas'
                    }`}
                  >
                    <item.icon size={17} className="shrink-0" />
                    <span className="min-w-0">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
              <div className="mt-2 flex items-center gap-3 border-t border-line px-2 pt-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">Код приглашения</div>
                  <div className="truncate font-mono text-sm font-semibold text-primary-800">{family?.invite_code || 'Недоступен'}</div>
                </div>
                <button type="button" onClick={() => void signOut()} disabled={signingOut} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted hover:bg-canvas hover:text-ink disabled:opacity-50">
                  <LogOut size={16} />
                  Выйти
                </button>
              </div>
            </div>
          </>
        )}
        <nav aria-label="Нижняя навигация" className="relative z-10 grid grid-cols-5">
          {navItems.filter(item => mobilePrimary.includes(item.to)).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) => `flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-primary-800' : 'text-muted'
              }`}
            >
              {({ isActive }) => (
                <>
                  <item.icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen(open => !open)}
            aria-expanded={moreOpen}
            aria-label={moreOpen ? 'Закрыть дополнительные разделы' : 'Открыть дополнительные разделы'}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-medium transition-colors ${
              moreOpen || moreActive ? 'text-primary-800' : 'text-muted'
            }`}
          >
            {moreOpen ? <X size={20} /> : <MoreHorizontal size={20} />}
            <span>Ещё</span>
          </button>
        </nav>
      </div>
    </div>
  )
}

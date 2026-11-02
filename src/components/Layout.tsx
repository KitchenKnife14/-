import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Chrome as Home, ListTree, Tag, LogOut, Calendar, Repeat, Target, ShoppingCart, ClipboardList, ChartBar as BarChart3, Bell, Users, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'

const navItems = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/transactions', label: 'Операции', icon: ListTree, end: false },
  { to: '/accounts', label: 'Счета', icon: Wallet, end: false },
  { to: '/calendar', label: 'Календарь', icon: Calendar, end: false },
  { to: '/recurring', label: 'Регулярные', icon: Repeat, end: false },
  { to: '/budgets', label: 'Бюджеты', icon: Target, end: false },
  { to: '/goals', label: 'Цели', icon: Target, end: false },
  { to: '/purchases', label: 'Покупки', icon: ShoppingCart, end: false },
  { to: '/planning', label: 'Планирование', icon: ClipboardList, end: false },
  { to: '/reports', label: 'Отчёты', icon: BarChart3, end: false },
  { to: '/analysis', label: 'Анализ доходов', icon: Users, end: false },
  { to: '/notifications', label: 'Уведомления', icon: Bell, end: false },
  { to: '/categories', label: 'Категории', icon: Tag, end: false },
]

// На телефоне: четыре главных раздела внизу и пункт «Ещё» со всеми остальными разделами.
const primaryPaths = ['/', '/transactions', '/accounts', '/budgets']
const primaryNav = navItems.filter((item) => primaryPaths.includes(item.to))
const moreNav = navItems.filter((item) => !primaryPaths.includes(item.to))

export default function Layout() {
  const { profile, family } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const signOut = async () => { await googleSheets.auth.signOut(); navigate('/') }

  // После перехода на другой раздел закрываем меню «Ещё».
  useEffect(() => { setMoreOpen(false) }, [location.pathname])

  const moreActive = moreNav.some((item) => location.pathname.startsWith(item.to))

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Компьютер: боковая панель, как раньше */}
      <aside className="hidden md:flex md:w-60 md:border-r md:border-slate-200 bg-white md:min-h-screen md:sticky md:top-0 flex-col items-center justify-start px-4 py-6 gap-2 overflow-y-auto">
        <div className="mb-4">
          <div className="text-lg font-semibold text-slate-900">Бюджет</div>
          <div className="text-xs text-slate-400">для двоих</div>
        </div>
        <nav className="flex flex-col gap-1 w-full overflow-y-auto">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}>
              <item.icon size={18} /><span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-2">
          <div className="text-sm text-slate-700 truncate">{profile?.display_name || 'Пользователь'}</div>
          <div className="text-xs text-slate-400 truncate">{family?.name}</div>
          {family?.invite_code && <div className="text-xs text-slate-500 mt-1 mb-2">Код приглашения: <span className="font-mono font-semibold">{family.invite_code}</span></div>}
          <button onClick={signOut} className="btn-ghost w-full justify-start text-sm"><LogOut size={16} /> Выйти</button>
        </div>
      </aside>

      {/* Телефон: верхняя строка */}
      <header className="md:hidden sticky top-0 z-20 flex items-center justify-between gap-3 bg-white border-b border-slate-200 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="font-semibold text-slate-800">Бюджет</div>
        <div className="text-xs text-slate-400 truncate min-w-0">{family?.name}</div>
      </header>

      <main className="flex-1 min-w-0 p-4 pb-28 md:p-8 md:pb-8 max-w-5xl mx-auto w-full"><Outlet /></main>

      {/* Телефон: нижняя панель */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="grid grid-cols-5">
          {primaryNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 min-w-0 text-[11px] font-medium ${isActive ? 'text-primary-700' : 'text-slate-500'}`}>
              <item.icon size={22} /><span className="truncate max-w-full px-1">{item.label}</span>
            </NavLink>
          ))}
          <button type="button" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}
            className={`flex flex-col items-center gap-0.5 py-2 min-w-0 text-[11px] font-medium ${moreOpen || moreActive ? 'text-primary-700' : 'text-slate-500'}`}>
            <span className="h-[22px] text-xl leading-[22px]">•••</span><span>Ещё</span>
          </button>
        </div>
      </nav>

      {/* Телефон: меню «Ещё» */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <button type="button" aria-label="Закрыть меню" className="absolute inset-0 bg-slate-900/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{profile?.display_name || 'Пользователь'}</div>
                <div className="text-xs text-slate-400 truncate">{family?.name}</div>
                {family?.invite_code && <div className="text-xs text-slate-500 mt-1">Код приглашения: <span className="font-mono font-semibold select-all">{family.invite_code}</span></div>}
              </div>
              <button type="button" onClick={() => setMoreOpen(false)} className="btn-ghost px-2" aria-label="Закрыть">✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {moreNav.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1 rounded-xl p-3 text-xs font-medium text-center ${isActive ? 'bg-primary-50 text-primary-700' : 'bg-slate-50 text-slate-700'}`}>
                  <item.icon size={22} /><span>{item.label}</span>
                </NavLink>
              ))}
            </div>
            <button type="button" onClick={signOut} className="btn-ghost w-full justify-center text-sm mt-3"><LogOut size={16} /> Выйти</button>
          </div>
        </div>
      )}
    </div>
  )
}

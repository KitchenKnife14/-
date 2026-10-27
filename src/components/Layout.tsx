import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Chrome as Home, ListTree, Tag, LogOut, Calendar, Repeat, Target, ShoppingCart, ClipboardList, ChartBar as BarChart3, Bell, Users } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'

const navItems = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/transactions', label: 'Операции', icon: ListTree, end: false },
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

export default function Layout() {
  const { profile, family } = useAuth()
  const navigate = useNavigate()
  const signOut = async () => { await supabase.auth.signOut(); navigate('/') }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-60 md:border-r md:border-slate-200 bg-white md:min-h-screen md:sticky md:top-0 flex md:flex-col flex-row items-center justify-between md:justify-start px-4 py-3 md:py-6 gap-2 md:overflow-y-auto">
        <div className="hidden md:block mb-4">
          <div className="text-lg font-semibold text-slate-900">Бюджет</div>
          <div className="text-xs text-slate-400">для двоих</div>
        </div>
        <div className="md:hidden font-semibold text-slate-800">Бюджет</div>
        <nav className="flex md:flex-col gap-1 flex-1 md:flex-none md:w-full md:overflow-y-auto">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${isActive ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-100'}`}>
              <item.icon size={18} /><span className="hidden md:inline">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="hidden md:block mt-auto pt-2">
          <div className="text-sm text-slate-700 truncate">{profile?.display_name || 'Пользователь'}</div>
          <div className="text-xs text-slate-400 truncate mb-2">{family?.name}</div>
          <button onClick={signOut} className="btn-ghost w-full justify-start text-sm"><LogOut size={16} /> Выйти</button>
        </div>
        <button onClick={signOut} className="md:hidden btn-ghost px-2" aria-label="Выйти"><LogOut size={18} /></button>
      </aside>
      <main className="flex-1 p-4 md:p-8 max-w-5xl mx-auto w-full"><Outlet /></main>
    </div>
  )
}

import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import Layout from './components/Layout'
import { googleSheets } from './lib/googleSheets'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'))
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'))
const CalendarPage = lazy(() => import('./pages/CalendarPage'))
const RecurringPage = lazy(() => import('./pages/RecurringPage'))
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'))
const GoalsPage = lazy(() => import('./pages/GoalsPage'))
const PurchasesPage = lazy(() => import('./pages/PurchasesPage'))
const PlanningPage = lazy(() => import('./pages/PlanningPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage'))
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'))
const AccountsPage = lazy(() => import('./pages/AccountsPage'))

function PageFallback() {
  return <div className="flex min-h-screen items-center justify-center text-slate-400">Загрузка страницы…</div>
}

export default function App() {
  const { session, family, loading, error, refresh } = useAuth()

  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-400">Загрузка…</div>
  if (session && error) return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <section className="card w-full max-w-md space-y-4" role="alert" aria-live="polite">
        <h1 className="text-lg font-semibold text-slate-900">Не удалось загрузить семейный профиль</h1>
        <p className="text-sm text-slate-600">{error}</p>
        <p className="text-xs text-slate-500">Данные не изменены. Повторите загрузку или войдите заново. Не создавайте новую семью из-за этой ошибки.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn-primary flex-1" onClick={() => void refresh()}>Повторить</button>
          <button type="button" className="btn-secondary flex-1" onClick={() => void googleSheets.auth.signOut()}>Выйти и войти снова</button>
        </div>
      </section>
    </div>
  )
  if (!session) return <Routes><Route path="*" element={<AuthPage />} /></Routes>
  if (!family) return <Routes><Route path="*" element={<OnboardingPage />} /></Routes>

  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="recurring" element={<RecurringPage />} />
          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="purchases" element={<PurchasesPage />} />
          <Route path="planning" element={<PlanningPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="analysis" element={<AnalysisPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

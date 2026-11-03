import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import Layout from './components/Layout'

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
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8">
      <section role="alert" className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-ink">Не удалось загрузить семейное пространство</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{error}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          Повторить загрузку
        </button>
      </section>
    </main>
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

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

function PageLoading() {
  return <div className="flex min-h-[40vh] items-center justify-center text-slate-400">Загрузка страницы…</div>
}

export default function App() {
  const { session, family, loading } = useAuth()

  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-400">Загрузка…</div>
  if (!session) return <Routes><Route path="*" element={<AuthPage />} /></Routes>
  if (!family) return <Routes><Route path="*" element={<OnboardingPage />} /></Routes>

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
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

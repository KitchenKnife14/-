import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import AuthPage from './pages/AuthPage'
import OnboardingPage from './pages/OnboardingPage'
import Layout from './components/Layout'
import DashboardPage from './pages/DashboardPage'
import TransactionsPage from './pages/TransactionsPage'
import CategoriesPage from './pages/CategoriesPage'
import CalendarPage from './pages/CalendarPage'
import RecurringPage from './pages/RecurringPage'
import BudgetsPage from './pages/BudgetsPage'
import GoalsPage from './pages/GoalsPage'
import PurchasesPage from './pages/PurchasesPage'
import PlanningPage from './pages/PlanningPage'
import ReportsPage from './pages/ReportsPage'
import AnalysisPage from './pages/AnalysisPage'
import NotificationsPage from './pages/NotificationsPage'

export default function App() {
  const { session, family, loading } = useAuth()

  if (loading) return <div className="flex min-h-screen items-center justify-center text-slate-400">Загрузка…</div>
  if (!session) return <Routes><Route path="*" element={<AuthPage />} /></Routes>
  if (!family) return <Routes><Route path="*" element={<OnboardingPage />} /></Routes>

  return (
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
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { googleSheets } from '../lib/googleSheets'
import type { Account, Transaction } from '../lib/types'
import { formatRubles, rublesToKopecks } from '../lib/money'
import { calculateAccountBalances } from '../lib/accountBalances.js'
import { Plus, Pencil, Archive, Wallet } from 'lucide-react'
import Modal from '../components/Modal'

type AccountDraft = Pick<Account, 'id' | 'name' | 'kind' | 'starting_balance_kopecks'> | null

export default function AccountsPage() {
  const { family } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<AccountDraft>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Account['kind']>('bank')
  const [startingBalance, setStartingBalance] = useState('0')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    if (!family) return
    setLoading(true)
    setError(null)
    try {
      const [accountRes, txRes] = await Promise.all([
        googleSheets.from('accounts').select('*').eq('family_id', family.id).order('created_at', { ascending: true }),
        googleSheets.from('transactions').select('*').eq('family_id', family.id),
      ])
      if (accountRes.error) throw accountRes.error
      if (txRes.error) throw txRes.error
      setAccounts((accountRes.data ?? []) as Account[])
      setTransactions((txRes.data ?? []) as Transaction[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить счета')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const accountsChannel = googleSheets.channel('accounts-page-accounts').on('postgres_changes', { event: '*', schema: 'public', table: 'accounts', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    const transactionsChannel = googleSheets.channel('accounts-page-transactions').on('postgres_changes', { event: '*', schema: 'public', table: 'transactions', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { googleSheets.removeChannel(accountsChannel); googleSheets.removeChannel(transactionsChannel) }
  }, [family?.id])

  const balances = useMemo(() => calculateAccountBalances(accounts, transactions), [accounts, transactions])

  const openCreate = () => {
    setEditing(null); setName(''); setKind('bank'); setStartingBalance('0'); setError(null); setModalOpen(true)
  }
  const openEdit = (account: Account) => {
    setEditing({ id: account.id, name: account.name, kind: account.kind, starting_balance_kopecks: account.starting_balance_kopecks })
    setName(account.name); setKind(account.kind); setStartingBalance((account.starting_balance_kopecks / 100).toString()); setError(null); setModalOpen(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!family) return
    const normalizedName = name.trim()
    const balance = rublesToKopecks(Number(startingBalance.replace(',', '.')))
    if (!normalizedName) { setError('Введите название счёта'); return }
    if (!Number.isSafeInteger(balance)) { setError('Введите корректный начальный остаток'); return }
    setSaving(true); setError(null)
    try {
      const payload = { family_id: family.id, name: normalizedName, kind, starting_balance_kopecks: balance }
      const result = editing
        ? await googleSheets.from('accounts').update(payload).eq('id', editing.id)
        : await googleSheets.from('accounts').insert(payload)
      if (result.error) throw result.error
      setModalOpen(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить счёт')
    } finally { setSaving(false) }
  }

  const toggleArchived = async (account: Account) => {
    const { error: err } = await googleSheets.from('accounts').update({ archived: !account.archived }).eq('id', account.id)
    if (err) setError(err.message)
    else await load()
  }

  const visible = accounts.filter(a => showArchived || !a.archived)
  const total = visible.filter(a => !a.archived).reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-slate-900">Счета</h1><p className="text-sm text-slate-500 mt-1">Остатки рассчитываются по начальному балансу и операциям</p></div>
        <button onClick={openCreate} className="btn-primary"><Plus size={18} /> Добавить счёт</button>
      </div>
      <div className="card">
        <div className="text-sm text-slate-500">Общий остаток активных счетов</div>
        <div className="text-2xl font-semibold text-slate-900 mt-1">{formatRubles(total)}</div>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Показывать архивные счета</label>
      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
      {loading ? <div className="text-sm text-slate-400">Загрузка…</div> : visible.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Счетов пока нет. Создайте первый счёт.</div>
      ) : <div className="space-y-2">{visible.map(account => (
        <div key={account.id} className="card flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"><Wallet size={19} className="text-slate-500" /></div>
          <div className="flex-1 min-w-0"><div className="font-medium text-slate-900 truncate">{account.name}{account.archived && <span className="ml-2 text-xs text-slate-400">архив</span>}</div><div className="text-xs text-slate-500">{account.kind === 'cash' ? 'Наличные' : account.kind === 'bank' ? 'Банковский счёт' : account.kind === 'savings' ? 'Накопительный' : 'Другой'} · Начальный остаток: {formatRubles(account.starting_balance_kopecks)}</div></div>
          <div className="text-right"><div className="font-semibold text-slate-900">{formatRubles(balances.get(account.id) ?? 0)}</div><div className="text-xs text-slate-400">Текущий остаток</div></div>
          <button onClick={() => openEdit(account)} className="btn-ghost px-2" aria-label="Редактировать счёт"><Pencil size={16} /></button>
          <button onClick={() => toggleArchived(account)} className="btn-ghost px-2" aria-label={account.archived ? 'Восстановить счёт' : 'Архивировать счёт'}><Archive size={16} /></button>
        </div>
      ))}</div>}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Изменить счёт' : 'Новый счёт'}>
        <form onSubmit={save} className="space-y-3">
          <div><label className="label">Название</label><input className="input" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Например, Основная карта" /></div>
          <div><label className="label">Тип</label><select className="input" value={kind} onChange={e => setKind(e.target.value as Account['kind'])}><option value="bank">Банковский счёт</option><option value="cash">Наличные</option><option value="savings">Накопительный</option><option value="other">Другой</option></select></div>
          <div><label className="label">Начальный остаток, ₽</label><input className="input" type="number" step="0.01" value={startingBalance} onChange={e => setStartingBalance(e.target.value)} /></div>
          <div className="flex gap-2"><button type="button" onClick={() => setModalOpen(false)} className="btn-secondary flex-1">Отмена</button><button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button></div>
        </form>
      </Modal>
    </div>
  )
}

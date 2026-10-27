import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import type { Category, CategoryKind } from '../lib/types'
import Modal from '../components/Modal'
import { Plus, Pencil, Archive, Folder } from 'lucide-react'

export default function CategoriesPage() {
  const { family } = useAuth()
  const [cats, setCats] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Category | null>(null)
  const [parentId, setParentId] = useState<string | null>(null)

  const load = async () => {
    if (!family) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.from('categories').select('*').eq('family_id', family.id).order('sort_order').order('name')
      if (err) throw err
      setCats(data as Category[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [family?.id])
  useEffect(() => {
    if (!family) return
    const ch = supabase.channel('cat-page').on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `family_id=eq.${family.id}` }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [family?.id])

  const roots = cats.filter((c) => !c.parent_id && !c.archived)
  const childrenOf = (id: string) => cats.filter((c) => c.parent_id === id && !c.archived)

  const archive = async (c: Category) => {
    const { error: err } = await supabase.from('categories').update({ archived: true }).eq('id', c.id)
    if (err) setError(err.message)
    load()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">Категории</h1>
        <button onClick={() => { setEditing(null); setParentId(null); setShowForm(true) }} className="btn-primary">
          <Plus size={18} /> Добавить
        </button>
      </div>

      {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="text-sm text-slate-400">Загрузка…</div>
      ) : roots.length === 0 ? (
        <div className="card text-center py-8 text-sm text-slate-500">Категорий пока нет.</div>
      ) : (
        <div className="space-y-3">
          {roots.map((root) => {
            const kids = childrenOf(root.id)
            return (
              <div key={root.id} className="card">
                <div className="flex items-center gap-3">
                  <div className="text-xl w-9 h-9 rounded-full flex items-center justify-center" style={{ background: root.color + '22' }}>{root.icon}</div>
                  <div className="flex-1">
                    <div className="font-medium text-slate-900">{root.name}</div>
                    <div className="text-xs text-slate-400">
                      {root.kind === 'income' ? 'Доход' : root.kind === 'transfer' ? 'Перевод' : 'Расход'}
                      {kids.length > 0 && ` · ${kids.length} подкатегорий`}
                    </div>
                  </div>
                  <button onClick={() => { setEditing(null); setParentId(root.id); setShowForm(true) }} className="btn-ghost px-2" aria-label="Добавить подкатегорию"><Plus size={16} /></button>
                  <button onClick={() => { setEditing(root); setParentId(null); setShowForm(true) }} className="btn-ghost px-2" aria-label="Изменить"><Pencil size={16} /></button>
                  <button onClick={() => archive(root)} className="btn-ghost px-2 text-slate-400" aria-label="Архивировать"><Archive size={16} /></button>
                </div>
                {kids.length > 0 && (
                  <div className="mt-2 ml-12 space-y-1">
                    {kids.map((k) => (
                      <div key={k.id} className="flex items-center gap-2 py-1">
                        <Folder size={14} className="text-slate-400" />
                        <span className="text-sm text-slate-700 flex-1">{k.icon} {k.name}</span>
                        <button onClick={() => { setEditing(k); setParentId(null); setShowForm(true) }} className="btn-ghost px-2" aria-label="Изменить"><Pencil size={14} /></button>
                        <button onClick={() => archive(k)} className="btn-ghost px-2 text-slate-400" aria-label="Архивировать"><Archive size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <CategoryForm
        open={showForm}
        onClose={() => { setShowForm(false); setEditing(null); setParentId(null) }}
        onSaved={load}
        editing={editing}
        parentId={parentId}
        familyId={family?.id ?? null}
      />
    </div>
  )
}

function CategoryForm({ open, onClose, onSaved, editing, parentId, familyId }: {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editing: Category | null
  parentId: string | null
  familyId: string | null
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [icon, setIcon] = useState('🏷️')
  const [color, setColor] = useState('#64748b')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) {
      setName(editing.name); setKind(editing.kind); setIcon(editing.icon); setColor(editing.color)
    } else {
      setName(''); setKind(parentId ? 'expense' : 'expense'); setIcon('🏷️'); setColor('#64748b')
    }
    setError(null)
  }, [editing, open, parentId])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!familyId) return
    setError(null)
    setSaving(true)
    try {
      const payload = { name: name.trim(), kind, icon, color }
      if (editing) {
        const { error: err } = await supabase.from('categories').update(payload).eq('id', editing.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('categories').insert({ ...payload, family_id: familyId, parent_id: parentId })
        if (err) throw err
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Редактировать категорию' : parentId ? 'Новая подкатегория' : 'Новая категория'}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label">Название</label>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {!parentId && (
          <div>
            <label className="label">Тип</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
              <option value="expense">Расход</option>
              <option value="income">Доход</option>
              <option value="transfer">Перевод</option>
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Значок</label>
            <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} />
          </div>
          <div>
            <label className="label">Цвет</label>
            <input type="color" className="input h-10 p-1" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
        {error && <div className="text-sm text-danger-600 bg-danger-50 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Отмена</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">{saving ? 'Сохранение…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  )
}

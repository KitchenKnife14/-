import { supabase } from './googleSheets'
import { DEFAULT_CATEGORIES } from './defaultCategories'

type ExistingCategory = {
  id: string
  family_id: string
  parent_id: string | null
  name: string
  kind: string
}

export async function seedDefaultCategories(familyId: string): Promise<void> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('family_id', familyId)
  if (error) throw error

  const existing = (data ?? []) as ExistingCategory[]

  // Batch missing parent categories in one request, then fetch their generated IDs
  // from the returned rows before creating child categories.
  const missingParents = DEFAULT_CATEGORIES.filter((cat) =>
    !existing.some((item) => !item.parent_id && item.name === cat.name && item.kind === cat.kind)
  )
  if (missingParents.length) {
    const { data: created, error: createError } = await supabase
      .from('categories')
      .insert(missingParents.map((cat, index) => ({
        family_id: familyId,
        name: cat.name,
        kind: cat.kind,
        icon: cat.icon,
        color: cat.color,
        sort_order: existing.length + index,
      })))
      .select('*')
    if (createError) throw createError
    if (!created || created.length !== missingParents.length) {
      throw new Error('Не удалось создать основные категории')
    }
    existing.push(...(created as ExistingCategory[]))
  }

  const missingChildren: Array<{
    family_id: string
    parent_id: string
    name: string
    kind: string
    icon: string
    color: string
    sort_order: number
  }> = []

  for (const cat of DEFAULT_CATEGORIES) {
    const parent = existing.find((item) =>
      !item.parent_id && item.name === cat.name && item.kind === cat.kind
    )
    if (!parent) throw new Error(`Не найдена основная категория «${cat.name}»`)

    for (const [childIndex, child] of (cat.children ?? []).entries()) {
      const alreadyExists = existing.some((item) =>
        item.parent_id === parent.id && item.name === child.name
      )
      if (alreadyExists) continue
      missingChildren.push({
        family_id: familyId,
        parent_id: parent.id,
        name: child.name,
        kind: cat.kind,
        icon: child.icon,
        color: child.color,
        sort_order: childIndex,
      })
    }
  }

  if (missingChildren.length) {
    const { data: created, error: childError } = await supabase
      .from('categories')
      .insert(missingChildren)
      .select('*')
    if (childError) throw childError
    if (!created || created.length !== missingChildren.length) {
      throw new Error('Не удалось создать подкатегории')
    }
  }
}

export async function ensureProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' })
  if (error) throw error
}

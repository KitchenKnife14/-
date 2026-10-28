import { supabase } from './googleSheets'
import { DEFAULT_CATEGORIES } from './defaultCategories'

export async function seedDefaultCategories(familyId: string): Promise<void> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('family_id', familyId)
  if (error) throw error

  const existing = (data ?? []) as Array<{
    id: string
    family_id: string
    parent_id: string | null
    name: string
    kind: string
  }>

  // Idempotent seeding: if a previous attempt stopped halfway, create only missing rows.
  for (const [index, cat] of DEFAULT_CATEGORIES.entries()) {
    let parent = existing.find((item) =>
      !item.parent_id && item.name === cat.name && item.kind === cat.kind
    )

    if (!parent) {
      const { data: created, error: createError } = await supabase
        .from('categories')
        .insert({
          family_id: familyId,
          name: cat.name,
          kind: cat.kind,
          icon: cat.icon,
          color: cat.color,
          sort_order: index,
        })
        .select('*')
        .single()
      if (createError) throw createError
      if (!created) throw new Error(`Не удалось создать категорию «${cat.name}»`)
      parent = created as typeof existing[number]
      existing.push(parent)
    }

    for (const [childIndex, child] of (cat.children ?? []).entries()) {
      const alreadyExists = existing.some((item) =>
        item.parent_id === parent!.id && item.name === child.name
      )
      if (alreadyExists) continue

      const { data: createdChild, error: childError } = await supabase
        .from('categories')
        .insert({
          family_id: familyId,
          parent_id: parent.id,
          name: child.name,
          kind: cat.kind,
          icon: child.icon,
          color: child.color,
          sort_order: childIndex,
        })
        .select('*')
        .single()
      if (childError) throw childError
      if (!createdChild) throw new Error(`Не удалось создать подкатегорию «${child.name}»`)
      existing.push(createdChild as typeof existing[number])
    }
  }
}

export async function ensureProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' })
  if (error) throw error
}

import { supabase } from './googleSheets'
import { DEFAULT_CATEGORIES } from './defaultCategories'

export async function seedDefaultCategories(familyId: string): Promise<void> {
  const { data: existing, error: checkErr } = await supabase
    .from('categories')
    .select('id')
    .eq('family_id', familyId)
    .limit(1)
  if (checkErr) throw checkErr
  if (existing && existing.length > 0) return

  for (const cat of DEFAULT_CATEGORIES) {
    const { data: parent, error: pErr } = await supabase
      .from('categories')
      .insert({
        family_id: familyId,
        name: cat.name,
        kind: cat.kind,
        icon: cat.icon,
        color: cat.color,
        sort_order: 0,
      })
      .select('id')
      .single()
    if (pErr || !parent) continue
    if (cat.children) {
      for (const child of cat.children) {
        await supabase.from('categories').insert({
          family_id: familyId,
          parent_id: parent.id,
          name: child.name,
          kind: cat.kind,
          icon: child.icon,
          color: child.color,
          sort_order: 0,
        })
      }
    }
  }
}

export async function ensureProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .upsert({ id: userId, display_name: displayName }, { onConflict: 'id' })
  if (error) throw error
}

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const forms = {
  'src/pages/AccountsPage.tsx': ['account-name', 'account-kind', 'account-opening-balance'],
  'src/pages/BudgetsPage.tsx': ['budget-category', 'budget-limit'],
  'src/pages/CategoriesPage.tsx': ['category-name', 'category-kind', 'category-icon', 'category-color'],
  'src/pages/GoalsPage.tsx': [
    'goal-name', 'goal-description', 'goal-target', 'goal-target-date', 'goal-priority',
    'goal-contribution-amount', 'goal-contribution-date', 'goal-contribution-note',
  ],
  'src/pages/OnboardingPage.tsx': ['onboarding-user-name', 'onboarding-family-name', 'onboarding-invite-code'],
  'src/pages/PlanningPage.tsx': ['monthly-plan-category', 'monthly-plan-amount', 'monthly-plan-note'],
  'src/pages/PurchasesPage.tsx': [
    'purchase-name', 'purchase-category', 'purchase-estimated', 'purchase-priority', 'purchase-status',
    'purchase-desired-month', 'purchase-desired-date', 'purchase-url', 'purchase-goal', 'purchase-comment',
  ],
  'src/pages/RecurringPage.tsx': [
    'recurring-description', 'recurring-amount', 'recurring-account', 'recurring-category',
    'recurring-responsible', 'recurring-frequency', 'recurring-custom-days',
    'recurring-start-date', 'recurring-end-date',
  ],
}

test('form labels in account, budget, category, goal, onboarding, planning, purchase, and recurring pages are programmatically associated', () => {
  for (const [file, ids] of Object.entries(forms)) {
    const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
    for (const id of ids) {
      assert.match(source, new RegExp(`<label\\b[^>]*htmlFor=["']${id}["']`), `${file}: label missing htmlFor for ${id}`)
      assert.match(source, new RegExp(`<(?:input|select|textarea)\\b[^>]*id=["']${id}["']`), `${file}: control missing id ${id}`)
    }
    const styledLabels = [...source.matchAll(/<label\b(?=[^>]*className=["']label["'])[^>]*>/g)]
    for (const [label] of styledLabels) {
      assert.match(label, /htmlFor=/, `${file}: visible form label is not associated`)
    }
  }
})

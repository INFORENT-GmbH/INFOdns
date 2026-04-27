# INFORENT Prisma — AI Contributor Instructions

These instructions apply to GitHub Copilot, Claude Code, and any other AI assistant working in this repository.

## Keep README.md up to date

- When you add, remove, or significantly change a feature, API endpoint, page, or configuration option, update `README.md` accordingly.
- Do not let `README.md` drift from the actual implementation. It is the primary reference for developers and operators.
- Sections to keep in sync: Architecture, API Endpoints, Web UI pages, Environment Variables, Docker Compose services, and the Development / Deployment sections.

## Always use i18n — never hardcode user-facing strings

All user-facing text in the React frontend **must** go through the i18n system. Do not hardcode English (or any language) strings directly in JSX.

### How to add a translated string

1. Add the key to **both** `en` and `de` objects in `web/src/i18n/translations.ts`:
   ```ts
   // English
   my_new_key: 'My new label',

   // German
   my_new_key: 'Meine neue Bezeichnung',
   ```
2. Use it in the component via the `useI18n` hook:
   ```tsx
   import { useI18n } from '../i18n/I18nContext'

   function MyComponent() {
     const { t } = useI18n()
     return <span>{t('my_new_key')}</span>
   }
   ```

### Parameterised strings

For strings with dynamic values, use a function:
```ts
// translations.ts
confirm_delete: (name: string) => `Delete "${name}"? This cannot be undone.`,

// component
t('confirm_delete', itemName)
```

### Rules

- Every new page or component that renders text **must** call `useI18n()` and use `t()`.
- Never use raw string literals like `'Loading…'`, `'Cancel'`, `'Error'` in JSX — use the corresponding translation key.
- Both `en` and `de` entries must be added at the same time. Leaving one language incomplete will cause TypeScript errors due to the `satisfies` constraint on the translations object.
- The default language is **German** (`de`). Ensure German translations are natural, not machine-literal.

## General guidelines

- Follow the existing code style (inline styles via `styles` objects, React functional components, Tanstack Query for data fetching).
- The backend (Fastify API) is in `api/`, the zone worker is in `worker/`, and the frontend is in `web/`.
- DNS record validation lives in `api/src/records/validators.ts` — update it when adding new record types.
- Zone rendering logic lives in `worker/src/renderZone.ts` — it is a pure function and must stay pure.

## Git commits

- Whenever you make changes, run `git commit` with a clear, concise message describing the change.
- Use conventional commit format: `type(scope): description`
   - Examples: `feat(i18n): add German translations for bulk editor`, `fix(worker): prevent race in zone render`, `docs(readme): update API endpoints`
- Commit early and often — don't batch unrelated changes together.

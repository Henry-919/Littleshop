<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/3a8c77bc-3883-4def-a410-962863f2f537

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Configure `.env` or `.env.local` with `GEMINI_API_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY`
3. Optional: set `VITE_ADMIN_EMAILS=admin1@example.com,admin2@example.com` as a fallback admin list
4. Run the app: `npm run dev`

## Login and roles

This project now uses Supabase Auth for login.

Recommended setup order in Supabase SQL Editor:

1. Run [templates/auth_roles.sql](templates/auth_roles.sql)
2. Insert at least one `admin` record into `public.user_roles`
3. If you use transfer history, run [templates/stock_transfers.sql](templates/stock_transfers.sql)
4. Run [templates/app_rls.sql](templates/app_rls.sql)

Notes:

- `admin` can edit all business data
- `viewer` can sign in and view all data, but cannot write to the database
- [templates/app_rls.sql](templates/app_rls.sql) will rebuild policies for `stores`, `categories`, `products`, `sales`, `returns`, `daily_payments`, and `stock_transfers`
- Because it rebuilds policies on those app tables, run it after your table structure is ready
- If you do not want to create the role table immediately, you can temporarily rely on `VITE_ADMIN_EMAILS`, but database-side enforcement still requires `public.user_roles`

## Supabase transfer history

If you enable store-to-store transfer history, create the table with [templates/stock_transfers.sql](templates/stock_transfers.sql) before running [templates/app_rls.sql](templates/app_rls.sql).

If you see `Could not find the table 'public.stock_transfers' in the schema cache`, run the SQL file again once and make sure it finishes successfully.

API ENDPOINTS

1. AUTH & Profile
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET /api/users/me --> view profile
- PUT /api/users/me --> update profile (nama/password)
- GET /api/users/dashboard
- GET /api/users/notifications & PATCH /api/users/notifications/:id/read

2. BOOK & CATEGORIES
- GET /api/categories
- GET /api/books/ --> catalog buku
- GET /api/books/:id

3. LOAN & RETURN BOOKS
- POST /api/loans
- GET /api/loans/my
- GET /api/loans/:id
- PATCH /api/loans/:id/cancel
- PATCH /api/loans/:id/return-request

4. ADMIN/STAFF ACTION (role admin/staff only)
- GET /api/admin/dashboard
Manage user & NIM:
- GET /api/admin/users
- PATCH /api/admin/users/:id/nim-review
- PATCH /api/admin/users/:id/status
Manage books and categories:
- POST /api/admin/categories
- PUT /api/admin/categories/:id
- DELETE /api/admin/categories/:id
- POST /api/admin/books
- PUT /api/admin/books/:id
- DELETE /api/admin/:id --> jika buku punya riwayat transaksi di loans_items, lakukan soft delete(is_active = false)
Manage loans & returns:
- GET /api/admin/loans
- PATCH /api/admin/loans/:id/approve
- PATCH /api/admin/loans/:id/handover --> konfirmasi buku telah diambil users
- PATCH /api/admin/loans/:id/reject
- PATCH /api/admin/loans/:id/confirm-return
Manage settings:
- GET /api/admin/settings
- PUT /api/admin/settings --> update loan_durations_day, max_active_loans, dll
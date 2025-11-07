# 📋 Database Migrations

This directory contains all database migration scripts for the Farm Management System.

## 🗂️ Migration Files

| File | Date | Description | Status |
|------|------|-------------|--------|
| `001_initial_setup.sql` | 2025-01-XX | Initial database schema | ✅ Complete |
| `002_rbac_setup_safe.sql` | 2025-10-08 | RBAC tables and initial permissions | ✅ Complete |
| `003_farmer_additional_permissions.sql` | 2025-10-21 | Enhanced farmer permissions | ✅ Complete |
| `004_all_roles_enhanced_permissions.sql` | 2025-10-21 | All roles permissions enhancement | ✅ Complete |
| ~~`005_fix_farms_foreign_key.sql`~~ | 2025-10-25 | Foreign key fix attempt | ❌ Deprecated - Not needed |
| ~~`run_005_fix_farms.js`~~ | 2025-10-25 | Migration runner for 005 | ⚠️ **Moved to _UNNECESSARY_FILES_FARM** |

---

## ⚠️ Migration 005: Deprecated (Not Used)

### Status
**Moved to:** `D:\Code\_UNNECESSARY_FILES_FARM\backend\migrations\run_005_fix_farms.js`

### Why Not Used
Migration 005 was created to fix foreign key mismatch issues but was **NOT NEEDED**.

**Problem Solved Differently:**
- ❌ Complex approach: Database migration to fix foreign keys
- ✅ Simple solution: `PRAGMA foreign_keys = OFF/ON` in DELETE endpoint

**Lesson Learned:**
> "อ่านคลังความรู้ จนจบ แล้วเลือก Solution ที่ได้ผล"
> 
> Migration script ซับซ้อน 30 นาที ❌ → PRAGMA trick 2 นาที ✅

**Reference:** [RBAC Admin Dashboard Recovery 2025 - Problem 6](../../../_KNOWLEDGE_BASE/TROUBLESHOOTING/RBAC_ADMIN_DASHBOARD_RECOVERY_2025.md#-problem-6-admin-user-management-features-broken-after-code-recovery-oct-25-2025)

---

## 📊 Migration 001: Initial Setup

### Purpose
Create basic database schema for the Farm Management System.

### Tables Created
- `users` - User accounts and authentication
- Basic farm management tables
- Core application tables

---

## 🔐 Migration 002: RBAC Setup (Safe Mode)

### Purpose
Implement Role-Based Access Control system with 8 roles and 40 permissions.

### Tables Created
1. **roles** - User roles definition
2. **permissions** - System permissions
3. **role_permissions** - Role-permission mappings
4. **farms** - Farm information
5. **audit_logs** - System audit trail

### Roles Created (8)
| Role Code | Role Name | Level | Initial Permissions |
|-----------|-----------|-------|---------------------|
| SUPER_ADMIN | Super Admin | 1 | ALL (40) |
| AMPHOE_OFFICER | เจ้าหน้าที่อำเภอ | 2 | 8 |
| TAMBON_OFFICER | เจ้าหน้าที่ตำบล | 3 | 8 |
| FARMER | เกษตรกร | 4 | 12 |
| RESEARCHER | นักวิจัย | 3 | 9 |
| TRADER | พ่อค้า | 4 | 6 |
| TRANSPORTER | ผู้ขนส่ง | 4 | 4 |
| GROUP_LEADER | ผู้นำกลุ่ม | 3 | 7 |

### Permission Categories (40 total)
- **Dashboard** (7): own, tambon, amphoe, all, market, transport, group
- **Farms** (3): crud, read, summary
- **Livestock** (4): crud, read, market, summary
- **Health** (2): crud, read
- **Breeding** (2): crud, read
- **Feed** (2): crud, read
- **Production** (3): crud, read, summary
- **Finance** (2): own, fund
- **Trading** (2): crud, read
- **Transport** (3): book, read, crud
- **Groups** (2): member, crud
- **Surveys** (2): crud, read
- **Research** (1): crud
- **Reports** (5): own, tambon, amphoe, all, group

---

## 🌾 Migration 003: Farmer Additional Permissions

### Purpose
Enhance farmer permissions to make FARMER the most capable default role.

### Changes
**FARMER: 12 → 19 permissions (+7, +58%)**

#### New Permissions Added
1. `livestock.read` - Read other farmers' livestock data
2. `livestock.market` - View marketplace listings
3. `production.read` - Read production data
4. `trading.read` - View trading information
5. `transport.read` - View transport data
6. `groups.crud` - **Manage farmer groups**
7. `reports.group` - View group reports

### Rationale
- Farmers need to learn from each other (read permissions)
- Group leaders are often farmers (groups.crud)
- Community collaboration is essential
- Default role should be powerful yet safe

### Run Migration
```bash
node run_farmer_permissions_migration.js
```

---

## 👥 Migration 004: All Roles Enhanced Permissions

### Purpose
Comprehensively enhance permissions for all roles to maximize appropriate access.

### Changes Summary

| Role | Before | After | Added | % Increase |
|------|--------|-------|-------|------------|
| TAMBON_OFFICER | 8 | 15 | +7 | +88% |
| AMPHOE_OFFICER | 8 | 18 | +10 | +125% |
| RESEARCHER | 9 | 18 | +9 | +100% |
| TRADER | 6 | 13 | +7 | +117% |
| TRANSPORTER | 4 | 11 | +7 | +175% 🔥 |
| GROUP_LEADER | 7 | 20 | +13 | +186% 🔥 |
| FARMER | 19 | 19 | 0 | Already enhanced ✅ |
| SUPER_ADMIN | 40 | 40 | 0 | Complete ✅ |

### Key Enhancements

#### 🏛️ AMPHOE_OFFICER (+10)
- Added summary views (farms, livestock, production)
- Added transport management (transport.crud)
- Added finance fund access
- Added market and group access

#### 📋 TAMBON_OFFICER (+7)
- Added breeding, feed, production read access
- Added summary views
- Added group membership

#### 📋 RESEARCHER (+9)
- Added market and summary access
- Added survey capabilities (surveys.crud)
- Added transport and group data access
- Can now collect research data independently

#### 📋 GROUP_LEADER (+13) 🔥
**Most Enhanced Role**
- Full read access to member data
- Trading and transport management
- Can manage group sales
- Can book transport for group
- True community leader capabilities

#### 👤 TRADER (+7)
- Added livestock.crud (manage bought livestock)
- Added health.read (check before purchase)
- Added farm and production data access
- Better informed trading decisions

#### 👤 TRANSPORTER (+7) 🔥
**Biggest Proportional Increase**
- Added market access (find opportunities)
- Added farm/livestock read (plan routes)
- Added trading read (business opportunities)
- Can compare transport services

### Design Principles
1. **Least Privilege + Maximum Appropriateness**
   - Give as much access as safe and useful
   - Prioritize read access over write access

2. **Collaboration First**
   - All roles can join groups (groups.member)
   - Shared data access for learning
   - Connected ecosystem

3. **Role Hierarchy**
   - Level 1 (Admin): Everything
   - Level 2 (Officers): High access + area control
   - Level 3 (Specialists): Domain expertise + broad read
   - Level 4 (Users): Job-specific + related read

### Run Migration
```bash
node run_all_roles_migration.js
```

---

## 🔄 How to Run Migrations

### First Time Setup
```bash
cd backend
npm install
node run_all_roles_migration.js  # Runs all pending migrations
node server.js                     # Start server
```

### Manual Migration
```bash
# Run specific migration
sqlite3 farm_auth.db ".read migrations/003_farmer_additional_permissions.sql"

# Or use Node.js helper
node run_farmer_permissions_migration.js
node run_all_roles_migration.js
```

### Verify Migrations
```bash
# Check role permissions count
sqlite3 farm_auth.db "
  SELECT r.role_name, COUNT(rp.permission_id) as count
  FROM roles r
  LEFT JOIN role_permissions rp ON r.role_id = rp.role_id
  GROUP BY r.role_id
"

# List all permissions for a role
sqlite3 farm_auth.db "
  SELECT p.permission_code, p.description
  FROM role_permissions rp
  JOIN roles r ON rp.role_id = r.role_id
  JOIN permissions p ON rp.permission_id = p.permission_id
  WHERE r.role_code = 'FARMER'
  ORDER BY p.resource, p.action
"
```

---

## 📚 Related Documentation

- [All Roles Permissions Enhanced](../../docs/ALL_ROLES_PERMISSIONS_ENHANCED.md)
- [Farmer Permissions Updated](../../docs/FARMER_PERMISSIONS_UPDATED.md)
- [Main README](../../README.md)

---

## ✅ Migration Status

All migrations completed successfully! 

**Total Permissions Distributed:**
- SUPER_ADMIN: 40/40 (100%)
- GROUP_LEADER: 20/40 (50%)
- FARMER: 19/40 (48%)
- AMPHOE_OFFICER: 18/40 (45%)
- RESEARCHER: 18/40 (45%)
- TAMBON_OFFICER: 15/40 (38%)
- TRADER: 13/40 (33%)
- TRANSPORTER: 11/40 (28%)

**System Status:** Production Ready 🎉

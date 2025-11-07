-- ============================================
-- SAFE RBAC Migration Script
-- Version: 1.0 (Safe Mode)
-- Date: 2025-10-08
-- Description: Add RBAC without errors on existing columns
-- ============================================

BEGIN TRANSACTION;

-- ============================================
-- 1. CREATE ROLES TABLE (IF NOT EXISTS)
-- ============================================

CREATE TABLE IF NOT EXISTS roles (
    role_id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_name TEXT NOT NULL UNIQUE,
    role_code TEXT NOT NULL UNIQUE,
    description TEXT,
    level INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(role_code);
CREATE INDEX IF NOT EXISTS idx_roles_level ON roles(level);

-- Insert default roles (IGNORE if exists)
INSERT OR IGNORE INTO roles (role_name, role_code, description, level) VALUES
('Super Admin', 'SUPER_ADMIN', 'ผู้ดูแลระบบสูงสุด', 1),
('เจ้าหน้าที่อำเภอ', 'AMPHOE_OFFICER', 'เจ้าหน้าที่ปศุสัตว์อำเภอ', 2),
('เจ้าหน้าที่ตำบล', 'TAMBON_OFFICER', 'เจ้าหน้าที่ปศุสัตว์ตำบล', 3),
('เกษตรกร', 'FARMER', 'เจ้าของฟาร์ม', 4),
('นักวิจัย', 'RESEARCHER', 'นักวิจัยและนักวิชาการ', 3),
('พ่อค้า', 'TRADER', 'พ่อค้า/นายฮ้อย', 4),
('ผู้ขนส่ง', 'TRANSPORTER', 'ผู้ประกอบการขนส่ง', 4),
('ผู้นำกลุ่ม', 'GROUP_LEADER', 'ผู้นำชุมชน/กลุ่มเกษตรกร', 3);

-- ============================================
-- 2. CREATE PERMISSIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS permissions (
    permission_id INTEGER PRIMARY KEY AUTOINCREMENT,
    permission_name TEXT NOT NULL,
    permission_code TEXT NOT NULL UNIQUE,
    resource TEXT NOT NULL,
    action TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource);
CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(permission_code);

-- Insert permissions (IGNORE if exists)
INSERT OR IGNORE INTO permissions (permission_name, permission_code, resource, action, description) VALUES
-- Dashboard
('Dashboard (Own)', 'dashboard.own', 'dashboard', 'own', 'ดู Dashboard ข้อมูลของตัวเอง'),
('Dashboard (Tambon)', 'dashboard.tambon', 'dashboard', 'tambon', 'ดู Dashboard ระดับตำบล'),
('Dashboard (Amphoe)', 'dashboard.amphoe', 'dashboard', 'amphoe', 'ดู Dashboard ระดับอำเภอ'),
('Dashboard (All)', 'dashboard.all', 'dashboard', 'all', 'ดู Dashboard ทั้งหมด'),
('Dashboard (Market)', 'dashboard.market', 'dashboard', 'market', 'ดู Dashboard ตลาด'),
('Dashboard (Transport)', 'dashboard.transport', 'dashboard', 'transport', 'ดู Dashboard ขนส่ง'),
('Dashboard (Group)', 'dashboard.group', 'dashboard', 'group', 'ดู Dashboard กลุ่ม'),

-- จัดการฟาร์ม
('ฟาร์ม (CRUD)', 'farms.crud', 'farms', 'crud', 'จัดการฟาร์มได้ทั้งหมด'),
('ฟาร์ม (Read)', 'farms.read', 'farms', 'read', 'ดูข้อมูลฟาร์ม'),
('ฟาร์ม (Summary)', 'farms.summary', 'farms', 'summary', 'ดูข้อมูลสรุปฟาร์ม'),

-- จัดการปศุสัตว์
('ปศุสัตว์ (CRUD)', 'livestock.crud', 'livestock', 'crud', 'จัดการปศุสัตว์ได้ทั้งหมด'),
('ปศุสัตว์ (Read)', 'livestock.read', 'livestock', 'read', 'ดูข้อมูลปศุสัตว์'),
('ปศุสัตว์ (Market)', 'livestock.market', 'livestock', 'market', 'ดูปศุสัตว์ในตลาด'),
('ปศุสัตว์ (Summary)', 'livestock.summary', 'livestock', 'summary', 'ดูข้อมูลสรุปปศุสัตว์'),

-- สุขภาพ/วัคซีน
('สุขภาพ (CRUD)', 'health.crud', 'health', 'crud', 'จัดการข้อมูลสุขภาพ'),
('สุขภาพ (Read)', 'health.read', 'health', 'read', 'ดูข้อมูลสุขภาพ'),

-- ผสมพันธุ์
('ผสมพันธุ์ (CRUD)', 'breeding.crud', 'breeding', 'crud', 'จัดการข้อมูลผสมพันธุ์'),
('ผสมพันธุ์ (Read)', 'breeding.read', 'breeding', 'read', 'ดูข้อมูลผสมพันธุ์'),

-- อาหารสัตว์
('อาหารสัตว์ (CRUD)', 'feed.crud', 'feed', 'crud', 'จัดการข้อมูลอาหารสัตว์'),
('อาหารสัตว์ (Read)', 'feed.read', 'feed', 'read', 'ดูข้อมูลอาหารสัตว์'),

-- ผลผลิต
('ผลผลิต (CRUD)', 'production.crud', 'production', 'crud', 'จัดการข้อมูลผลผลิต'),
('ผลผลิต (Read)', 'production.read', 'production', 'read', 'ดูข้อมูลผลผลิต'),
('ผลผลิต (Summary)', 'production.summary', 'production', 'summary', 'ดูข้อมูลสรุปผลผลิต'),

-- การเงิน
('การเงิน (Own)', 'finance.own', 'finance', 'own', 'จัดการการเงินของตัวเอง'),
('การเงิน (Fund)', 'finance.fund', 'finance', 'fund', 'จัดการกองทุนกลุ่ม'),

-- ตลาดออนไลน์
('ตลาด (CRUD)', 'trading.crud', 'trading', 'crud', 'จัดการประกาศซื้อขาย'),
('ตลาด (Read)', 'trading.read', 'trading', 'read', 'ดูข้อมูลตลาด'),

-- การขนส่ง
('ขนส่ง (Book)', 'transport.book', 'transport', 'book', 'จองรถขนส่ง'),
('ขนส่ง (Read)', 'transport.read', 'transport', 'read', 'ดูข้อมูลการขนส่ง'),
('ขนส่ง (CRUD)', 'transport.crud', 'transport', 'crud', 'จัดการรถขนส่ง'),

-- กลุ่มเกษตรกร
('กลุ่ม (Member)', 'groups.member', 'groups', 'member', 'เป็นสมาชิกกลุ่ม'),
('กลุ่ม (CRUD)', 'groups.crud', 'groups', 'crud', 'จัดการกลุ่มเกษตรกร'),

-- สำรวจ
('สำรวจ (CRUD)', 'surveys.crud', 'surveys', 'crud', 'สำรวจและบันทึกข้อมูล'),
('สำรวจ (Read)', 'surveys.read', 'surveys', 'read', 'ดูข้อมูลการสำรวจ'),

-- วิจัย
('วิจัย (CRUD)', 'research.crud', 'research', 'crud', 'จัดการโครงการวิจัย'),

-- รายงาน
('รายงาน (Own)', 'reports.own', 'reports', 'own', 'ดูรายงานของตัวเอง'),
('รายงาน (Tambon)', 'reports.tambon', 'reports', 'tambon', 'ดูรายงานระดับตำบล'),
('รายงาน (Amphoe)', 'reports.amphoe', 'reports', 'amphoe', 'ดูรายงานระดับอำเภอ'),
('รายงาน (All)', 'reports.all', 'reports', 'all', 'ดูรายงานทั้งหมด'),
('รายงาน (Group)', 'reports.group', 'reports', 'group', 'ดูรายงานกลุ่ม');

-- ============================================
-- 3. CREATE ROLE_PERMISSIONS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE,
    UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);

-- ============================================
-- 4. ASSIGN PERMISSIONS TO ROLES
-- ============================================

-- FARMER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'FARMER' AND p.permission_code IN (
    'dashboard.own',
    'farms.crud',
    'livestock.crud',
    'health.crud',
    'breeding.crud',
    'feed.crud',
    'production.crud',
    'finance.own',
    'trading.crud',
    'transport.book',
    'groups.member',
    'reports.own'
);

-- TAMBON_OFFICER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TAMBON_OFFICER' AND p.permission_code IN (
    'dashboard.tambon',
    'farms.read',
    'livestock.read',
    'health.read',
    'trading.read',
    'transport.read',
    'surveys.crud',
    'reports.tambon'
);

-- AMPHOE_OFFICER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'AMPHOE_OFFICER' AND p.permission_code IN (
    'dashboard.amphoe',
    'farms.read',
    'livestock.read',
    'health.read',
    'trading.read',
    'transport.read',
    'surveys.read',
    'reports.amphoe'
);

-- RESEARCHER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'RESEARCHER' AND p.permission_code IN (
    'dashboard.all',
    'farms.read',
    'livestock.read',
    'health.read',
    'breeding.read',
    'feed.read',
    'production.read',
    'research.crud',
    'reports.all'
);

-- TRADER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TRADER' AND p.permission_code IN (
    'dashboard.market',
    'livestock.market',
    'finance.own',
    'trading.crud',
    'transport.book',
    'reports.own'
);

-- TRANSPORTER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TRANSPORTER' AND p.permission_code IN (
    'dashboard.transport',
    'finance.own',
    'transport.crud',
    'reports.own'
);

-- GROUP_LEADER permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'GROUP_LEADER' AND p.permission_code IN (
    'dashboard.group',
    'farms.summary',
    'livestock.summary',
    'production.summary',
    'finance.fund',
    'groups.crud',
    'reports.group'
);

-- SUPER_ADMIN permissions (all permissions)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'SUPER_ADMIN';

-- ============================================
-- 5. CREATE FARMS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS farms (
    farm_id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    farm_name TEXT NOT NULL,
    farm_code TEXT UNIQUE,
    address TEXT,
    tambon_code TEXT,
    amphoe_code TEXT,
    province_code TEXT,
    latitude REAL,
    longitude REAL,
    farm_type TEXT,
    total_area REAL,
    status TEXT DEFAULT 'ACTIVE',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_farms_owner ON farms(owner_id);
CREATE INDEX IF NOT EXISTS idx_farms_tambon ON farms(tambon_code);
CREATE INDEX IF NOT EXISTS idx_farms_amphoe ON farms(amphoe_code);
CREATE INDEX IF NOT EXISTS idx_farms_status ON farms(status);
CREATE INDEX IF NOT EXISTS idx_farms_code ON farms(farm_code);

-- ============================================
-- 6. CREATE AUDIT LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS audit_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resource_id INTEGER,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    success INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============================================
-- 7. UPDATE EXISTING USERS WITH DEFAULT ROLE
-- ============================================

-- Update existing users to have FARMER role if role is NULL or empty
UPDATE users 
SET role = 'FARMER' 
WHERE role IS NULL OR role = '';

-- Create indices on users table (if not exists)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

COMMIT;

-- ============================================
-- END OF MIGRATION
-- ============================================

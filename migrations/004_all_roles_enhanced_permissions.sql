-- ============================================
-- เพิ่มสิทธิ์ให้ทุก Roles
-- Date: 2025-10-21
-- Description: ให้สิทธิ์มากที่สุดเท่าที่เหมาะสมกับแต่ละ Role
-- ============================================

BEGIN TRANSACTION;

-- ============================================
-- 1. TAMBON_OFFICER (เจ้าหน้าที่ตำบล)
-- เพิ่มจาก 8 → 15 permissions
-- ============================================
-- เหตุผล: เจ้าหน้าที่ตำบลควรเข้าถึงข้อมูลในพื้นที่ได้มากขึ้น
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TAMBON_OFFICER' AND p.permission_code IN (
    -- เพิ่ม Read permissions
    'breeding.read',        -- ดูข้อมูลผสมพันธุ์
    'feed.read',           -- ดูข้อมูลอาหารสัตว์
    'production.read',     -- ดูข้อมูลผลผลิต
    'production.summary',  -- ดูสรุปผลผลิต
    'livestock.summary',   -- ดูสรุปปศุสัตว์
    'farms.summary',       -- ดูสรุปฟาร์ม
    'groups.member'        -- เข้าร่วมกลุ่ม (เพื่อติดตาม)
);

-- ============================================
-- 2. AMPHOE_OFFICER (เจ้าหน้าที่อำเภอ)
-- เพิ่มจาก 8 → 18 permissions
-- ============================================
-- เหตุผล: เจ้าหน้าที่อำเภอควรมีสิทธิ์มากกว่าตำบล
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'AMPHOE_OFFICER' AND p.permission_code IN (
    -- เพิ่ม Read permissions
    'breeding.read',        -- ดูข้อมูลผสมพันธุ์
    'feed.read',           -- ดูข้อมูลอาหารสัตว์
    'production.read',     -- ดูข้อมูลผลผลิต
    'production.summary',  -- ดูสรุปผลผลิต
    'livestock.summary',   -- ดูสรุปปศุสัตว์
    'farms.summary',       -- ดูสรุปฟาร์ม
    'livestock.market',    -- ดูตลาด
    'groups.member',       -- เข้าร่วมกลุ่ม
    'finance.fund',        -- ดูกองทุนกลุ่ม
    'transport.crud'       -- จัดการขนส่ง (ควบคุม)
);

-- ============================================
-- 3. RESEARCHER (นักวิจัย)
-- เพิ่มจาก 9 → 18 permissions
-- ============================================
-- เหตุผล: นักวิจัยต้องเข้าถึงข้อมูลได้เกือบทั้งหมด เพื่อการวิจัย
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'RESEARCHER' AND p.permission_code IN (
    -- เพิ่ม Read permissions (ทุกอย่าง)
    'livestock.market',     -- ดูตลาด
    'livestock.summary',    -- ดูสรุปปศุสัตว์
    'farms.summary',        -- ดูสรุปฟาร์ม
    'production.summary',   -- ดูสรุปผลผลิต
    'trading.read',         -- ดูข้อมูลตลาด
    'transport.read',       -- ดูข้อมูลขนส่ง
    'groups.member',        -- เข้าร่วมกลุ่ม
    'surveys.crud',         -- สำรวจข้อมูล
    'reports.group'         -- ดูรายงานกลุ่ม
);

-- ============================================
-- 4. TRADER (พ่อค้า)
-- เพิ่มจาก 6 → 13 permissions
-- ============================================
-- เหตุผล: พ่อค้าต้องดูข้อมูลปศุสัตว์และฟาร์มได้มากขึ้น
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TRADER' AND p.permission_code IN (
    -- เพิ่ม Read permissions
    'livestock.read',       -- อ่านข้อมูลปศุสัตว์
    'livestock.crud',       -- จัดการปศุสัตว์ (ซื้อมาขาย)
    'farms.read',          -- ดูข้อมูลฟาร์ม
    'production.read',     -- ดูข้อมูลผลผลิต
    'health.read',         -- ดูข้อมูลสุขภาพ (ก่อนซื้อ)
    'groups.member',       -- เข้าร่วมกลุ่ม
    'dashboard.own'        -- ดู Dashboard
);

-- ============================================
-- 5. TRANSPORTER (ผู้ขนส่ง)
-- เพิ่มจาก 4 → 11 permissions
-- ============================================
-- เหตุผล: ผู้ขนส่งต้องดูข้อมูลเพื่อวางแผนเส้นทาง
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'TRANSPORTER' AND p.permission_code IN (
    -- เพิ่ม Read permissions
    'livestock.read',       -- ดูข้อมูลปศุสัตว์ (ที่จะขนส่ง)
    'livestock.market',     -- ดูตลาด (โอกาสขนส่ง)
    'farms.read',          -- ดูข้อมูลฟาร์ม (ที่อยู่)
    'trading.read',        -- ดูข้อมูลตลาด (โอกาส)
    'groups.member',       -- เข้าร่วมกลุ่ม
    'dashboard.own',       -- ดู Dashboard
    'transport.read'       -- ดูข้อมูลขนส่งอื่น (เปรียบเทียบ)
);

-- ============================================
-- 6. GROUP_LEADER (ผู้นำกลุ่ม)
-- เพิ่มจาก 7 → 20 permissions
-- ============================================
-- เหตุผล: ผู้นำกลุ่มต้องเข้าถึงข้อมูลสมาชิกได้เกือบทั้งหมด
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'GROUP_LEADER' AND p.permission_code IN (
    -- เพิ่ม Read permissions (เกือบทั้งหมด)
    'livestock.read',       -- ดูข้อมูลปศุสัตว์สมาชิก
    'livestock.market',     -- ดูตลาด
    'farms.read',          -- ดูข้อมูลฟาร์มสมาชิก
    'health.read',         -- ดูข้อมูลสุขภาพ
    'breeding.read',       -- ดูข้อมูลผสมพันธุ์
    'feed.read',          -- ดูข้อมูลอาหารสัตว์
    'production.read',    -- ดูข้อมูลผลผลิต
    'trading.read',       -- ดูข้อมูลตลาด
    'trading.crud',       -- จัดการประกาศกลุ่ม
    'transport.read',     -- ดูข้อมูลขนส่ง
    'transport.book',     -- จองรถขนส่งให้กลุ่ม
    'surveys.read',       -- ดูข้อมูลสำรวจ
    'groups.member'       -- เป็นสมาชิกกลุ่มอื่น
);

COMMIT;

-- ============================================
-- สรุปสิทธิ์หลังอัปเดต
-- ============================================
-- Role               | Before | After | Added
-- -------------------|--------|-------|-------
-- SUPER_ADMIN        | ALL    | ALL   | 0 (เต็ม)
-- AMPHOE_OFFICER     | 8      | 18    | +10
-- TAMBON_OFFICER     | 8      | 15    | +7
-- FARMER             | 19     | 19    | 0 (อัปเดตแล้ว)
-- RESEARCHER         | 9      | 18    | +9
-- TRADER             | 6      | 13    | +7
-- TRANSPORTER        | 4      | 11    | +7
-- GROUP_LEADER       | 7      | 20    | +13
-- ============================================

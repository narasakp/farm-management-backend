-- ============================================
-- เพิ่มสิทธิ์ให้เกษตรกร (FARMER)
-- Date: 2025-10-21
-- Description: เพิ่มสิทธิ์ให้เกษตรกรมากขึ้น เพื่อให้เป็น Default Role ที่มีสิทธิ์ครบถ้วน
-- ============================================

BEGIN TRANSACTION;

-- เพิ่ม permissions ให้ FARMER
-- ให้เกษตรกรสามารถอ่านข้อมูลได้มากขึ้น และดูรายงานกลุ่มได้
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r, permissions p
WHERE r.role_code = 'FARMER' AND p.permission_code IN (
    -- เพิ่มสิทธิ์อ่านข้อมูล (Read permissions)
    'livestock.read',      -- อ่านข้อมูลปศุสัตว์ของคนอื่น
    'livestock.market',    -- ดูปศุสัตว์ในตลาด
    'trading.read',        -- อ่านข้อมูลตลาด/ประกาศซื้อขาย
    'transport.read',      -- อ่านข้อมูลการขนส่ง
    'production.read',     -- อ่านข้อมูลผลผลิต
    'reports.group',       -- ดูรายงานกลุ่ม (ถ้าเป็นสมาชิกกลุ่ม)
    
    -- เพิ่มสิทธิ์จัดการกลุ่ม (สำหรับหัวหน้ากลุ่มที่เป็นเกษตรกร)
    'groups.crud'          -- จัดการกลุ่มเกษตรกร (สร้าง/แก้ไข/ลบ)
);

COMMIT;

-- ============================================
-- สรุปสิทธิ์เกษตรกรหลังอัปเดต (19 permissions)
-- ============================================
-- 1. dashboard.own       ✅ ดู Dashboard ของตัวเอง
-- 2. farms.crud          ✅ จัดการฟาร์ม
-- 3. livestock.crud      ✅ จัดการปศุสัตว์
-- 4. livestock.read      ✨ NEW - อ่านข้อมูลปศุสัตว์
-- 5. livestock.market    ✨ NEW - ดูปศุสัตว์ในตลาด
-- 6. health.crud         ✅ จัดการสุขภาพ
-- 7. breeding.crud       ✅ จัดการผสมพันธุ์
-- 8. feed.crud           ✅ จัดการอาหารสัตว์
-- 9. production.crud     ✅ จัดการผลผลิต
-- 10. production.read    ✨ NEW - อ่านข้อมูลผลผลิต
-- 11. finance.own        ✅ จัดการการเงินตัวเอง
-- 12. trading.crud       ✅ จัดการประกาศซื้อขาย
-- 13. trading.read       ✨ NEW - อ่านข้อมูลตลาด
-- 14. transport.book     ✅ จองรถขนส่ง
-- 15. transport.read     ✨ NEW - อ่านข้อมูลขนส่ง
-- 16. groups.member      ✅ เป็นสมาชิกกลุ่ม
-- 17. groups.crud        ✨ NEW - จัดการกลุ่มเกษตรกร
-- 18. reports.own        ✅ ดูรายงานตัวเอง
-- 19. reports.group      ✨ NEW - ดูรายงานกลุ่ม
-- ============================================

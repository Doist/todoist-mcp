# 🔄 Reviewer Workflow Guide – PRs

## 1. Assign Reviewer / มอบหมายผู้ตรวจสอบ
- [ ] Assign at least 1 reviewer → เพิ่ม reviewer ให้ PR
- [ ] Confirm reviewer role → Dev / Security / Owner

## 2. Review Changes / ตรวจสอบการเปลี่ยนแปลง
- [ ] Check dependency updates → ตรวจสอบว่าเป็น security patch หรือ performance fix
- [ ] Check breaking changes → ไม่มี logic ที่กระทบระบบ
- [ ] Check documentation → อัปเดต changelog หรือ release notes

## 3. Run Tests / รันทดสอบ
- [ ] Run CI/CD pipeline → ให้แน่ใจว่า test suite ผ่านทั้งหมด
- [ ] Run integration tests → ตรวจสอบ compatibility กับ app logic
- [ ] Run smoke tests → ตรวจสอบ basic functionality หลัง merge

## 4. Approve & Merge / อนุมัติและรวมโค้ด
- [ ] Approve PR → reviewer กด "Approve"
- [ ] Merge ASAP → โดยเฉพาะ critical security updates
- [ ] Confirm branch → merge เข้าสู่ `main` หรือ branch ที่ถูกต้อง

## 5. Post-Merge Validation / ตรวจสอบหลังการรวมโค้ด
- [ ] Run integration tests อีกครั้ง → ตรวจสอบ compatibility
- [ ] Monitor logs → ตรวจสอบ error หรือ warning
- [ ] Notify team → แจ้งทีมว่า merge เสร็จแล้ว

## 6. Documentation Update / อัปเดตเอกสาร
- [ ] Update `docs/reviewer.checklist.md` → บันทึกผลการตรวจสอบ
- [ ] Update changelog → เพิ่มรายการ dependencies ที่อัปเดต
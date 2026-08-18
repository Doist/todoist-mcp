# ✅ Reviewer Checklist – PR #1 (todoist-mcp)

## 🔐 Security Focus / จุดเน้นด้านความปลอดภัย
- [ ] ตรวจสอบ **hono** → JWT validation, cache leakage, CSS injection (patched)
- [ ] ตรวจสอบ **fast-uri** → URI parsing exploit (patched)
- [ ] ตรวจสอบ **path-to-regexp** → CVE-2026-4926, CVE-2026-4923 (patched)
- [ ] ตรวจสอบ **postcss** → XSS via `<style>`, file read vulnerability (patched)
- [ ] ตรวจสอบ **dompurify** → regex ReDoS, Shadow DOM sanitization (patched)
- [ ] ตรวจสอบ **@hono/node-server** → static middleware bug fix (patched)

## 🧪 Testing / การทดสอบ
- [ ] Run CI/CD pipeline → ให้แน่ใจว่า test suite ผ่านทั้งหมด
- [ ] Run integration tests → ตรวจสอบ compatibility กับ app logic
- [ ] Run smoke tests → ตรวจสอบ basic functionality หลัง merge

## 📦 Compatibility / ความเข้ากันได้
- [ ] ตรวจสอบว่าไม่มี breaking changes ใน app logic
- [ ] ตรวจสอบว่า route matching ยังทำงานถูกต้อง
- [ ] ตรวจสอบว่า sanitization และ parsing consistency ยังถูกต้อง

## 📌 Reviewer Action / ขั้นตอนของ Reviewer
- [ ] Assign reviewer → เพิ่ม reviewer ให้ PR #1
- [ ] Approve & Merge ASAP → เน้น critical packages (#hono, #fast-uri, #path-to-regexp, #postcss)
- [ ] Post-merge test → รัน integration tests + smoke tests อีกครั้ง
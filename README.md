# TFP MIS · ระบบยืมอุปกรณ์ IT

Single Page App (HTML + Tailwind CDN + Vanilla JS) เชื่อมต่อ Google Sheets ผ่าน Google Apps Script

## โครงสร้างไฟล์
```
it-lending-app/
├── index.html            หน้าเว็บ (Login / User / Admin / Modal)
├── css/style.css         ธีม Cyber/Neon
├── js/
│   ├── data.js           ค่าคงที่ (แผนก/โรงงาน/อุปกรณ์) + บัญชี login
│   └── app.js            Logic + Fetch API   ← วาง SCRIPT_URL ที่บนสุดไฟล์นี้
└── google-apps-script.js โค้ดหลังบ้าน (นำไปวางใน Apps Script)
```

## บัญชีทดสอบ
| สิทธิ์ | Username | Password |
|-------|----------|----------|
| Admin | `admin`  | `mis7day` |
| User  | `tfp`    | `tfp2569` |

## ขั้นตอนติดตั้ง (Backend → Google Sheets)
1. สร้าง Google Sheet ใหม่ → เมนู **Extensions ▸ Apps Script**
2. ลบโค้ดตัวอย่าง แล้ววางเนื้อหาทั้งหมดจาก `google-apps-script.js`
3. **Deploy ▸ New deployment ▸ Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. คัดลอก **Web App URL** (ลงท้ายด้วย `/exec`)
5. เปิด `js/app.js` แล้ววาง URL ลงในบรรทัดบนสุด:
   ```js
   const SCRIPT_URL = 'https://script.google.com/macros/s/XXXX/exec';
   ```
6. เปิด `index.html` บนเบราว์เซอร์ → ใช้งานได้ทันที

> คอลัมน์ในชีต (สร้างอัตโนมัติเมื่อเรียกครั้งแรก):
> `ID | Timestamp | Name | Department | Factory | Category | Brand | AssetId | BorrowDate | ReturnDate | ActualReturnDate | Status`
> โดย `AssetId` = รหัสทรัพย์สิน (อยู่หลัง Brand)
> โดย `ReturnDate` = กำหนดวันคืน (deadline), `ActualReturnDate` = วันที่คืนจริง

## หมายเหตุ
- POST ใช้ `Content-Type: text/plain` เพื่อเลี่ยง CORS preflight ของ Apps Script (ฝั่งเซิร์ฟเวอร์ parse JSON เอง) — เป็นวิธีมาตรฐานที่ใช้ได้จริง
- ถ้ายังไม่ได้ตั้ง `SCRIPT_URL` หน้าเว็บจะขึ้นข้อความเตือนสีเหลืองแทนการพยายามเชื่อมต่อ
- หน้า User "ประวัติการยืมล่าสุด" แสดงรายการทั้งหมดจากชีต (schema ที่กำหนดไม่มีคอลัมน์เจ้าของรายการ) — หากต้องการกรองเฉพาะรายบุคคล ต้องเพิ่มคอลัมน์ Owner/Account
```

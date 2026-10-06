# 💕 Soulmate Log Book

A private, password-protected love log book for two — built as a pure static site with live sync via Supabase. Deployed on [Vercel](https://vercel.com).

![Soulmate Logo](https://lh3.googleusercontent.com/d/1eoI5L95RQxWzs0yaDrFMtst2FFsbK_Ny)

## ✨ Features
- 🔐 Password-protected entry screen
- 📖 Love Contract / sign-off section with **Our Love Stamp**
- 🔄 Real-time sync between devices (Supabase backend)
- 📧 One-tap "Export as Email" (styled HTML with logo + love stamp)
- 📱 Phone-first compact design (notched-device support, iOS zoom prevention)

## 📁 Project Structure
```
.
├── index.html      # Page markup (entry point — lowercase required for Vercel/Linux)
├── css/
│   └── style.css   # All styles (responsive breakpoints: 1100 / 850 / 550 / 380 px)
├── js/
│   └── main.js     # App logic, Supabase sync, email export
└── README.md
```

## 🚀 Deploy to Vercel
1. Push this repository to GitHub.
2. Go to [vercel.com/new](https://vercel.com/new) → **Import** the repo.
3. Framework preset: **Other** (no build step needed — it's a plain static site).
4. Click **Deploy**. Done! 🎉

Local preview: `python3 -m http.server 8000` then open http://localhost:8000

## 🖼️ Branding Assets
| Asset | URL | Used in |
|---|---|---|
| Soulmate Logo | `https://lh3.googleusercontent.com/d/1eoI5L95RQxWzs0yaDrFMtst2FFsbK_Ny` | Favicon, Apple touch icon, login screen, app header, email export |
| Love Stamp | `https://drive.google.com/thumbnail?id=14gtWWOaphAn3Zmfay9FfxgaLQvlot7tT&sz=w600` | Sign-off section, footer, email export |

> Note: Google Drive `/file/view` links don't render in `<img>` tags — the direct-thumbnail format above is used instead. Make sure the Drive file sharing is set to **"Anyone with the link"**.

## ⚠️ Security Note
The Supabase anon key and page password are hardcoded in `js/main.js`. This is acceptable for a private couple's log book, but if this repo is ever made public, move secrets to Vercel Environment Variables or keep the repo private.

---
Made with ❤️ — deployed on Vercel (formerly Netlify; all Netlify code has been removed).

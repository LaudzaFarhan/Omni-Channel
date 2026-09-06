import React, { useState } from 'react';
import { ArrowLeft, BookOpen, Check, Copy, Share2, Sparkles, Zap, Code, Clock, Calendar, CheckCircle2, MessageSquare, Terminal } from 'lucide-react';
import { BrandLockup } from './BrandMark.jsx';

export default function BlogPost({ onBack, onGoToDashboard }) {
  const [copied, setCopied] = useState(false);

  const fullMarkdownArticle = `# Cara Integrasi WhatsApp Unofficial API Indonesia untuk CS Multi-Agent & Notifikasi Otomatis

Di era digital saat ini, **WhatsApp** menjadi kanal komunikasi utama antara bisnis dan pelanggan di Indonesia. Lebih dari 90% pengguna smartphone di Indonesia menggunakan WhatsApp setiap hari untuk bertransaksi, menanyakan ketersediaan produk, hingga komplain layanan pelanggan.

Namun, kendala terbesar bagi bisnis berkembang adalah **keterbatasan WhatsApp Web biasa (maksimal 4 perangkat)** serta mahalnya biaya per pesan di *Official WhatsApp Cloud API*. 

Solusi terbaik dan paling hemat biaya untuk mengatasi masalah ini adalah menggunakan **WhatsApp Unofficial API Indo** seperti [Omni Reach](https://www.omnireach.my.id/).

---

## Apa itu WhatsApp Unofficial API Indo?

WhatsApp Unofficial API adalah gateway API yang menghubungkan nomor WhatsApp pribadi atau bisnis Anda langsung ke server tanpa perlu proses verifikasi Facebook Business Manager yang rumit dan tanpa biaya per template pesan (*no conversation fee*).

### Keunggulan WhatsApp Unofficial API dibanding Official API:
1. **Bebas Biaya Template Percakapan**: Tidak ada biaya Rp 400 - Rp 600 per percakapan seperti di Official API.
2. **Kirim Pesan Sepuasnya**: Cocok untuk notifikasi transaksi, OTP, tagihan, dan pesan promosi kepada prospek.
3. **Bypass Limit 4 Perangkat**: Satu nomor WhatsApp dapat diakses oleh puluhan hingga ratusan agen Customer Service (CS) sekaligus.
4. **Integrasi Bot AI & Webhook Fleksibel**: Bebas diintegrasikan dengan AI bot (OpenAI, Claude) atau webhook backend Anda sendiri.

---

## Arsitektur CS Multi-Agent: Cara Kerja Bypass 4 Perangkat

Secara default, WhatsApp hanya mengizinkan 1 ponsel utama dan 4 perangkat pendamping (*linked companion devices*). 

Dengan sistem gateway [Omni Reach](https://www.omnireach.my.id/):
- Server menghubungkan nomor WhatsApp Anda sebagai **1 perangkat pendamping**.
- Gateway kemudian membuka koneksi **WebSockets realtime** ke dashboard web multi-agent.
- Setiap tim CS atau sales login ke akun masing-masing dan dapat membalas chat secara bersamaan dari nomor WhatsApp yang sama.

---

## Contoh Integrasi Kode (Code Snippets)

### 1. Mengirim Pesan Teks Otomatis (Node.js / JavaScript)
\`\`\`javascript
const axios = require('axios');

async function sendWhatsAppMessage(phone, text) {
  try {
    const response = await axios.post('https://www.omnireach.my.id/api/send-message', {
      sessionId: 'default',
      to: phone, // Format: 6281234567890
      message: text
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });
    console.log('Pesan terkirim:', response.data);
  } catch (error) {
    console.error('Gagal mengirim pesan:', error.response?.data || error.message);
  }
}

// Contoh Pemanggilan:
sendWhatsAppMessage('6281234567890', 'Halo! Pesanan #INV-20260901 Anda sedang diproses.');
\`\`\`

### 2. Mengirim Pesan Otomatis Menggunakan PHP (cURL)
\`\`\`php
<?php
$curl = curl_init();

$payload = [
    "sessionId" => "default",
    "to" => "6281234567890",
    "message" => "Halo Pak/Bu, tagihan langganan Anda telah terbit. Terima kasih!"
];

curl_setopt_array($curl, [
    CURLOPT_URL => "https://www.omnireach.my.id/api/send-message",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => json_encode($payload),
    CURLOPT_HTTPHEADER => [
        "Content-Type: application/json",
        "Authorization: Bearer YOUR_API_TOKEN"
    ],
]);

$response = curl_exec($curl);
curl_close($curl);

echo $response;
?>
\`\`\`

### 3. Fitur Hold Agent / AI Bot Handover
Ketika agen manusia ingin mengambil alih percakapan dari AI Bot, Anda cukup memanggil endpoint Hold:
\`\`\`bash
curl -X POST https://www.omnireach.my.id/api/agent/hold \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "default",
    "chatJid": "6281234567890@s.whatsapp.net",
    "action": "hold"
  }'
\`\`\`

---

## Fitur Unggulan untuk Tim Sales & Bisnis di Indonesia

1. **SLA Follow-Up 24 Jam**: Visual counter dan filter khusus untuk memastikan prospek tidak dibiarkan tanpa balasan lebih dari 24 jam.
2. **Riwayat & Analitik Tim Sales**: Filter percakapan berdasarkan kalender tanggal (Hari Ini, Kemarin, 7 Hari Terakhir, Bulan Ini, atau Custom) dan pantau leaderboard performa agen.
3. **Contact Profile & Tagging**: Drawer profil pelanggan bergaya WhatsApp lengkap dengan tag interaktif (VIP, Leads, Follow Up, dll).
4. **⚡ Lightning Quick Reply**: Balas pertanyaan umum pelanggan dalam hitungan detik menggunakan template shortcut (\`/\`).

---

## Kesimpulan

Menggunakan **WhatsApp Unofficial API Indo** adalah langkah strategis untuk mempercepat respon pelanggan (*closing rate* lebih tinggi) tanpa terbebani biaya langganan yang mahal per pesan. 

Mulai uji coba gratis dan integrasikan nomor WhatsApp bisnis Anda sekarang di:
👉 **[https://www.omnireach.my.id/](https://www.omnireach.my.id/)**
`;

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(fullMarkdownArticle);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ height: '100vh', width: '100vw', overflowY: 'auto', background: 'var(--bg-main)', color: 'var(--text-main)', fontFamily: "'Outfit', sans-serif" }}>
      {/* Header Navigation */}
      <nav style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 28px', borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-panel, var(--bg-sidebar))', position: 'sticky', top: 0, zIndex: 100,
        backdropFilter: 'blur(10px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            type="button"
            onClick={onBack}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              border: '1px solid var(--border-color)', background: 'var(--overlay-subtle)',
              color: 'var(--text-main)', padding: '6px 14px', borderRadius: '8px',
              fontSize: '0.84rem', fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s ease',
            }}
          >
            <ArrowLeft size={16} /> Kembali
          </button>
          <BrandLockup onNavigateHome={onBack} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={handleCopyMarkdown}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 14px', borderRadius: '8px', border: '1px solid var(--border-color)',
              background: copied ? 'var(--success-soft)' : 'transparent',
              color: copied ? 'var(--success)' : 'var(--text-main)',
              fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer',
            }}
            title="Salin isi artikel format Markdown untuk Medium / Dev.to"
          >
            {copied ? <><Check size={14} /> Tersalin (Markdown)</> : <><Copy size={14} /> Salin untuk Medium/Dev.to</>}
          </button>

          <button
            type="button"
            className="nav-btn"
            onClick={onGoToDashboard}
            style={{ padding: '8px 18px', fontSize: '0.84rem' }}
          >
            Mulai Uji Coba Gratis
          </button>
        </div>
      </nav>

      {/* Article Container */}
      <main style={{ maxWidth: '840px', margin: '0 auto', padding: '40px 20px 80px' }}>
        {/* Meta Header */}
        <div style={{ marginBottom: '28px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '4px 12px', borderRadius: '999px', background: 'var(--primary-soft)',
            color: 'var(--primary)', fontSize: '0.78rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px'
          }}>
            <Sparkles size={13} /> PANDUAN TEKNIS & INTEGRASI API
          </div>

          <h1 style={{ fontSize: '2.4rem', fontWeight: '800', lineHeight: 1.25, color: 'var(--text-main)', marginBottom: '16px' }}>
            Cara Integrasi WhatsApp Unofficial API Indonesia untuk CS Multi-Agent & Notifikasi Otomatis
          </h1>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', fontSize: '0.84rem', color: 'var(--text-dimmed)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Calendar size={14} /> 2 Juli 2026 (2 bulan lalu)
            </span>
            <span>•</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Clock size={14} /> 5 menit membaca
            </span>
            <span>•</span>
            <span style={{ color: 'var(--primary)', fontWeight: '600' }}>
              By Tim Engineer Omni Reach
            </span>
          </div>
        </div>

        {/* Article Body */}
        <article style={{ lineHeight: 1.75, fontSize: '1.02rem', color: 'var(--text-main)' }}>
          <p style={{ fontSize: '1.12rem', color: 'var(--text-main)', marginBottom: '20px' }}>
            Di era digital saat ini, <strong>WhatsApp</strong> menjadi kanal komunikasi nomor satu antara bisnis dan konsumen di Indonesia. Lebih dari 90% pengguna smartphone menggunakan WhatsApp setiap hari untuk menanyakan ketersediaan produk, transaksi, hingga komplain layanan pelanggan.
          </p>

          <p style={{ marginBottom: '24px' }}>
            Namun kendala terbesar bagi bisnis berkembang adalah <strong>keterbatasan 4 perangkat pada WhatsApp Web biasa</strong> serta biaya per percakapan yang relatif tinggi pada Official Cloud API. Solusi terbaik dan paling efisien adalah memanfaatkan <strong>WhatsApp Unofficial API Indo</strong> dengan platform gateway modern seperti <a href="https://www.omnireach.my.id/" style={{ color: 'var(--primary)', fontWeight: '700', textDecoration: 'underline' }}>Omni Reach</a>.
          </p>

          <hr style={{ borderColor: 'var(--border-color)', margin: '30px 0' }} />

          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginTop: '32px', marginBottom: '14px', color: 'var(--text-main)' }}>
            Apa itu WhatsApp Unofficial API Indo?
          </h2>
          <p style={{ marginBottom: '16px' }}>
            WhatsApp Unofficial API adalah arsitektur gateway yang menghubungkan nomor WhatsApp pribadi atau bisnis Anda secara langsung tanpa proses verifikasi Facebook Business yang rumit dan <strong>tanpa biaya per template pesan</strong>.
          </p>

          <div style={{ background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '20px', marginBottom: '28px' }}>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: '700', color: 'var(--primary)' }}>
              Keunggulan Utama WhatsApp Unofficial API:
            </h4>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.94rem' }}>
              <li><strong>Bebas Biaya Percakapan:</strong> Tidak dikenakan biaya Rp 400 - Rp 600 per sesi pesan seperti di Official API.</li>
              <li><strong>Bypass Limit 4 Perangkat:</strong> 1 nomor WhatsApp dapat diakses puluhan hingga ratusan agen CS sekaligus secara realtime.</li>
              <li><strong>Fleksibilitas Bot AI & Webhook:</strong> Integrasi mudah dengan backend Anda (Laravel, Node.js, Python, Golang) maupun AI LLM (OpenAI/Claude).</li>
            </ul>
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginTop: '36px', marginBottom: '14px', color: 'var(--text-main)' }}>
            Contoh Kode Integrasi API (Node.js & PHP)
          </h2>

          <h3 style={{ fontSize: '1.15rem', fontWeight: '700', marginTop: '20px', marginBottom: '8px' }}>
            1. Kirim Pesan Teks Otomatis (Node.js / Axios)
          </h3>
          <pre style={{
            background: 'rgba(0, 0, 0, 0.4)', padding: '16px', borderRadius: '10px',
            border: '1px solid var(--border-color)', color: '#a5f3fc', fontSize: '0.82rem',
            overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: '20px',
          }}>
{`const axios = require('axios');

async function sendWhatsAppMessage(phone, text) {
  try {
    const response = await axios.post('https://www.omnireach.my.id/api/send-message', {
      sessionId: 'default',
      to: phone, // Format: 6281234567890
      message: text
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer YOUR_API_TOKEN'
      }
    });
    console.log('Pesan berhasil terkirim:', response.data);
  } catch (error) {
    console.error('Gagal mengirim pesan:', error.response?.data || error.message);
  }
}

// Pemanggilan:
sendWhatsAppMessage('6281234567890', 'Halo! Pesanan Anda telah kami konfirmasi.');`}
          </pre>

          <h3 style={{ fontSize: '1.15rem', fontWeight: '700', marginTop: '24px', marginBottom: '8px' }}>
            2. Kirim Notifikasi Transaksi Menggunakan PHP (cURL)
          </h3>
          <pre style={{
            background: 'rgba(0, 0, 0, 0.4)', padding: '16px', borderRadius: '10px',
            border: '1px solid var(--border-color)', color: '#a5f3fc', fontSize: '0.82rem',
            overflowX: 'auto', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: '24px',
          }}>
{`<?php
$payload = [
    "sessionId" => "default",
    "to" => "6281234567890",
    "message" => "Halo! Pembayaran invoice #INV-2026 telah berhasil kami terima."
];

$ch = curl_init("https://www.omnireach.my.id/api/send-message");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json",
    "Authorization: Bearer YOUR_API_TOKEN"
]);

$result = curl_exec($ch);
curl_close($ch);
echo $result;
?>`}
          </pre>

          <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginTop: '36px', marginBottom: '14px', color: 'var(--text-main)' }}>
            Fitur Pendukung CS & Sales Modern
          </h2>
          <p style={{ marginBottom: '16px' }}>
            Selain API gateway, Omni Reach dilengkapi dengan aplikasi web multi-agent yang kaya fitur:
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px', marginBottom: '32px' }}>
            <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '6px' }}>⏱ SLA Follow-up 24 Jam</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Peringatan otomatis untuk pesan yang belum dibalas lebih dari 24 jam agar prospek tidak hilang.</div>
            </div>
            <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '6px' }}>📊 Analitik Penjualan Tim</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Filter pesan berdasarkan kalender tanggal dan leaderboard aktivitas agen CS.</div>
            </div>
            <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '6px' }}>⚡ Lightning Quick Reply</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Template pesan instan dengan shortcut '/' untuk mempercepat waktu respon tim.</div>
            </div>
            <div style={{ padding: '16px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
              <div style={{ fontWeight: '700', color: 'var(--primary)', marginBottom: '6px' }}>🏷 Profil & Tag Pelanggan</div>
              <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>Kategorikan prospek (New Leads, Closed Won, VIP) langsung dari panel WhatsApp.</div>
            </div>
          </div>

          {/* Call to Action Box */}
          <div style={{
            padding: '30px', borderRadius: '16px', background: 'linear-gradient(135deg, rgba(37,99,235,0.15), rgba(139,92,246,0.15))',
            border: '1px solid var(--primary-border)', textAlign: 'center', marginTop: '40px',
          }}>
            <h3 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '8px' }}>
              Siap Meningkatkan Konversi Penjualan Bisnis Anda?
            </h3>
            <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
              Mulai gunakan WhatsApp Unofficial API Indonesia dengan platform multi-agent Omni Reach sekarang. Coba gratis tanpa perlu kartu kredit.
            </p>
            <button
              type="button"
              className="nav-btn hero-btn-large"
              onClick={onGoToDashboard}
              style={{ margin: '0 auto', display: 'inline-flex' }}
            >
              Mulai Uji Coba Gratis Sekarang
            </button>
          </div>
        </article>
      </main>

      <footer className="landing-footer-container" style={{ marginTop: '60px' }}>
        <div className="landing-footer-bottom" style={{ borderTop: 'none', paddingTop: 0 }}>
          <div className="footer-copyright">
            © {new Date().getFullYear()} <strong>PT AWAM KODING INDONESIA</strong>. Hak Cipta Dilindungi Undang-Undang.
          </div>
          <div className="footer-engineered">
            Platform dikembangkan oleh <strong>PT AWAM KODING INDONESIA</strong>
          </div>
        </div>
      </footer>
    </div>
  );
}

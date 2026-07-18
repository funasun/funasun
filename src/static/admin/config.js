/* ============================================================
   admin/config.js — 編集ツールの環境設定
   ------------------------------------------------------------
   workerUrl … 保存を代行する Cloudflare Worker のURL。
               デプロイ後に発行される「…workers.dev」のURLをここに貼る。
   firebase  … Googleログイン用の設定（共有機能と同じ funasun-share）。
               apiKey 等は公開されても安全な情報（Firebase の設計上の前提）。
   ============================================================ */
window.ADMIN_CONFIG = {
  // ↓↓↓ Cloudflare Worker をデプロイしたら、そのURLをここに貼り付ける ↓↓↓
  workerUrl: 'https://funasun-admin.takakouseitokai.workers.dev',   // 例: 'https://funasun-admin.xxxxx.workers.dev'

  firebase: {
    apiKey: 'AIzaSyCbi7N4rV7L04rusvzVHQ2SjPoKdqaNg2k',
    authDomain: 'funasun-share.firebaseapp.com',
    projectId: 'funasun-share',
    storageBucket: 'funasun-share.firebasestorage.app',
    messagingSenderId: '807946434754',
    appId: '1:807946434754:web:8f8b7bf399496d0a1be35b'
  }
};

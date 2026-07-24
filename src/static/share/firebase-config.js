/* ============================================================
   share/firebase-config.js — Firebase の接続設定
   ------------------------------------------------------------
   ここに Firebase コンソールで発行される設定値を貼り付けます。
   （手順は船越さんに別途お伝えするセットアップ手順を参照）

   ※ この値は「公開されても問題ない」ものです（Firebase の設計上、
     apiKey 等はブラウザに配る前提の公開情報）。
     本当の防御は「セキュリティルール」で行います：
       ・書き込み（保存）… あなたの Google アカウントだけ許可
       ・読み取り………… 誰でも可（ただし中身は暗号化済み）
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbi7N4rV7L04rusvzVHQ2SjPoKdqaNg2k",
  authDomain: "funasun-share.firebaseapp.com",
  projectId: "funasun-share",
  storageBucket: "funasun-share.firebasestorage.app",
  messagingSenderId: "807946434754",
  appId: "1:807946434754:web:8f8b7bf399496d0a1be35b"
};

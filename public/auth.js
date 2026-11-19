'use strict';
// 로그인·가입 화면 공용. 서버는 주소·본문의 사용자 정보가 아니라 세션 쿠키로만 사용자를 정한다.
(function () {
  const form = document.getElementById('auth-form');
  const msg = document.getElementById('auth-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const mode = form.dataset.mode;
    const body = { username: form.username.value, password: form.password.value };
    try {
      const res = await fetch('/api/' + mode, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'diary' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { location.href = '/'; return; }
      msg.textContent = data.error || `요청 실패 (${res.status})`;
    } catch (err) { msg.textContent = '서버에 연결하지 못했습니다.'; }
  });
})();

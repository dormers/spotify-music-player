document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    const messageDiv = document.getElementById('message');
    if (result.success) {
      // 로그인 성공 시 메인 페이지로 이동
      window.location.href = '/';
    } else {
      messageDiv.innerText = result.message;
    }
  });
});

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    const response = await fetch('/api/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    const result = await response.json();

    const messageDiv = document.getElementById('message');
    if (result.success) {
      // 회원가입 성공 시 로그인 페이지로 이동
      window.location.href = '/login.html';
    } else {
      messageDiv.innerText = result.message;
    }
  });
});

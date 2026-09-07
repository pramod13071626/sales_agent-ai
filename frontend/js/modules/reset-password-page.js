import { resetPassword } from './auth-client.js';

const form = document.getElementById('resetForm');
const errorEl = document.getElementById('resetError');
const successEl = document.getElementById('resetSuccess');
const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  errorEl.textContent = 'This reset link is missing its token — please request a new one from the sign-in page.';
  errorEl.hidden = false;
  form.querySelectorAll('input, button').forEach(el => el.disabled = true);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  successEl.hidden = true;

  const password = document.getElementById('resetPassword').value;
  const confirm = document.getElementById('resetPasswordConfirm').value;
  if (password !== confirm) {
    errorEl.textContent = 'Passwords do not match.';
    errorEl.hidden = false;
    return;
  }

  const submitBtn = document.getElementById('resetSubmit');
  submitBtn.disabled = true;
  try {
    const result = await resetPassword(token, password);
    successEl.textContent = (result.message || 'Password updated.') + ' Redirecting to sign in…';
    successEl.hidden = false;
    form.querySelectorAll('input, button').forEach(el => el.disabled = true);
    setTimeout(() => { window.location.href = '/login'; }, 2000);
  } catch (err) {
    errorEl.textContent = err.message || 'Could not reset your password.';
    errorEl.hidden = false;
    submitBtn.disabled = false;
  }
});

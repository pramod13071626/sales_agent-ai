import { login, forgotPassword } from './auth-client.js';

const loginFormWrap = document.getElementById('authFormLogin');
const forgotFormWrap = document.getElementById('authFormForgot');
const loginForm = document.getElementById('loginForm');
const forgotForm = document.getElementById('forgotForm');
const loginError = document.getElementById('loginError');
const forgotError = document.getElementById('forgotError');
const forgotSuccess = document.getElementById('forgotSuccess');

function showError(el, message) {
  el.textContent = message;
  el.hidden = false;
}
function hideError(el) {
  el.hidden = true;
}

document.getElementById('showForgotPassword').addEventListener('click', (e) => {
  e.preventDefault();
  loginFormWrap.hidden = true;
  forgotFormWrap.hidden = false;
});
document.getElementById('showLogin').addEventListener('click', (e) => {
  e.preventDefault();
  forgotFormWrap.hidden = true;
  loginFormWrap.hidden = false;
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(loginError);
  const submitBtn = document.getElementById('loginSubmit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';
  try {
    const { user } = await login(
      document.getElementById('loginEmail').value.trim(),
      document.getElementById('loginPassword').value
    );
    // Super admins land on their own dashboard, never the sales Global
    // Accounts Dashboard — see main.js's matching redirect for anyone who
    // reaches "/" directly while already signed in as one.
    if (user && user.role === 'super_admin') {
      window.location.href = '/admin';
    } else {
      const params = new URLSearchParams(window.location.search);
      window.location.href = params.get('next') || '/';
    }
  } catch (err) {
    showError(loginError, err.message || 'Sign in failed.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign In';
  }
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(forgotError);
  forgotSuccess.hidden = true;
  const submitBtn = document.getElementById('forgotSubmit');
  submitBtn.disabled = true;
  try {
    const result = await forgotPassword(document.getElementById('forgotEmail').value.trim());
    forgotSuccess.textContent = result.message || 'If that email exists, a reset link has been sent.';
    forgotSuccess.hidden = false;
    forgotForm.reset();
  } catch (err) {
    showError(forgotError, err.message || 'Something went wrong.');
  } finally {
    submitBtn.disabled = false;
  }
});

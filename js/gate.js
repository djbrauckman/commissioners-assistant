/**
 * gate.js
 * A casual deterrent, not real security. This repo is public, so anyone who
 * views source or opens devtools can find the password hash and brute-force
 * or bypass it outright — this only stops people from stumbling in via the
 * nav link. If you ever need this to be unbypassable, it has to move to
 * server-side auth (e.g. Vercel edge middleware + an env var).
 */

const GATE_STORAGE_KEY = 'dr_gate_unlocked';
const GATE_HASH = '249d9934e2c25e78df2990910b8ede3a95344d51720b132bf4e513b7e77820e1';

async function sha256Hex(text) {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function unlockGate() {
  document.getElementById('gateOverlay').style.display = 'none';
  document.getElementById('pageContent').style.display = '';
}

async function checkGatePassword() {
  const input = document.getElementById('gatePassword').value;
  const hash  = await sha256Hex(input);
  if (hash === GATE_HASH) {
    localStorage.setItem(GATE_STORAGE_KEY, '1');
    unlockGate();
  } else {
    document.getElementById('gateError').style.display = 'block';
    document.getElementById('gatePassword').value = '';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(GATE_STORAGE_KEY) === '1') {
    unlockGate();
  }
  const input = document.getElementById('gatePassword');
  input?.addEventListener('keydown', e => { if (e.key === 'Enter') checkGatePassword(); });
  input?.focus();
});

import { el, signalModalTitle, signalModalBody, signalModalBackdrop } from './dom.js';

export function openSignalModal(signal) {
  signalModalTitle.textContent = signal.title || 'Signal Detail';
  signalModalBody.innerHTML = signal.detail || '';
  signalModalBackdrop.classList.add('open');
}

export function closeSignalModal() {
  signalModalBackdrop.classList.remove('open');
}

el('signalModalClose').addEventListener('click', closeSignalModal);
signalModalBackdrop.addEventListener('click', (e) => { if (e.target === signalModalBackdrop) closeSignalModal(); });

// QR-код с ключом подключения и сканер камеры. Модуль грузится только
// на экранах подключения второго устройства.
import qrcode from '../vendor/qrcode.js';

// Матрица модулей: dark(x, y) — закрашен ли квадратик
export function qrMatrix(text) {
  const qr = qrcode(0, 'M'); // 0 — размер подбирается под длину текста
  qr.addData(text, 'Byte');
  qr.make();
  return { size: qr.getModuleCount(), dark: (x, y) => qr.isDark(y, x) };
}

// Белый фон и «тихая зона» по краям нужны камере и в тёмной теме
export function qrSvg(text, quiet = 4) {
  const { size, dark } = qrMatrix(text);
  let d = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (dark(x, y)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const full = size + quiet * 2;
  return `<svg class="qr" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges" role="img" aria-label="QR-код с ключом подключения"><rect width="${full}" height="${full}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// jsQR подключаем обычным скриптом (он не модуль) и только когда нужен
let jsqrPromise = null;
function loadJsQR() {
  jsqrPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/jsQR.js', import.meta.url).href;
    s.onload = () => resolve(window.jsQR);
    s.onerror = () => {
      jsqrPromise = null;
      reject(new Error('Не удалось загрузить сканер QR-кодов'));
    };
    document.head.append(s);
  });
  return jsqrPromise;
}

async function nativeDetector() {
  try {
    if (!('BarcodeDetector' in window)) return null;
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('qr_code') ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

/**
 * Включает камеру в <video> и ищет QR-код в кадре. onResult(text) вызывается
 * один раз, после чего камера выключается. Возвращает функцию «стоп».
 * Ошибки доступа к камере (NotAllowedError и т.п.) пробрасываются.
 */
export async function startScanner(video, onResult) {
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Нет доступа к камере', 'NotSupportedError');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  try {
    video.setAttribute('playsinline', ''); // иначе iOS разворачивает видео на весь экран
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    const detector = await nativeDetector();
    const decode = detector ? null : await loadJsQR();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let busy = false;

    const readFrame = async () => {
      if (detector) return (await detector.detect(video))[0]?.rawValue ?? null;
      // Уменьшаем кадр: распознавание быстрее, а для QR на экране хватает
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return decode(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    };

    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          const text = await readFrame();
          if (text && !stopped) {
            stop();
            onResult(text);
            return;
          }
        } catch {
          /* кадр не распознан — пробуем следующий */
        }
        busy = false;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (err) {
    stop();
    throw err;
  }
  return stop;
}

export function describeCameraError(err) {
  if (err?.name === 'NotAllowedError') return 'Нет доступа к камере. Разреши его в настройках (для айфона: Настройки → Safari → Камера) или вставь ключ вручную.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'Камера не найдена. Вставь ключ вручную.';
  if (err?.name === 'NotSupportedError') return 'Этот браузер не даёт доступ к камере. Вставь ключ вручную.';
  return `Камера не включилась: ${err?.message || err?.name || 'неизвестная ошибка'}`;
}

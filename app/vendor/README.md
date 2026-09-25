# Сторонние библиотеки

Лежат без изменений и грузятся только на экранах подключения второго устройства.

| Файл | Библиотека | Версия | Лицензия |
|---|---|---|---|
| `qrcode.js` | [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) © Kazuhiko Arase | 2.0.4 (npm, `dist/qrcode.mjs`; переименован в `.js`, чтобы любой хостинг отдавал его как JavaScript) | MIT, текст лицензии в шапке файла |
| `jsQR.js` | [jsQR](https://github.com/cozmo/jsQR) © Cosmo Wolfe | 1.4.0 (npm, `dist/jsQR.js`) | Apache-2.0, см. `jsQR.LICENSE.txt` |

`qrcode.js` рисует QR-код с ключом подключения, `jsQR.js` распознаёт его с камеры
(там, где нет встроенного `BarcodeDetector`, например в Safari на iPhone).

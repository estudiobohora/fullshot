// minipdf.js — Escribe un PDF cuyas páginas son, cada una, un JPEG a sangre.
//
// Existe para no depender de una librería de PDF. jsPDF trae dentro una llamada
// a un script alojado en cdnjs, y Chrome Web Store rechaza cualquier código
// remoto en Manifest V3, se ejecute o no. Esto cubre exactamente lo que FullShot
// necesita y nada más: N páginas, una imagen JPEG por página, a tamaño completo.
//
// No añadir features aquí. Si algún día hace falta texto, fuentes o vectores,
// eso es otro problema y merece otra decisión, no un parche encima de este archivo.

(function (global) {
  "use strict";

  // El cuerpo del PDF es ASCII; los bytes del JPEG se escriben crudos aparte.
  function latin1(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  // Sin notación exponencial: un PDF con "1e+3" no abre.
  function num(n) {
    return (Math.round(n * 100) / 100).toString();
  }

  // pages: [{ jpeg: Uint8Array, pxW, pxH, wPt, hPt }]
  function fsBuildPdf(pages) {
    if (!pages || !pages.length) throw new Error("A PDF needs at least one page.");

    const chunks = [];
    let size = 0;
    const put = (u8) => { chunks.push(u8); size += u8.length; };
    const putText = (s) => put(latin1(s));

    // Por página: el objeto Page, su content stream, y la imagen.
    const total = 2 + pages.length * 3;
    const offset = new Array(total + 1).fill(0);
    const open = (n) => { offset[n] = size; putText(n + " 0 obj\n"); };
    const close = () => putText("endobj\n");

    const pageNum    = (i) => 3 + i * 3;
    const contentNum = (i) => 4 + i * 3;
    const imageNum   = (i) => 5 + i * 3;

    putText("%PDF-1.4\n");
    put(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A])); // marca el archivo como binario

    open(1);
    putText("<< /Type /Catalog /Pages 2 0 R >>\n");
    close();

    open(2);
    putText("<< /Type /Pages /Count " + pages.length + " /Kids [" +
            pages.map((_, i) => pageNum(i) + " 0 R").join(" ") + "] >>\n");
    close();

    pages.forEach((p, i) => {
      // La matriz cm estira la imagen (que mide 1x1 en su propio espacio) al tamaño de la página.
      const stream = "q " + num(p.wPt) + " 0 0 " + num(p.hPt) + " 0 0 cm /Im0 Do Q\n";

      open(pageNum(i));
      putText("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + num(p.wPt) + " " + num(p.hPt) + "] " +
              "/Resources << /XObject << /Im0 " + imageNum(i) + " 0 R >> >> " +
              "/Contents " + contentNum(i) + " 0 R >>\n");
      close();

      open(contentNum(i));
      putText("<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream\n");
      close();

      open(imageNum(i));
      putText("<< /Type /XObject /Subtype /Image /Width " + p.pxW + " /Height " + p.pxH +
              " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
              p.jpeg.length + " >>\nstream\n");
      put(p.jpeg);
      putText("\nendstream\n");
      close();
    });

    const xrefAt = size;
    putText("xref\n0 " + (total + 1) + "\n");
    putText("0000000000 65535 f \n");
    for (let n = 1; n <= total; n++) {
      putText(String(offset[n]).padStart(10, "0") + " 00000 n \n");
    }
    putText("trailer\n<< /Size " + (total + 1) + " /Root 1 0 R >>\n" +
            "startxref\n" + xrefAt + "\n%%EOF\n");

    return new Blob(chunks, { type: "application/pdf" });
  }

  global.fsBuildPdf = fsBuildPdf;
})(typeof globalThis !== "undefined" ? globalThis : self);

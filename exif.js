/*
 * exif.js – escribe metadatos EXIF (trazabilidad) dentro de un JPEG.
 * Sin dependencias. Uso:
 *   var bytes = ExifWriter.injectIntoJpeg(arrayBuffer, meta);   // -> Uint8Array
 * meta: { description, artist, model, software, copyright, capturedAt(ms),
 *         comment(obj), gps:{lat,lng,acc,ts}|null, width, height }
 */
(function (root) {
  'use strict';

  function ascii(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '?');
  }
  function strBytes(s) {
    s = ascii(s);
    var o = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return o;
  }
  function asciiZ(s) {
    var a = strBytes(s), o = new Uint8Array(a.length + 1);
    o.set(a);
    return o;
  }
  function u32(v) { return new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]); }
  function cat(list) {
    var n = 0, i;
    for (i = 0; i < list.length; i++) n += list[i].length;
    var o = new Uint8Array(n), p = 0;
    for (i = 0; i < list.length; i++) { o.set(list[i], p); p += list[i].length; }
    return o;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Tipos TIFF: 1 BYTE, 2 ASCII, 4 LONG, 5 RATIONAL, 7 UNDEFINED */
  function eAscii(tag, s) { var b = asciiZ(s); return { tag: tag, type: 2, count: b.length, bytes: b }; }
  function eBytes(tag, arr) { return { tag: tag, type: 1, count: arr.length, bytes: new Uint8Array(arr) }; }
  function eUndef(tag, b) { return { tag: tag, type: 7, count: b.length, bytes: b }; }
  function eLong(tag, v) { return { tag: tag, type: 4, count: 1, bytes: u32(v) }; }
  function eRat(tag, pairs) {
    var parts = [];
    pairs.forEach(function (p) { parts.push(u32(p[0]), u32(p[1])); });
    return { tag: tag, type: 5, count: pairs.length, bytes: cat(parts) };
  }
  function ePtr(tag, name) { return { tag: tag, type: 4, count: 1, bytes: u32(0), ptr: name }; }

  function dmsRational(v) {
    v = Math.abs(v);
    var d = Math.floor(v), m = Math.floor((v - d) * 60), s = ((v - d) * 60 - m) * 60;
    return [[d, 1], [m, 1], [Math.round(s * 10000), 10000]];
  }
  function exifDate(d) {
    return d.getFullYear() + ':' + pad2(d.getMonth() + 1) + ':' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  function tzString(d) {
    var o = -d.getTimezoneOffset(), sign = o < 0 ? '-' : '+';
    o = Math.abs(o);
    return sign + pad2(Math.floor(o / 60)) + ':' + pad2(o % 60);
  }

  function entriesFor(meta) {
    var when = new Date(meta.capturedAt || Date.now());

    var ifd0 = [eAscii(0x010E, meta.description || '')];
    if (meta.model) ifd0.push(eAscii(0x0110, meta.model));
    ifd0.push(eAscii(0x0131, meta.software || 'GED Fotos'));
    if (meta.artist) ifd0.push(eAscii(0x013B, meta.artist));
    if (meta.copyright) ifd0.push(eAscii(0x8298, meta.copyright));
    ifd0.push(ePtr(0x8769, 'exif'));

    var comment = '';
    try { comment = JSON.stringify(meta.comment || {}); } catch (e) { comment = '{}'; }
    comment = comment.replace(/[^\x20-\x7E]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
    var uc = cat([new Uint8Array([65, 83, 67, 73, 73, 0, 0, 0]), strBytes(comment)]);

    var exif = [
      eUndef(0x9000, new Uint8Array([48, 50, 51, 49])),           // ExifVersion "0231"
      eAscii(0x9003, exifDate(when)),                              // DateTimeOriginal
      eAscii(0x9004, exifDate(when)),                              // DateTimeDigitized
      eAscii(0x9011, tzString(when)),                              // OffsetTimeOriginal
      eUndef(0x9286, uc)                                           // UserComment (JSON)
    ];
    if (meta.width && meta.height) {
      exif.push(eLong(0xA002, meta.width), eLong(0xA003, meta.height));
    }

    var gps = null;
    var g = meta.gps;
    if (g && isFinite(g.lat) && isFinite(g.lng)) {
      gps = [
        eBytes(0x0000, [2, 3, 0, 0]),
        eAscii(0x0001, g.lat >= 0 ? 'N' : 'S'),
        eRat(0x0002, dmsRational(g.lat)),
        eAscii(0x0003, g.lng >= 0 ? 'E' : 'W'),
        eRat(0x0004, dmsRational(g.lng))
      ];
      if (g.ts) {
        var t = new Date(g.ts);
        gps.push(eRat(0x0007, [[t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]]));
        gps.push(eAscii(0x001D, t.getUTCFullYear() + ':' + pad2(t.getUTCMonth() + 1) + ':' + pad2(t.getUTCDate())));
      }
      if (isFinite(g.acc)) gps.push(eRat(0x001F, [[Math.round(g.acc * 100), 100]]));
      ifd0.push(ePtr(0x8825, 'gps'));
    }
    return { ifd0: ifd0, exif: exif, gps: gps };
  }

  function ifdSize(n) { return 2 + n * 12 + 4; }
  function extraSize(entries) {
    var t = 0;
    entries.forEach(function (e) { if (e.bytes.length > 4) t += e.bytes.length + (e.bytes.length & 1); });
    return t;
  }

  function writeIfd(entries, off, ctx) {
    var dv = ctx.dv, u8 = ctx.u8, p = off;
    dv.setUint16(p, entries.length, true); p += 2;
    entries.forEach(function (e) {
      dv.setUint16(p, e.tag, true);
      dv.setUint16(p + 2, e.type, true);
      dv.setUint32(p + 4, e.count, true);
      var b = e.ptr ? u32(ctx.ptrs[e.ptr]) : e.bytes;
      if (b.length <= 4) {
        u8.fill(0, p + 8, p + 12);
        u8.set(b, p + 8);
      } else {
        dv.setUint32(p + 8, ctx.dataPos, true);
        u8.set(b, ctx.dataPos);
        ctx.dataPos += b.length + (b.length & 1);
      }
      p += 12;
    });
    dv.setUint32(p, 0, true);
  }

  function buildTiff(set) {
    var ifd0Off = 8;
    var exifOff = ifd0Off + ifdSize(set.ifd0.length);
    var gpsOff = exifOff + ifdSize(set.exif.length);
    var dataStart = gpsOff + (set.gps ? ifdSize(set.gps.length) : 0);
    var total = dataStart + extraSize(set.ifd0) + extraSize(set.exif) + (set.gps ? extraSize(set.gps) : 0);

    var u8 = new Uint8Array(total), dv = new DataView(u8.buffer);
    u8[0] = 0x49; u8[1] = 0x49;                 // "II" little endian
    dv.setUint16(2, 42, true);
    dv.setUint32(4, 8, true);
    var ctx = { dv: dv, u8: u8, dataPos: dataStart, ptrs: { exif: exifOff, gps: gpsOff } };
    writeIfd(set.ifd0, ifd0Off, ctx);
    writeIfd(set.exif, exifOff, ctx);
    if (set.gps) writeIfd(set.gps, gpsOff, ctx);
    return u8;
  }

  function buildSegment(meta) {
    var tiff = buildTiff(entriesFor(meta));
    var len = 2 + 6 + tiff.length;
    if (len > 65535) throw new Error('EXIF demasiado grande');
    var head = new Uint8Array([0xFF, 0xE1, (len >> 8) & 255, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
    return cat([head, tiff]);
  }

  function injectIntoJpeg(buf, meta) {
    var src = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (src[0] !== 0xFF || src[1] !== 0xD8) throw new Error('No es un JPEG');
    var pos = 2;
    if (src[2] === 0xFF && src[3] === 0xE0) pos = 4 + ((src[4] << 8) | src[5]);   // salta JFIF (APP0)
    return cat([src.subarray(0, pos), buildSegment(meta), src.subarray(pos)]);
  }

  var api = { injectIntoJpeg: injectIntoJpeg, buildSegment: buildSegment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExifWriter = api;
})(typeof self !== 'undefined' ? self : this);

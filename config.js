/*
 * CONFIGURACIÓN – es el único archivo que tenés que editar.
 * Pegá entre las comillas la URL de la "Aplicación web" de Apps Script
 * (termina en /exec). Ver la GUÍA, paso 5.
 */
window.GED_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzsfPsx_N4-F5ydfq4ngr9gqROh_ss_1XtTcPJPyq8VC2IeTOG_nTIL4zFAtXu6uOpB7Q/exec',
  VERSION: '1.2.0',

  /* Ajustes del aviso de calidad al sacar la foto. Vienen con valores prudentes.
     Se afinan mirando las columnas Nitidez y Luz de la hoja "Fotos" (ver la guía, parte G). */
  Q_SHARP_MIN: 35,   // nitidez por debajo de esto → avisa "foto movida" (más alto = avisa más seguido)
  Q_SHARP_OK: 80,    // nitidez a partir de la cual cuenta como 100%
  Q_DARK_MEAN: 55,   // brillo (0-255) por debajo de esto → avisa "muy oscura"
  Q_GLARE: 0.2,      // proporción de zona quemada por reflejo a partir de la cual avisa
  Q_LOW: 60          // puntaje total (0-100) por debajo del cual avisa
};

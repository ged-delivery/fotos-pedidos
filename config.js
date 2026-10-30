/*
 * CONFIGURACIÓN – es el único archivo que tenés que editar.
 * Pegá entre las comillas la URL de la "Aplicación web" de Apps Script
 * (termina en /exec). Ver la GUÍA, paso 5.
 */
window.GED_CONFIG = {
  API_URL: 'PEGAR_AQUI_LA_URL_DE_APPS_SCRIPT',
  VERSION: '1.2.1',

  /* Ajustes del aviso de calidad al sacar la foto. Vienen con valores prudentes.
     Se afinan mirando las columnas Nitidez y Luz de la hoja "Fotos" (ver la guía, parte G). */
  Q_SHARP_MIN: 35,   // nitidez por debajo de esto → avisa "foto movida" (más alto = avisa más seguido)
  Q_SHARP_OK: 80,    // nitidez a partir de la cual cuenta como 100%
  Q_DARK_MEAN: 55,   // brillo (0-255) por debajo de esto → avisa "muy oscura"
  Q_GLARE: 0.2,      // proporción de zona quemada por reflejo a partir de la cual avisa
  Q_LOW: 60          // puntaje total (0-100) por debajo del cual avisa
};

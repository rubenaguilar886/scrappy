# Scrappy

Buscador de negocios con interfaz web. Encuentra negocios en Google Maps y expórtalos a CSV para Google Sheets.

**No necesitas saber Python ni usar la terminal.** Solo haz doble clic y busca.

## Cómo usar (3 pasos)

1. Haz **doble clic** en `Iniciar Scrappy.bat`
2. Se abrirá tu navegador automáticamente
3. Escribe qué buscas (una búsqueda por línea) y haz clic en **Buscar negocios**

**Búsquedas múltiples:** pon una búsqueda por línea, por ejemplo:
```
grooming
peluquería canina
baño de mascotas
```
Scrappy ejecuta todas en una sola corrida y elimina duplicados.

## ¿Usa inteligencia artificial?

**No.** Scrappy no usa ningún LLM (ChatGPT, Claude, etc.). Funciona así:

1. Abre Google Maps en un navegador automatizado (Playwright/Chromium)
2. Busca lo que escribes, igual que tú en Maps
3. Extrae los datos visibles de cada negocio (nombre, teléfono, dirección...)
4. Te los exporta a CSV

Es scraping puro + automatización, sin IA.

## Velocidad

- Extrae **4 negocios en paralelo** para ir más rápido
- 100 resultados tarda aprox. **3–5 minutos** (antes ~8–10 min)
- Búsquedas múltiples se ejecutan una tras otra; el total depende de cuántas líneas pongas

La primera vez instalará todo solo (tarda 1-2 minutos). Después arranca al instante.

## Ejemplos de búsqueda

| Qué buscas | Ubicación |
|------------|-----------|
| veterinarias | Lima, Perú |
| pet grooming | Miraflores, Lima |
| peluquería canina | San Isidro, Lima |

## Exportar a Google Sheets

1. Haz clic en **Descargar CSV**
2. Abre Google Sheets
3. Archivo → Importar → Subir
4. Selecciona el CSV descargado

## Datos que obtienes

- Nombre, dirección, teléfono
- **WhatsApp** (link directo; si no está en Maps, se infiere desde celular peruano)
- **Email**, **Instagram**, **Facebook**, **sitio web**
- Calificación y reseñas de Google
- Categoría, horario, link de Google Maps
- Coordenadas (latitud/longitud)
- Contador de **canales de contacto** por lead

## Requisitos

- Windows 10/11
- [Node.js](https://nodejs.org) (solo la primera vez; el `.bat` te avisa si falta)

## Roadmap

- [x] Interfaz web simple
- [x] Google Maps scraper
- [ ] Páginas Amarillas (Perú)
- [ ] Supabase
- [ ] Instagram / Facebook

## Nota

El scraping de Google Maps es para uso personal/investigación. Para uso comercial a gran escala, considera la Google Places API.
# scrappy

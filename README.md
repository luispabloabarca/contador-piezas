# Contador de Piezas

App web para **sacar una foto con el celular y contar unidades**, identificando su **forma** y su **largo relativo**, para saber cuántas están **enteras y cuántas partidas** (ej. ramitas saladas, palitos, galletas, snacks).

Todo el análisis corre en el navegador: la foto no se sube a ningún servidor y no requiere instalar nada.

## Qué entrega

| Resultado | Cómo se obtiene |
|---|---|
| Unidades totales | Piezas separadas + estimado de las que están tocándose |
| Enteras / partidas | Largo de cada pieza vs. largo de referencia (≥ 90 % = entera, umbral ajustable) |
| Distribución de partidas | Histograma por tramos: 0–25 %, 25–50 %, 50–75 %, 75–90 % del largo entero |
| Equivalente en enteras | Suma de largos relativos (ej. 2 mitades = 1 entera) |
| Forma | `palito`, `rectangular`, `ovalado`, `cuadrado`, `redondo` según relación largo/ancho y llenado |
| Grupos | Piezas cruzadas o pegadas: se marcan en rojo con su cantidad estimada |
| Migas | Trozos muy pequeños, contados aparte |
| mm reales (opcional) | Si ingresas el largo real de una unidad entera, todo se convierte a mm |
| CSV | Detalle por pieza, listo para Excel (separador `;`) |

## Cómo usar

1. Abre la página en el celular y presiona **Sacar / subir foto**.
2. Revisa la imagen: verde = entera, naranjo = partida, rojo = grupo, gris = miga.
3. El largo de referencia es automático (percentil 90 de los largos). Si en la muestra casi todo está partido, **toca una pieza entera** en la imagen para fijarla como referencia.
4. Ajusta la **sensibilidad** si detecta sombras (mover a la derecha) o pierde piezas (mover a la izquierda). El botón **Ver máscara** muestra lo que se está detectando.

### Consejos para la foto

- Fondo liso y contrastante (papel blanco para productos tostados, cartulina negra para productos claros).
- Foto cenital (desde arriba), luz pareja, sin flash directo.
- Piezas separadas entre sí y sin tocar el borde de la foto.

## Cómo funciona

`js/analyzer.js` (sin dependencias):

1. Estima el color del fondo con la mediana del borde de la imagen.
2. Calcula la distancia de color de cada píxel al fondo y umbraliza con **Otsu**.
3. Limpia con apertura/cierre morfológico y rellena huecos (brillos, granos de sal).
4. Etiqueta componentes conectados (cada pieza).
5. Para cada pieza calcula su **eje principal (PCA)** → largo, ancho, rectángulo orientado, perfil de ancho a lo largo del eje.
6. Clasifica: migas (área chica), grupos (ancho > 1,6 × ancho típico o perfil irregular de cruce), y el resto como enteras/partidas según su largo relativo.

## Desarrollo

```bash
python -m http.server 8765
```

Abrir http://localhost:8765 (los módulos ES no cargan desde `file://`).

Pruebas con imágenes sintéticas de resultado conocido:

```bash
node test/analyzer.test.mjs
```

## Limitaciones

- Las piezas que se tocan no se separan: se estima su cantidad por área. Para un conteo exacto, sepáralas.
- Sombras fuertes o fondos con textura pueden detectarse como piezas; usa luz difusa y fondo liso.
- El largo medido es la proyección en la foto: piezas inclinadas o curvas pueden medir distinto.

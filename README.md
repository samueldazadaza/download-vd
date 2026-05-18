# Vivotek NV9311P-A – Descargador automático de video

Sin dependencias externas. Solo Node.js 16+.

## Uso

```bash
node vivotek-download.js              # usa jobs.json por defecto
node vivotek-download.js otro.json   # usa otro archivo
```

## Formato de jobs.json

```json
[
  {
    "descripcion": "Incidente Bus 7 - 2026-05-14",
    "nvr_ip": "172.23.10.240",
    "nvr_sid": "ac24e15f4d0139ebf6735a5aa96f329e",
    "fecha": "2026-05-14",
    "hora_inicio": "01:08:00",
    "duracion_minutos": 1,
    "formato": "3gp",
    "camaras": ["BSF", "BSO", "BS1", "BS2", "BST"]
  },
  {
    "descripcion": "Incidente Bus 12 - 2026-05-15",
    "nvr_ip": "172.23.10.241",
    "nvr_sid": "PEGAR_SID_DEL_BUS_12_AQUI",
    "fecha": "2026-05-15",
    "hora_inicio": "14:30:00",
    "duracion_minutos": 5,
    "formato": "3gp",
    "camaras": ["BSF", "BST"]
  }
]
```

## Cámaras disponibles

| Sigla | Canal | Descripción              |
|-------|-------|--------------------------|
| BSF   | 0     | BuSeton Frontal          |
| BSO   | 1     | BuSeton Operador         |
| BS1   | 2     | BuSeton Interna 1        |
| BS2   | 3     | BuSeton Interna 2        |
| BST   | 4     | BuSeton Trasera          |

## Zona horaria

El script asume que las horas en jobs.json están en hora **local de Colombia (UTC-5)**
y las convierte automáticamente a UTC para el NVR.

Si tu NVR ya guarda en UTC, cambia en el script:
```js
const UTC_OFFSET_HOURS = 0;
```

## Cómo obtener el SID de cada bus

1. Abre el NVR en el navegador: `http://<ip_del_nvr>/`
2. Haz login con admin / contraseña
3. F12 → Console → pega:
   ```js
   document.cookie.match(/_SID_=([^;]+)/)[1]
   ```
4. Copia el resultado y ponlo en `nvr_sid` del jobs.json

**El SID dura mientras la sesión esté activa** (no cierres el navegador).
Si el script da error 401, repite el paso anterior para obtener un SID nuevo.

## Respuesta a "¿funciona para varios buses?"

**Sí**, con una condición: cada bus (NVR) necesita su propio `nvr_sid`.
El SID es la sesión autenticada de ese NVR específico.

Para automatización total (sin abrir el navegador), se necesita
capturar el endpoint de login del firmware. El script ya lo intenta
automáticamente; si falla, usa el método del SID manual.

## Estructura de descargas

```
descargas/
  172.23.10.240/
    2026-05-14/
      0002D19BF1DD_20260514_010800_1.tar   ← BSF
      0002D19BF1DD_20260514_010800_2.tar   ← BSO
      ...
  172.23.10.241/
    2026-05-15/
      ...
```

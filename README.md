# Gastos en pareja

App web tipo Splitwise para dos personas: cada uno carga sus gastos, la app calcula quién le debe a quién y muestra gráficos por categoría y por mes.

**Abrir la app:** https://ahc1980.github.io/gastos-pareja/

## Qué hace
- Cargar gastos (monto, descripción, categoría, quién pagó, fecha).
- Dividir: mitad y mitad, todo lo debe el otro, gasto personal o un porcentaje a elección.
- Saldo en vivo: "X le debe $... a Y" y botón para registrar el pago (saldar deuda).
- Lista de movimientos por mes con buscador; tocar un gasto para editarlo o borrarlo.
- Gráficos: gastos por categoría, quién pagó vs. cuánto le corresponde, evolución de los últimos 6 meses.
- Se puede instalar en el celular ("Agregar a pantalla de inicio").

## Cómo funciona
- Página estática (HTML + CSS + JavaScript) publicada con GitHub Pages; no requiere compilar nada.
- Datos y usuarios en [Supabase](https://supabase.com) (plan gratuito). El esquema de la base está en `supabase/schema.sql`: solo se permiten dos usuarios y únicamente ellos pueden ver los datos.
- Si `js/config.js` no tiene los datos de Supabase, la app funciona en **modo demo** con datos de ejemplo guardados en el navegador.

## Probar en la computadora
```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```
